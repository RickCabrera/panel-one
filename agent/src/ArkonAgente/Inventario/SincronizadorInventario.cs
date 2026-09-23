using System.Text;
using ArkonAgente.Catalogos;
using ArkonAgente.Cola;
using ArkonAgente.Configuracion;
using ArkonAgente.Diagnostico;
using ArkonAgente.SoftRestaurant;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Inventario;

/// <summary>Lo que el worker hace con movimientos, compras y recetas en cada ciclo; los tests lo sustituyen.</summary>
internal interface ISincronizadorInventario : IDisposable
{
    /// <summary>Con el reader ya elegido: lee lo que toque de cada tipo, encola y vacía su carril.</summary>
    Task CicloAsync(ISoftRestaurantReader reader, CancellationToken cancelacion);
}

/// <summary>
/// Movimientos (pólizas), compras y recetas del POS hacia el panel (F2-241b), sobre los contratos de
/// F2-122, F2-126 y F2-125. Un <see cref="SincronizadorDocumentos"/> por tipo y un solo enviador.
/// </summary>
internal sealed class SincronizadorInventario : ISincronizadorInventario
{
    private readonly IReadOnlyList<SincronizadorDocumentos> _tipos;
    private readonly EnviadorInventario _envio;
    private readonly Func<ISoftRestaurantReader, ILectorDocumentos> _crearLector;
    private ISoftRestaurantReader? _readerDelLector;
    private ILectorDocumentos? _lector;

    public SincronizadorInventario(
        ColaInventario cola,
        EnviadorInventario envio,
        Func<ISoftRestaurantReader, ILectorDocumentos> crearLector,
        ConfiguracionAgente config,
        TimeZoneInfo zona,
        TimeProvider reloj,
        ILogger logger)
    {
        _envio = envio;
        _crearLector = crearLector;
        _tipos = TiposDocumentoInventario.Todos
            .Select(t => new SincronizadorDocumentos(t, cola, config, zona, reloj, logger))
            .ToList();
    }

    /// <summary>El de verdad: <c>cola.db</c> de la carpeta del agente, el API de la config y la hora de Windows.</summary>
    public static SincronizadorInventario DeVerdad(RutasAgente rutas, ConfiguracionAgente config, ILogger logger)
    {
        var cola = ColaInventario.Abrir(rutas.ArchivoCola, TimeProvider.System);
        var conexion = new Sql.ConexionSoftRestaurant(config.ConnectionString);
        return new SincronizadorInventario(
            cola, new EnviadorInventario(cola, config, logger, TimeProvider.System),
            reader => new LectorDocumentosSr(conexion, reader, TimeZoneInfo.Local), config, TimeZoneInfo.Local,
            TimeProvider.System, logger);
    }

    public void Dispose() => _envio.Dispose();

    public async Task CicloAsync(ISoftRestaurantReader reader, CancellationToken cancelacion)
    {
        if (!ReferenceEquals(reader, _readerDelLector))
        {
            _lector = _crearLector(reader);
            _readerDelLector = reader;
        }

        foreach (var tipo in _tipos)
        {
            await tipo.CicloAsync(_lector!, cancelacion);
        }

        await _envio.CicloAsync(cancelacion);
    }
}

/// <summary>
/// La lectura de UN tipo de documento: cuándo leer, qué ventana, qué encolar y qué avisar al panel que
/// desapareció.
/// </summary>
/// <remarks>
/// <para>
/// <b>Cuándo.</b> Al arrancar si nunca ha leído, y luego cada <see cref="Intervalo"/> (la marca vive en el
/// SQLite: un reinicio no relee antes). DECISION PROVISIONAL (nocturno): movimientos cada 15 min,
/// compras cada 30, recetas cada 60. Una lectura que falla —timeout incluido— no encola NADA ni mueve el
/// cursor, queda en el log una vez por mensaje distinto y se reintenta en <see cref="EsperaReintento"/>.
/// Sólo con un usuario de SOLO LECTURA confirmado.
/// </para>
/// <para>
/// <b>Cursor y ventana</b> (movimientos y compras; SR no tiene PK ni rowversion en <c>movsinv</c>). El
/// cursor es la fecha de SR más nueva que se ha visto (hora local de SR), guardada en el SQLite: sobrevive
/// reinicios y la siguiente lectura parte de él, no del principio. DECISION PROVISIONAL (nocturno):
/// <list type="bullet">
/// <item>vivos desde <c>cursor − 3 días</c> (movimientos) o <c>− 35 días</c> (compras): la ventana de
/// relectura que capta correcciones tardías;</item>
/// <item>cancelados de movimientos desde <c>cursor − 35 días</c> (no se sabe si la fila cancelada
/// conserva la fecha original);</item>
/// <item>sin cursor (primera vez): los últimos 35 días (no se recorre toda la historia);</item>
/// <item>el cursor nunca pasa de "ahora en SR + 5 min": una fila con fecha futura (tecleada mal, reloj
/// adelantado) no congela la lectura. Se avisa.</item>
/// </list>
/// </para>
/// <para>
/// <b>Qué se encola.</b> Sólo lo nuevo o cambiado (hash contra el SQLite), completo. Un documento guardado
/// cuya fecha más nueva está dentro de la ventana de vivos y ya no vino se manda con su variante ausente
/// (<c>cancelada=true</c>; receta con <c>renglones: []</c>) una vez. Lo que sale de la ventana amplia se
/// purga del estado. Lotes partidos por documentos y por renglones EN TOTAL según el contrato.
/// </para>
/// <para>
/// <b>Freno.</b> DECISION PROVISIONAL (nocturno): si desaparecen de golpe ≥ <see cref="FrenoMinimo"/>
/// documentos y son más de la mitad de los guardados en la ventana, esa lectura no encola nada ni mueve
/// el cursor (Error en el log): puede ser una base restaurada o equivocada. Si es legítimo (p. ej. se
/// borraron todas las recetas), el lector se queda detenido para ese tipo hasta que alguien lo destrabe
/// (ver docs/esquema-sr.md §10).
/// </para>
/// </remarks>
internal sealed class SincronizadorDocumentos
{
    public static readonly TimeSpan EsperaReintento = TimeSpan.FromMinutes(15);
    public static readonly TimeSpan HistoriaInicial = TimeSpan.FromDays(35);
    public static readonly TimeSpan VentanaCanceladas = TimeSpan.FromDays(35);
    public static readonly TimeSpan ToleranciaFuturo = TimeSpan.FromMinutes(5);
    public const int FrenoMinimo = 5;
    public const int LargoMaximoClave = 64;

    private readonly TipoDocumentoInventario _tipo;
    private readonly ColaInventario _cola;
    private readonly ConfiguracionAgente _config;
    private readonly TimeZoneInfo _zona;
    private readonly TimeProvider _reloj;
    private readonly ILogger _logger;
    private readonly string _nombre;

    private DateTimeOffset _reintentarDesde = DateTimeOffset.MinValue;
    private string? _ultimoMensajePermisos;
    private string? _ultimoError;
    private string? _ultimosAvisos;

    public SincronizadorDocumentos(
        TipoDocumentoInventario tipo, ColaInventario cola, ConfiguracionAgente config, TimeZoneInfo zona,
        TimeProvider reloj, ILogger logger)
    {
        _tipo = tipo;
        _cola = cola;
        _config = config;
        _zona = zona;
        _reloj = reloj;
        _logger = logger;
        _nombre = char.ToUpperInvariant(tipo.Texto()[0]) + tipo.Texto()[1..];
    }

    public static TimeSpan Intervalo(TipoDocumentoInventario tipo) => tipo switch
    {
        TipoDocumentoInventario.Movimientos => TimeSpan.FromMinutes(15),
        TipoDocumentoInventario.Compras => TimeSpan.FromMinutes(30),
        _ => TimeSpan.FromMinutes(60),
    };

    public static TimeSpan VentanaVivos(TipoDocumentoInventario tipo) =>
        tipo == TipoDocumentoInventario.Movimientos ? TimeSpan.FromDays(3) : TimeSpan.FromDays(35);

    internal static string MarcaUltimaLectura(TipoDocumentoInventario tipo) => tipo.Texto() + ".ultima_lectura";

    internal static string MarcaCursor(TipoDocumentoInventario tipo) => tipo.Texto() + ".cursor";

    public async Task CicloAsync(ILectorDocumentos lector, CancellationToken cancelacion)
    {
        var ahora = _reloj.GetUtcNow();
        if (ahora < _reintentarDesde || !Toca(ahora))
        {
            return;
        }

        var permisos = await lector.RevisarPermisosAsync(cancelacion);
        if (!permisos.SoloLectura)
        {
            _reintentarDesde = _reloj.GetUtcNow() + EsperaReintento;
            if (permisos.Mensaje != _ultimoMensajePermisos)
            {
                _ultimoMensajePermisos = permisos.Mensaje;
                _logger.LogError(
                    "{Tipo}: no se leen de SoftRestaurant. {Mensaje} El agente sólo lee el POS con un usuario de SOLO " +
                    "LECTURA confirmado (ver 'agente test'). Se vuelve a revisar en {Minutos} min.",
                    _nombre, permisos.Mensaje, EsperaReintento.TotalMinutes);
            }

            return;
        }

        _ultimoMensajePermisos = null;
        var leidoAt = _reloj.GetUtcNow();
        var ahoraSr = TimeZoneInfo.ConvertTime(leidoAt, _zona).DateTime;
        var tope = ahoraSr + ToleranciaFuturo;
        var cursor = _cola.Marca(MarcaCursor(_tipo)) is { } texto ? ApoyoMapeo.LeerFechaSr(texto) : (DateTime?)null;
        if (cursor > tope)
        {
            cursor = tope; // reloj movido hacia atrás o cursor viejo con fecha futura
        }

        var ventana = _tipo.ConVentana()
            ? cursor is { } c
                ? new VentanaLectura(c - VentanaVivos(_tipo), c - VentanaCanceladas)
                : new VentanaLectura(ahoraSr - HistoriaInicial, ahoraSr - HistoriaInicial)
            : null;

        LecturaDocumentos lectura;
        try
        {
            lectura = await lector.LeerAsync(_tipo, ventana, cancelacion);
        }
        catch (OperationCanceledException) when (cancelacion.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Cualquier excepción (timeout de SQL, columna que no está, tipo que no convierte) es falla de
            // ESTA lectura: no se encola nada (nada de "desapareció todo") ni se mueve el cursor.
            _reintentarDesde = _reloj.GetUtcNow() + EsperaReintento;
            var mensaje = ex is SqlException sql
                ? VerificacionSql.ClasificarError(sql, new Sql.ConexionSoftRestaurant(_config.ConnectionString)).Detalle
                : $"({ex.GetType().Name})";
            Error($"no se pudieron leer en SoftRestaurant {mensaje}. No se encola nada y el cursor no se mueve; se " +
                  $"reintenta en {EsperaReintento.TotalMinutes:0} min.");
            return;
        }

        _reintentarDesde = DateTimeOffset.MinValue;
        Procesar(lectura, leidoAt, ahoraSr, tope, cursor, ventana);
    }

    private bool Toca(DateTimeOffset ahora)
    {
        return _cola.Marca(MarcaUltimaLectura(_tipo)) is not { } marca
               || ahora >= ColaExistencias.LeerFecha(marca) + Intervalo(_tipo)
               || ColaExistencias.LeerFecha(marca) > ahora + TimeSpan.FromMinutes(5);
    }

    private void Procesar(
        LecturaDocumentos lectura, DateTimeOffset leidoAt, DateTime ahoraSr, DateTime tope, DateTime? cursor,
        VentanaLectura? ventana)
    {
        var leidos = lectura.Leidos;
        var avisos = leidos.Avisos.ToList();
        var errores = new List<string>();
        var vistos = new HashSet<string>(leidos.Omitidos, StringComparer.Ordinal);
        var mandables = new List<DocumentoInventario>();
        foreach (var d in leidos.Documentos)
        {
            vistos.Add(d.Clave);
            if (d.Clave.Length > LargoMaximoClave)
            {
                // No se trunca: dos documentos distintos quedarían con la misma clave.
                errores.Add($"un documento con una clave de {d.Clave.Length} caracteres (el contrato admite " +
                            $"{LargoMaximoClave}) no se manda.");
            }
            else if (d.Renglones > _tipo.MaxRenglones())
            {
                errores.Add($"el documento {d.Clave} tiene {d.Renglones} renglones y un lote admite a lo más " +
                            $"{_tipo.MaxRenglones()}: NO se manda (cambio de contrato).");
            }
            else
            {
                mandables.Add(d);
            }
        }

        var futuras = leidos.Documentos.Count(d => d.FechaVentana > tope);
        if (futuras > 0)
        {
            avisos.Add($"{futuras} documento(s) con fecha más de {ToleranciaFuturo.TotalMinutes:0} min en el futuro " +
                       "(¿fecha mal capturada o reloj del POS adelantado?): el panel los rechaza y el cursor no pasa de ahora.");
        }

        var estado = _cola.Estado(_tipo);
        bool EnVentana(EstadoDocumento e) =>
            ventana is null || (e.FechaVentana is { } f && f >= ventana.Desde);
        var enRango = estado.Where(e => EnVentana(e.Value)).ToList();
        var ausentes = enRango.Where(e => !vistos.Contains(e.Key)).ToList();

        if (ausentes.Count >= FrenoMinimo && ausentes.Count * 2 > enRango.Count)
        {
            _reintentarDesde = _reloj.GetUtcNow() + Intervalo(_tipo);
            Error($"la lectura devolvió {leidos.Documentos.Count} documento(s) y faltan {ausentes.Count} de los " +
                  $"{enRango.Count} que el agente ya mandó en la ventana. Parece una base restaurada o equivocada: NO se " +
                  "encola nada ni se mueve el cursor. Si de verdad se borraron en SoftRestaurant, ver docs/esquema-sr.md §10 " +
                  "(freno de desapariciones).");
            return;
        }

        var porEncolar = new List<(string Clave, string Json, int Renglones)>();
        var cambios = new List<CambioEstado>();
        foreach (var d in mandables)
        {
            var hash = ApoyoMapeo.Hash(d.Json);
            if (!estado.TryGetValue(d.Clave, out var previo) || previo.Hash != hash)
            {
                porEncolar.Add((d.Clave, d.Json, d.Renglones));
                cambios.Add(new CambioEstado(d.Clave, hash, d.FechaVentana, d.JsonAusente, RenglonesAusente(d)));
            }
        }

        var avisadas = 0;
        foreach (var (clave, e) in ausentes)
        {
            var hash = ApoyoMapeo.Hash(e.JsonAusente);
            if (e.Hash != hash)
            {
                avisadas++;
                porEncolar.Add((clave, e.JsonAusente, e.RenglonesAusente));
                cambios.Add(new CambioEstado(clave, hash, e.FechaVentana, e.JsonAusente, e.RenglonesAusente));
            }
        }

        var purgar = ventana is null
            ? []
            : estado.Where(e => !vistos.Contains(e.Key) && (e.Value.FechaVentana is not { } f || f < ventana.DesdeCanceladas))
                .Select(e => e.Key).ToList();

        var marcas = new List<(string, string)> { (MarcaUltimaLectura(_tipo), Cola.ColaLocal.Formatear(leidoAt)) };
        if (_tipo.ConVentana())
        {
            var maxima = leidos.FechaMaxima is { } m ? (m > tope ? tope : m) : (DateTime?)null;
            var nuevo = cursor is { } c ? (maxima > c ? maxima.Value : c) : maxima ?? ahoraSr - HistoriaInicial;
            marcas.Add((MarcaCursor(_tipo), ApoyoMapeo.FechaSrTexto(nuevo)));
        }

        var lotes = Empacar(porEncolar, MapeoExistencias.Instante(leidoAt));
        _cola.Aplicar(_tipo, lotes, cambios, purgar, marcas);

        _ultimoError = null;
        // Errores y avisos por documento se repetirían en cada lectura: van al log sólo cuando cambian.
        var firma = string.Join("\n", errores.Concat(avisos));
        if (firma != _ultimosAvisos)
        {
            _ultimosAvisos = firma;
            foreach (var error in errores)
            {
                _logger.LogError("{Tipo}: {Error}", _nombre, error);
            }

            foreach (var aviso in avisos)
            {
                _logger.LogWarning("{Tipo}: {Aviso}", _nombre, aviso);
            }
        }

        _logger.LogInformation(
            "{Tipo}: leídos en SoftRestaurant en {Ms} ms: {Documentos} documento(s) ({Filas} fila(s)); encolados {Encolados} " +
            "en {Lotes} lote(s), {Ausentes} que ya no están en SR.",
            _nombre, lectura.Milisegundos, leidos.Documentos.Count, leidos.FilasSql, porEncolar.Count, lotes.Count, avisadas);
    }

    /// <summary>
    /// Parte los documentos en lotes: a lo más <see cref="TiposDocumentoInventario.MaxDocumentos"/>
    /// documentos y <see cref="TiposDocumentoInventario.MaxRenglones"/> renglones EN TOTAL, en orden.
    /// </summary>
    private List<(string Payload, IReadOnlyList<string> Claves, int Renglones)> Empacar(
        List<(string Clave, string Json, int Renglones)> documentos, string leidoAt)
    {
        var lotes = new List<(string, IReadOnlyList<string>, int)>();
        var actual = new List<(string Clave, string Json, int Renglones)>();
        void Cerrar()
        {
            if (actual.Count == 0)
            {
                return;
            }

            var payload = new StringBuilder();
            payload.Append("{\"leidoAt\":\"").Append(leidoAt).Append("\",\"").Append(_tipo.Campo()).Append("\":[");
            payload.AppendJoin(',', actual.Select(d => d.Json));
            payload.Append("]}");
            lotes.Add((payload.ToString(), actual.Select(d => d.Clave).ToList(), actual.Sum(d => d.Renglones)));
            actual = [];
        }

        foreach (var d in documentos)
        {
            if (actual.Count == _tipo.MaxDocumentos() || actual.Sum(x => x.Renglones) + d.Renglones > _tipo.MaxRenglones())
            {
                Cerrar();
            }

            actual.Add(d);
        }

        Cerrar();
        return lotes;
    }

    /// <summary>Renglones de la variante ausente: la póliza o compra cancelada lleva sus partidas; la receta vacía, ninguno.</summary>
    private int RenglonesAusente(DocumentoInventario d) => _tipo == TipoDocumentoInventario.Recetas ? 0 : d.Renglones;

    private void Error(string mensaje)
    {
        if (mensaje != _ultimoError)
        {
            _ultimoError = mensaje;
            _logger.LogError("{Tipo}: {Mensaje}", _nombre, mensaje);
        }
    }
}
