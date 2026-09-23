using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using ArkonAgente.Cola;
using ArkonAgente.Configuracion;
using ArkonAgente.Diagnostico;
using ArkonAgente.SoftRestaurant;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Catalogos;

/// <summary>Lo que el worker hace con los catálogos en cada ciclo; los tests lo sustituyen.</summary>
internal interface ISincronizadorCatalogos : IDisposable
{
    /// <summary>Con el reader ya elegido: decide si toca leer, encola y vacía el carril de catálogos.</summary>
    Task CicloAsync(ISoftRestaurantReader reader, CancellationToken cancelacion);
}

/// <summary>
/// La sincronización de catálogos del POS hacia el panel (F2-240; los de inventario, F2-241), sobre el
/// contrato de F2-230.
/// </summary>
/// <remarks>
/// <para>
/// <b>Cuándo lee.</b> Una corrida COMPLETA de los once catálogos (<see cref="CatalogosPanel.Todos"/>):
/// (a) la primera vez (no hay marca de sincronización diaria); (b) una vez al día, pasada
/// <see cref="ConfiguracionAgente.HoraCatalogos"/> en el reloj de ESTA PC; (c) forzada desde el panel:
/// <c>GET /ingesta/catalogos/solicitud</c> (a lo más cada <see cref="IntervaloSolicitud"/>) dice
/// <c>pendiente</c> con un <c>solicitadaAt</c> que no se ha atendido. Cada <c>solicitadaAt</c> se
/// atiende UNA vez y se recuerda en el SQLite: si algún catálogo falló, el panel lo sigue viendo
/// pendiente hasta que ese catálogo cierre, y el agente ni se cicla ni lo cierra con <c>total = 0</c>
/// para apagarlo (nota de F2-120). Fuera de una corrida, sólo se relee un catálogo
/// que falló, cuando vence su reintento (<see cref="EsperaReintento"/>).
/// </para>
/// <para>
/// <b>Qué manda.</b> El SHA-256 de lo leído (<see cref="MapeoCatalogos.Hash"/>) contra el de lo último
/// encolado: igual y sin forzado = no se encola NADA. Distinto, o forzado = páginas de
/// <see cref="RegistrosPorPagina"/> + cierre con <c>total</c> = registros consolidados, todo en una
/// transacción. Catálogo vacío en el POS = sólo el cierre con <c>total = 0</c>. Una lectura que
/// falla no manda nada (nunca "0 filas") y se reintenta. Si el catálogo tiene una sincronización
/// suya sin confirmar en la cola, no se abre otra (el contrato de F2-230 prohíbe intercalarlas).
/// </para>
/// <para>
/// <b>Sólo con un usuario de solo lectura.</b> Antes de leer se corre <c>diagnostico.sql</c>; si el
/// usuario puede escribir, o no se pudo confirmar, no se lee nada.
/// DECISION PROVISIONAL (nocturno): la nota del Worker (F1-021) dice que lo conservador con un
/// usuario que puede escribir es NO leer tablas del POS. En una PC con login sysadmin (como la de
/// desarrollo) los catálogos no se sincronizan hasta crear el lector (F1-020b).
/// </para>
/// <para>
/// Nunca lanza, salvo la parada del servicio: el worker lo llama DESPUÉS del heartbeat y del envío,
/// y aun así lo envuelve (una excepción aquí no puede dejar al panel sin reporte).
/// </para>
/// </remarks>
internal sealed class SincronizadorCatalogos : ISincronizadorCatalogos
{
    public const int RegistrosPorPagina = 500;
    public static readonly TimeSpan EsperaReintento = TimeSpan.FromMinutes(15);
    public static readonly TimeSpan IntervaloSolicitud = TimeSpan.FromMinutes(1);

    internal const string MarcaDiaria = "catalogos.diaria";
    internal const string MarcaSolicitud = "catalogos.solicitud_atendida";

    private readonly ColaCatalogos _cola;
    private readonly EnviadorCatalogos _envio;
    private readonly Func<ISoftRestaurantReader, ILectorCatalogos> _crearLector;
    private readonly ConfiguracionAgente _config;
    private readonly TimeZoneInfo _zona;
    private readonly TimeProvider _reloj;
    private readonly ILogger _logger;

    private ISoftRestaurantReader? _readerDelLector;
    private ILectorCatalogos? _lector;
    private DateTimeOffset _proximaSolicitud = DateTimeOffset.MinValue;
    private DateTimeOffset _permisosBloqueadosHasta = DateTimeOffset.MinValue;
    private string? _ultimoMensajePermisos;
    private string? _ultimoErrorSolicitud;
    private readonly Dictionary<CatalogoPanel, string> _ultimoErrorLectura = [];

    public SincronizadorCatalogos(
        ColaCatalogos cola,
        EnviadorCatalogos envio,
        Func<ISoftRestaurantReader, ILectorCatalogos> crearLector,
        ConfiguracionAgente config,
        TimeZoneInfo zona,
        TimeProvider reloj,
        ILogger logger)
    {
        _cola = cola;
        _envio = envio;
        _crearLector = crearLector;
        _config = config;
        _zona = zona;
        _reloj = reloj;
        _logger = logger;
    }

    /// <summary>El de verdad: <c>cola.db</c> de la carpeta del agente, el API de la config y la hora de Windows.</summary>
    public static SincronizadorCatalogos DeVerdad(RutasAgente rutas, ConfiguracionAgente config, ILogger logger)
    {
        var cola = ColaCatalogos.Abrir(rutas.ArchivoCola, TimeProvider.System);
        var conexion = new Sql.ConexionSoftRestaurant(config.ConnectionString);
        return new SincronizadorCatalogos(
            cola, new EnviadorCatalogos(cola, config, logger, TimeProvider.System),
            reader => new LectorCatalogosSr(conexion, reader), config, TimeZoneInfo.Local, TimeProvider.System, logger);
    }

    public void Dispose() => _envio.Dispose();

    public async Task CicloAsync(ISoftRestaurantReader reader, CancellationToken cancelacion)
    {
        if (!ReferenceEquals(reader, _readerDelLector))
        {
            _lector = _crearLector(reader);
            _readerDelLector = reader;
        }

        await PlanificarYLeerAsync(_lector!, cancelacion);
        await _envio.CicloAsync(cancelacion);
    }

    private async Task PlanificarYLeerAsync(ILectorCatalogos lector, CancellationToken cancelacion)
    {
        var ahora = _reloj.GetUtcNow();
        var solicitud = await SolicitudNuevaAsync(ahora, cancelacion);
        var hoy = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(ahora, _zona).DateTime);
        var diaria = DiariaVencida(ahora, hoy);

        var motivo = solicitud is not null ? "forzada desde el panel"
            : diaria ? (_cola.Marca(MarcaDiaria) is null ? "primera sincronización" : "diaria")
            : null;
        var catalogos = motivo is not null
            ? CatalogosPanel.Todos.ToList()
            : CatalogosPanel.Todos.Where(c => _cola.ReintentarDesde(c) is { } desde && desde <= ahora).ToList();
        if (catalogos.Count == 0 || ahora < _permisosBloqueadosHasta)
        {
            return;
        }

        var permisos = await lector.RevisarPermisosAsync(cancelacion);
        if (!permisos.SoloLectura)
        {
            _permisosBloqueadosHasta = ahora + EsperaReintento;
            if (permisos.Mensaje != _ultimoMensajePermisos)
            {
                _ultimoMensajePermisos = permisos.Mensaje;
                _logger.LogError(
                    "Catálogos: no se leen catálogos de SoftRestaurant. {Mensaje} El agente sólo lee el POS con un usuario " +
                    "de SOLO LECTURA confirmado (rol db_datareader y nada más; ver 'agente test'). Se vuelve a revisar en " +
                    "{Minutos} min.",
                    permisos.Mensaje, EsperaReintento.TotalMinutes);
            }

            return;
        }

        if (_ultimoMensajePermisos is not null)
        {
            _logger.LogInformation("Catálogos: el usuario SQL ya es de solo lectura; se leen los catálogos.");
            _ultimoMensajePermisos = null;
        }

        var forzada = solicitud is not null;
        var inicio = Stopwatch.GetTimestamp();
        int encolados = 0, sinCambios = 0, fallas = 0, esperando = 0;
        foreach (var catalogo in catalogos)
        {
            switch (await SincronizarAsync(lector, catalogo, forzada, cancelacion))
            {
                case Resultado.Encolado: encolados++; break;
                case Resultado.SinCambios: sinCambios++; break;
                case Resultado.Esperando: esperando++; break;
                default: fallas++; break;
            }
        }

        if (diaria || forzada)
        {
            // La corrida queda hecha aunque algún catálogo falle: ése tiene su propio reintento.
            _cola.GuardarMarca(MarcaDiaria, hoy.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        }

        if (solicitud is not null)
        {
            _cola.GuardarMarca(MarcaSolicitud, solicitud);
        }

        _logger.LogInformation(
            "Catálogos: corrida {Motivo} terminada en {Ms} ms: {Encolados} encolado(s), {SinCambios} sin cambios, " +
            "{Esperando} esperando su envío anterior, {Fallas} con falla.",
            motivo ?? "de reintento", (long)Stopwatch.GetElapsedTime(inicio).TotalMilliseconds,
            encolados, sinCambios, esperando, fallas);
    }

    private enum Resultado
    {
        Encolado,
        SinCambios,
        Esperando,
        Falla,
    }

    private async Task<Resultado> SincronizarAsync(
        ILectorCatalogos lector, CatalogoPanel catalogo, bool forzada, CancellationToken cancelacion)
    {
        var nombre = catalogo.Texto();
        if (_cola.HayPendiente(catalogo))
        {
            _logger.LogInformation(
                "Catálogos: '{Catalogo}' tiene una sincronización sin confirmar en la cola; no se abre otra.", nombre);
            return Resultado.Esperando;
        }

        var capturadoAt = _reloj.GetUtcNow();
        LecturaCatalogo lectura;
        try
        {
            lectura = await lector.LeerAsync(catalogo, cancelacion);
        }
        catch (OperationCanceledException) when (cancelacion.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Cualquier excepción (SQL, una columna que no está, un tipo que no convierte) es falla
            // de ESTE catálogo: no se manda nada y se reintenta solo.
            _cola.ProgramarReintento(catalogo, _reloj.GetUtcNow() + EsperaReintento);
            var mensaje = ex is SqlException sql
                ? VerificacionSql.ClasificarError(sql, new Sql.ConexionSoftRestaurant(_config.ConnectionString)).Detalle
                : $"({ex.GetType().Name})";
            if (!_ultimoErrorLectura.TryGetValue(catalogo, out var anterior) || anterior != mensaje)
            {
                _ultimoErrorLectura[catalogo] = mensaje;
                _logger.LogError(
                    "Catálogos: no se pudo leer '{Catalogo}' en SoftRestaurant {Mensaje}. No se manda nada de él; se " +
                    "reintenta en {Minutos} min.",
                    nombre, mensaje, EsperaReintento.TotalMinutes);
            }

            return Resultado.Falla;
        }

        _ultimoErrorLectura.Remove(catalogo);
        var leido = lectura.Leido;
        foreach (var aviso in leido.Avisos)
        {
            _logger.LogWarning("Catálogos: '{Catalogo}': {Aviso}", nombre, aviso);
        }

        var hash = MapeoCatalogos.Hash(leido.Registros);
        if (!forzada && hash == _cola.Hash(catalogo))
        {
            _cola.QuitarReintento(catalogo);
            _logger.LogInformation(
                "Catálogos: '{Catalogo}' leído en SoftRestaurant: {Registros} registro(s) ({Filas} fila(s)) en {Ms} ms; " +
                "sin cambios, no se encola nada.",
                nombre, leido.Total, leido.FilasSql, lectura.Milisegundos);
            return Resultado.SinCambios;
        }

        var sinc = Armar(leido, capturadoAt, hash);
        _cola.EncolarSincronizacion(sinc);
        _logger.LogInformation(
            "Catálogos: '{Catalogo}' leído en SoftRestaurant: {Registros} registro(s) ({Filas} fila(s)) en {Ms} ms; " +
            "encolado en {Paginas} página(s) más su cierre (sincronización {Id}{Forzada}).",
            nombre, leido.Total, leido.FilasSql, lectura.Milisegundos, sinc.Paginas.Count, sinc.SincronizacionId,
            forzada ? ", forzada" : "");
        return Resultado.Encolado;
    }

    /// <summary>
    /// Las páginas y el cierre del contrato. <c>capturadoAt</c> = cuándo EMPEZÓ la lectura (UTC), el
    /// mismo en todas; <c>total</c> = registros consolidados (no filas SQL: un producto con varias filas
    /// de detalle es UN registro, o el cierre no cuadraría nunca).
    /// </summary>
    internal static SincronizacionArmada Armar(CatalogoLeido leido, DateTimeOffset capturadoAt, string hash)
    {
        var id = Guid.NewGuid().ToString();
        var instante = capturadoAt.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
        var catalogo = leido.Catalogo.Texto();

        var paginas = leido.Registros.Chunk(RegistrosPorPagina).Select(bloque =>
        {
            var sb = new StringBuilder();
            sb.Append("{\"catalogo\":").Append(JsonSerializer.Serialize(catalogo))
                .Append(",\"sincronizacionId\":").Append(JsonSerializer.Serialize(id))
                .Append(",\"capturadoAt\":").Append(JsonSerializer.Serialize(instante))
                .Append(",\"registros\":[");
            sb.AppendJoin(',', bloque.Select(r => r.Json));
            sb.Append("]}");
            return sb.ToString();
        }).ToList();

        var cierre = JsonSerializer.Serialize(new { catalogo, sincronizacionId = id, capturadoAt = instante, total = leido.Total });
        return new SincronizacionArmada(leido.Catalogo, id, paginas, cierre, hash);
    }

    /// <summary>
    /// La primera vez, o si hoy (fecha de ESTA PC) no ha corrido y ya pasó la hora configurada.
    /// </summary>
    private bool DiariaVencida(DateTimeOffset ahora, DateOnly hoy)
    {
        var marca = _cola.Marca(MarcaDiaria);
        if (marca is null)
        {
            return true;
        }

        var ultima = DateOnly.ParseExact(marca, "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var horaLocal = TimeOnly.FromDateTime(TimeZoneInfo.ConvertTime(ahora, _zona).DateTime);
        return ultima < hoy && horaLocal >= _config.HoraCatalogos;
    }

    /// <summary>El <c>solicitadaAt</c> de un forzado pendiente que no se ha atendido; null si no hay.</summary>
    private async Task<string?> SolicitudNuevaAsync(DateTimeOffset ahora, CancellationToken cancelacion)
    {
        if (ahora < _proximaSolicitud)
        {
            return null;
        }

        _proximaSolicitud = ahora + IntervaloSolicitud;
        var solicitud = await _envio.ConsultarSolicitudAsync(cancelacion);
        if (solicitud is null)
        {
            const string error = "Catálogos: no se pudo consultar si el panel pidió sincronizar; se vuelve a consultar en 1 min.";
            if (_ultimoErrorSolicitud != error)
            {
                _ultimoErrorSolicitud = error;
                _logger.LogWarning(error);
            }

            return null;
        }

        _ultimoErrorSolicitud = null;
        return solicitud is { Pendiente: true, SolicitadaAt: { } cuando } && cuando != _cola.Marca(MarcaSolicitud)
            ? cuando
            : null;
    }
}
