using ArkonAgente.Catalogos;
using ArkonAgente.Cola;
using ArkonAgente.Configuracion;
using ArkonAgente.Diagnostico;
using ArkonAgente.SoftRestaurant;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Inventario;

/// <summary>Lo que el worker hace con las existencias en cada ciclo; los tests lo sustituyen.</summary>
internal interface ISincronizadorExistencias : IDisposable
{
    /// <summary>Con el reader ya elegido: decide si toca leer, encola las fotos y vacía su carril.</summary>
    Task CicloAsync(ISoftRestaurantReader reader, CancellationToken cancelacion);
}

/// <summary>
/// Las existencias del POS hacia el panel (F2-241), sobre el contrato de F2-121: cada
/// <see cref="Intervalo"/>, la foto completa de CADA almacén.
/// </summary>
/// <remarks>
/// <para>
/// <b>Cuándo lee.</b> Al arrancar si nunca ha leído, y luego cuando pasan <see cref="Intervalo"/>
/// desde la última lectura buena (la marca vive en el SQLite, así que un reinicio no relee antes de
/// tiempo). Una lectura que falla —timeout incluido— no manda NADA (nunca una foto vacía: vaciaría
/// el almacén en el panel), queda en el log una vez por mensaje distinto y se reintenta en
/// <see cref="EsperaReintento"/>. El panel marca "atrasada" una foto recibida hace más de 90 min.
/// </para>
/// <para>
/// <b>Sólo con un usuario de solo lectura confirmado</b>, con la misma revisión que catálogos
/// (<c>diagnostico.sql</c>, que incluye las tablas de esta consulta).
/// </para>
/// <para>
/// <b>Qué manda.</b> Cada lectura buena encola una foto por almacén con <c>capturadoAt</c> = cuándo
/// EMPEZÓ la lectura (UTC). No hay hash: se manda aunque no cambie, porque la foto también dice "sigo
/// leyendo". Un almacén con más de 5000 registros no se manda (Error en el log: cambio de contrato).
/// </para>
/// <para>
/// Nunca lanza, salvo la parada del servicio o una falla del SQLite propio; el worker lo envuelve
/// igual que a los catálogos.
/// </para>
/// </remarks>
internal sealed class SincronizadorExistencias : ISincronizadorExistencias
{
    public static readonly TimeSpan Intervalo = TimeSpan.FromMinutes(30);
    public static readonly TimeSpan EsperaReintento = TimeSpan.FromMinutes(15);

    internal const string MarcaUltimaLectura = "existencias.ultima_lectura";

    private readonly ColaExistencias _cola;
    private readonly EnviadorExistencias _envio;
    private readonly Func<ISoftRestaurantReader, ILectorExistencias> _crearLector;
    private readonly ConfiguracionAgente _config;
    private readonly TimeProvider _reloj;
    private readonly ILogger _logger;

    private ISoftRestaurantReader? _readerDelLector;
    private ILectorExistencias? _lector;
    private DateTimeOffset _reintentarDesde = DateTimeOffset.MinValue;
    private string? _ultimoMensajePermisos;
    private string? _ultimoErrorLectura;

    public SincronizadorExistencias(
        ColaExistencias cola,
        EnviadorExistencias envio,
        Func<ISoftRestaurantReader, ILectorExistencias> crearLector,
        ConfiguracionAgente config,
        TimeProvider reloj,
        ILogger logger)
    {
        _cola = cola;
        _envio = envio;
        _crearLector = crearLector;
        _config = config;
        _reloj = reloj;
        _logger = logger;
    }

    /// <summary>El de verdad: <c>cola.db</c> de la carpeta del agente y el API de la config.</summary>
    public static SincronizadorExistencias DeVerdad(RutasAgente rutas, ConfiguracionAgente config, ILogger logger)
    {
        var cola = ColaExistencias.Abrir(rutas.ArchivoCola, TimeProvider.System);
        var conexion = new Sql.ConexionSoftRestaurant(config.ConnectionString);
        return new SincronizadorExistencias(
            cola, new EnviadorExistencias(cola, config, logger, TimeProvider.System),
            reader => new LectorExistenciasSr(conexion, reader), config, TimeProvider.System, logger);
    }

    public void Dispose() => _envio.Dispose();

    public async Task CicloAsync(ISoftRestaurantReader reader, CancellationToken cancelacion)
    {
        if (!ReferenceEquals(reader, _readerDelLector))
        {
            _lector = _crearLector(reader);
            _readerDelLector = reader;
        }

        if (Toca(_reloj.GetUtcNow()))
        {
            await LeerAsync(_lector!, cancelacion);
        }

        await _envio.CicloAsync(cancelacion);
    }

    private bool Toca(DateTimeOffset ahora)
    {
        if (ahora < _reintentarDesde)
        {
            return false;
        }

        return _cola.Marca(MarcaUltimaLectura) is not { } marca
               || ahora >= ColaExistencias.LeerFecha(marca) + Intervalo
               // Un reloj corrido hacia atrás no deja al agente sin leer hasta alcanzar la marca.
               || ColaExistencias.LeerFecha(marca) > ahora + TimeSpan.FromMinutes(5);
    }

    private async Task LeerAsync(ILectorExistencias lector, CancellationToken cancelacion)
    {
        var permisos = await lector.RevisarPermisosAsync(cancelacion);
        if (!permisos.SoloLectura)
        {
            _reintentarDesde = _reloj.GetUtcNow() + EsperaReintento;
            if (permisos.Mensaje != _ultimoMensajePermisos)
            {
                _ultimoMensajePermisos = permisos.Mensaje;
                _logger.LogError(
                    "Existencias: no se leen existencias de SoftRestaurant. {Mensaje} El agente sólo lee el POS con un " +
                    "usuario de SOLO LECTURA confirmado (ver 'agente test'). Se vuelve a revisar en {Minutos} min.",
                    permisos.Mensaje, EsperaReintento.TotalMinutes);
            }

            return;
        }

        _ultimoMensajePermisos = null;
        var capturadoAt = _reloj.GetUtcNow();
        LecturaExistencias lectura;
        try
        {
            lectura = await lector.LeerAsync(cancelacion);
        }
        catch (OperationCanceledException) when (cancelacion.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Cualquier excepción (timeout de SQL, una columna que no está, un tipo que no convierte)
            // es falla de ESTA lectura: no se manda nada —ni una foto vacía— y se reintenta sola.
            _reintentarDesde = _reloj.GetUtcNow() + EsperaReintento;
            var mensaje = ex is SqlException sql
                ? VerificacionSql.ClasificarError(sql, new Sql.ConexionSoftRestaurant(_config.ConnectionString)).Detalle
                : $"({ex.GetType().Name})";
            if (mensaje != _ultimoErrorLectura)
            {
                _ultimoErrorLectura = mensaje;
                _logger.LogError(
                    "Existencias: no se pudieron leer las existencias en SoftRestaurant {Mensaje}. No se manda ninguna " +
                    "foto (el panel conserva la última); se reintenta en {Minutos} min.",
                    mensaje, EsperaReintento.TotalMinutes);
            }

            return;
        }

        _ultimoErrorLectura = null;
        _reintentarDesde = DateTimeOffset.MinValue;
        var leidas = lectura.Leidas;
        foreach (var aviso in leidas.Avisos)
        {
            _logger.LogWarning("Existencias: {Aviso}", aviso);
        }

        foreach (var (almacen, registros) in leidas.Excedidas)
        {
            _logger.LogError(
                "Existencias: el almacén {Almacen} tiene {Registros} registros y una foto admite a lo más {Tope}: NO se " +
                "manda (el panel conserva su última foto). Hace falta paginar la foto, que es un cambio de contrato.",
                almacen, registros, MapeoExistencias.MaxRegistrosPorFoto);
        }

        var instante = MapeoExistencias.Instante(capturadoAt);
        _cola.Guardar(leidas.Fotos.Select(f =>
            new EnvioExistencias(f.Almacen, instante, f.Registros.Count, MapeoExistencias.Payload(f, capturadoAt))));
        _cola.GuardarMarca(MarcaUltimaLectura, ColaLocal.Formatear(capturadoAt));
        _logger.LogInformation(
            "Existencias: leídas en SoftRestaurant en {Ms} ms: {Almacenes} almacén(es), {Registros} registro(s) " +
            "({Filas} fila(s)); encoladas {Fotos} foto(s).",
            lectura.Milisegundos, leidas.Fotos.Count + leidas.Excedidas.Count,
            leidas.Fotos.Sum(f => f.Registros.Count) + leidas.Excedidas.Sum(e => e.Registros), leidas.FilasSql,
            leidas.Fotos.Count);
    }
}
