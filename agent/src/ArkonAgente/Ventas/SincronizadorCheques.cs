using ArkonAgente.Cola;
using ArkonAgente.Configuracion;
using ArkonAgente.Diagnostico;
using ArkonAgente.SoftRestaurant;
using ArkonAgente.Sql;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Ventas;

/// <summary>Lo que el worker hace con los cheques en cada ciclo; los tests lo sustituyen.</summary>
internal interface ISincronizadorCheques
{
    /// <summary>
    /// Lee las cuentas cerradas y encola en <paramref name="cola"/> las que cambiaron. Devuelve
    /// la lectura como resultado de sonda: es la "última lectura" del heartbeat (nota de F1-025).
    /// </summary>
    Task<ResultadoSondeo> CicloAsync(ISoftRestaurantReader reader, ColaLocal cola, CancellationToken cancelacion);
}

/// <summary>
/// Las cuentas cerradas del POS hacia el panel (F1-022), sobre el contrato de cheques de F1-031.
/// </summary>
/// <remarks>
/// <para>
/// <b>Qué lee.</b> En cada ciclo, <c>sr_cheques.sql</c>: TODAS las cobradas o canceladas de
/// <c>tempcheques</c> (el turno en curso; SR las deja ahí hasta el corte) y las de <c>cheques</c>
/// con <c>folio</c> mayor que el cursor, más las ABIERTAS en <see cref="Relectura"/> (para ver una
/// cancelación posterior al corte). Ver docs/esquema-sr.md §2.
/// </para>
/// <para>
/// <b>Qué encola.</b> Sólo lo que cambió: la huella del <c>datos</c> de cada <c>folioSr</c> vive en
/// <c>cola.db</c> (<see cref="ColaCheques"/>). Tras el corte la misma cuenta reaparece en
/// <c>cheques</c> con otro <c>folio</c> interno pero igual <c>numcheque</c>: si nada cambió, no se
/// vuelve a mandar. Un <c>folioSr</c> que reaparece con OTRA apertura es un folio reusado: se
/// queda sin mandar y va al log como Error (pisaría una venta con otra en el API).
/// </para>
/// <para>
/// <b>Sólo con un usuario de solo lectura confirmado</b> (la misma revisión que catálogos). Con
/// permisos de escritura NO se leen tablas de operación (la opción conservadora del backlog).
/// </para>
/// <para>
/// Nunca lanza por una falla de SQL: la devuelve como sonda fallida. Una falla del SQLite propio sí
/// sube, y el worker la atrapa sin cortar el ciclo.
/// </para>
/// </remarks>
internal sealed class SincronizadorCheques : ISincronizadorCheques
{
    /// <summary>Se releen las cuentas de <c>cheques</c> abiertas en esta ventana (cancelaciones tardías).</summary>
    public static readonly TimeSpan Relectura = TimeSpan.FromHours(2);

    /// <summary>
    /// DECISION PROVISIONAL (nocturno): la primera lectura (y la que sigue a un cursor perdido) trae
    /// las cuentas de <c>cheques</c> cerradas en los últimos 7 días, no toda la historia del POS: leer
    /// años de ventas con un timeout de 5 s no cabe. Lo de antes no llega al panel.
    /// </summary>
    public static readonly TimeSpan Piso = TimeSpan.FromDays(7);

    public static readonly TimeSpan RevisionPermisos = TimeSpan.FromMinutes(15);

    /// <summary>
    /// Ciclos seguidos que una cuenta de <c>cheques</c> puede llegar incompleta antes de que el cursor
    /// deje de esperarla (~10 min con el intervalo de 30 s). Una cuenta a medio escribir se arregla en
    /// uno o dos ciclos; una que nunca cuadra (una variante de SR no vista) atoraría el cursor y haría
    /// crecer cada lectura hasta el timeout. Pasado el tope va al log como Error y el cursor sigue.
    /// El conteo vive en memoria: un reinicio del servicio vuelve a esperar los 20 ciclos.
    /// </summary>
    public const int MaxCiclosIncompleta = 20;

    private readonly ColaCheques _estado;
    private readonly Func<ISoftRestaurantReader, ILectorCheques> _crearLector;
    private readonly ConfiguracionAgente _config;
    private readonly TimeProvider _reloj;
    private readonly TimeZoneInfo _zonaSr;
    private readonly ILogger _logger;

    private ISoftRestaurantReader? _readerDelLector;
    private ILectorCheques? _lector;
    private DateTimeOffset _permisosHasta = DateTimeOffset.MinValue;
    private string? _bloqueoPermisos;
    private string? _ultimoErrorLectura;
    private DateTimeOffset _ultimaPurga = DateTimeOffset.MinValue;
    private HashSet<string> _avisosDelCicloAnterior = new(StringComparer.Ordinal);
    private HashSet<string> _avisosDeEsteCiclo = new(StringComparer.Ordinal);
    private Dictionary<long, int> _ciclosIncompleta = [];

    public SincronizadorCheques(
        ColaCheques estado,
        Func<ISoftRestaurantReader, ILectorCheques> crearLector,
        ConfiguracionAgente config,
        TimeProvider reloj,
        TimeZoneInfo zonaSr,
        ILogger logger)
    {
        _estado = estado;
        _crearLector = crearLector;
        _config = config;
        _reloj = reloj;
        _zonaSr = zonaSr;
        _logger = logger;
    }

    /// <summary>
    /// El de verdad: el estado en <c>cola.db</c> y la zona de Windows de la PC del POS, que es en la
    /// que SR guarda sus fechas (sin zona).
    /// </summary>
    public static SincronizadorCheques DeVerdad(RutasAgente rutas, ConfiguracionAgente config, ILogger logger)
    {
        var conexion = new ConexionSoftRestaurant(config.ConnectionString);
        return new SincronizadorCheques(
            ColaCheques.Abrir(rutas.ArchivoCola, TimeProvider.System), reader => new LectorChequesSr(conexion, reader),
            config, TimeProvider.System, TimeZoneInfo.Local, logger);
    }

    public async Task<ResultadoSondeo> CicloAsync(ISoftRestaurantReader reader, ColaLocal cola, CancellationToken cancelacion)
    {
        if (!ReferenceEquals(reader, _readerDelLector))
        {
            _lector = _crearLector(reader);
            _readerDelLector = reader;
        }

        var ahora = _reloj.GetUtcNow();
        if (await BloqueadoPorPermisosAsync(_lector!, ahora, cancelacion) is { } bloqueo)
        {
            return ResultadoSondeo.Falla(ahora, bloqueo);
        }

        var ultimo = _estado.UltimoFolio();
        var local = TimeZoneInfo.ConvertTime(ahora, _zonaSr).DateTime;
        LecturaCheques lectura;
        try
        {
            lectura = await _lector!.LeerAsync(new VentanaCheques(ultimo, local - Piso, local - Relectura), cancelacion);
        }
        catch (OperationCanceledException) when (cancelacion.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Timeout de SQL, una columna que no está, un tipo que no convierte: falla de ESTA lectura.
            // No se encola nada y el cursor no se mueve; se reintenta en el siguiente ciclo.
            var mensaje = ex is SqlException sql
                ? VerificacionSql.ClasificarError(sql, new ConexionSoftRestaurant(_config.ConnectionString)).Detalle
                : $"({ex.GetType().Name})";
            if (mensaje != _ultimoErrorLectura)
            {
                _ultimoErrorLectura = mensaje;
                _logger.LogError(
                    "Cheques: no se pudieron leer las cuentas cerradas en SoftRestaurant {Mensaje}. Se reintenta en el " +
                    "siguiente ciclo.", mensaje);
            }

            return ResultadoSondeo.Falla(ahora, $"No se pudieron leer las ventas de SoftRestaurant {mensaje}");
        }

        if (_ultimoErrorLectura is not null)
        {
            _logger.LogInformation("Cheques: SoftRestaurant vuelve a responder a la lectura de ventas.");
            _ultimoErrorLectura = null;
        }

        var mapeo = MapeoCheques.Mapear(lectura.Cuentas, lectura.Partidas, lectura.Pagos, _zonaSr);
        _avisosDeEsteCiclo = new HashSet<string>(StringComparer.Ordinal);
        foreach (var aviso in mapeo.Avisos)
        {
            RegistrarUnaVez(LogLevel.Warning, aviso);
        }

        foreach (var error in mapeo.Errores)
        {
            RegistrarUnaVez(LogLevel.Error, error);
        }

        int encolados = 0, sinCambio = 0;
        var tocados = new List<string>();
        foreach (var cheque in mapeo.Cheques)
        {
            var visto = _estado.Visto(cheque.FolioSr);
            if (visto is not null && visto.AbiertoLocal != cheque.AbiertoLocal)
            {
                RegistrarUnaVez(
                    LogLevel.Error,
                    $"El folio {cheque.FolioSr} ya se mandó para una cuenta abierta el {visto.AbiertoLocal} y ahora " +
                    $"aparece en otra abierta el {cheque.AbiertoLocal}: NO se manda (pisaría la venta anterior en el panel). " +
                    "SoftRestaurant reusó el folio; ver docs/esquema-sr.md §2.");
                continue;
            }

            if (visto?.Huella == cheque.Huella)
            {
                sinCambio++;
                tocados.Add(cheque.FolioSr);
                continue;
            }

            cola.Encolar(TipoEvento.Cheque, cheque.Payload);
            _estado.GuardarVisto(cheque.FolioSr, new ChequeVisto(cheque.AbiertoLocal, cheque.Huella));
            encolados++;
        }

        _estado.Tocar(tocados);
        AvanzarCursor(ultimo, lectura, mapeo);
        _avisosDelCicloAnterior = _avisosDeEsteCiclo;
        if (ahora - _ultimaPurga >= TimeSpan.FromDays(1))
        {
            _estado.Purgar();
            _ultimaPurga = ahora;
        }

        if (encolados > 0)
        {
            _logger.LogInformation(
                "Cheques: leídas {Cuentas} cuenta(s) cerrada(s) en {Ms} ms; encoladas {Encolados}, sin cambios {SinCambio}.",
                lectura.Cuentas.Count, lectura.Milisegundos, encolados, sinCambio);
        }

        return ResultadoSondeo.Exito(ahora, (int)Math.Min(lectura.Milisegundos, int.MaxValue));
    }

    private async Task<string?> BloqueadoPorPermisosAsync(ILectorCheques lector, DateTimeOffset ahora, CancellationToken cancelacion)
    {
        if (ahora < _permisosHasta)
        {
            return _bloqueoPermisos;
        }

        var permisos = await lector.RevisarPermisosAsync(cancelacion);
        // Sólo un "puede escribir" CONFIRMADO espera 15 min. Si la revisión misma falló (un timeout),
        // este ciclo no lee y el siguiente vuelve a revisar: un tropiezo no deja sin ventas 15 min.
        _permisosHasta = permisos.NoSeSupo ? ahora : ahora + RevisionPermisos;
        if (permisos.SoloLectura)
        {
            if (_bloqueoPermisos is not null)
            {
                _logger.LogInformation("Cheques: el usuario SQL ya es de solo lectura; se leen las ventas.");
            }

            _bloqueoPermisos = null;
            return null;
        }

        var bloqueo =
            $"No se leen las ventas de SoftRestaurant: {permisos.Mensaje} El agente sólo lee las tablas de operación " +
            "con un usuario de SOLO LECTURA confirmado (ver 'agente test').";
        if (bloqueo != _bloqueoPermisos)
        {
            _logger.LogError("Cheques: {Bloqueo} Se vuelve a revisar en {Minutos} min.", bloqueo, RevisionPermisos.TotalMinutes);
        }

        _bloqueoPermisos = bloqueo;
        return bloqueo;
    }

    /// <summary>
    /// El cursor avanza al mayor <c>cheques.folio</c> leído, sin pasar de una cuenta que llegó
    /// incompleta (se tiene que releer). Si <c>cheques.folio</c> volvió a empezar (su máximo es menor
    /// que el cursor), el cursor se pierde y la siguiente lectura usa el <see cref="Piso"/>.
    /// </summary>
    private void AvanzarCursor(long ultimo, LecturaCheques lectura, ChequesMapeados mapeo)
    {
        if (lectura.MaxFolio is { } maximo && maximo < ultimo)
        {
            RegistrarUnaVez(
                LogLevel.Warning,
                $"cheques.folio volvió a empezar (el mayor es {maximo} y el agente había leído hasta {ultimo}): se " +
                $"vuelven a leer las cuentas de los últimos {Piso.TotalDays} días.");
            _estado.GuardarUltimoFolio(-1);
            return;
        }

        var leidos = lectura.Cuentas.Where(c => c.Origen == OrigenCuenta.Definitiva).Select(c => c.Folio).ToList();
        if (leidos.Count == 0)
        {
            return;
        }

        var nuevo = leidos.Max();
        var pendientes = new List<long>();
        var ciclos = new Dictionary<long, int>();
        foreach (var folio in mapeo.Releer.Where(r => r.Origen == OrigenCuenta.Definitiva).Select(r => r.Folio))
        {
            ciclos[folio] = _ciclosIncompleta.GetValueOrDefault(folio) + 1;
            if (ciclos[folio] < MaxCiclosIncompleta)
            {
                pendientes.Add(folio);
            }
            else
            {
                RegistrarUnaVez(
                    LogLevel.Error,
                    $"La cuenta cheques.folio {folio} lleva {MaxCiclosIncompleta} lecturas seguidas incompleta (sin " +
                    "partidas, o sus pagos no suman el total): el cursor deja de esperarla y NO se manda. Revisarla en " +
                    "SoftRestaurant; ver docs/esquema-sr.md §2.");
            }
        }

        _ciclosIncompleta = ciclos;
        if (pendientes.Count > 0)
        {
            nuevo = Math.Min(nuevo, pendientes.Min() - 1);
        }

        if (nuevo > ultimo)
        {
            _estado.GuardarUltimoFolio(nuevo);
        }
    }

    /// <summary>
    /// Un aviso se repite cada ciclo mientras la cuenta siga en SR: al log sólo va el que no salió en el
    /// ciclo anterior. Si la causa desaparece y vuelve, se registra otra vez.
    /// </summary>
    private void RegistrarUnaVez(LogLevel nivel, string mensaje)
    {
        _avisosDeEsteCiclo.Add(mensaje);
        if (!_avisosDelCicloAnterior.Contains(mensaje))
        {
            _logger.Log(nivel, "Cheques: {Mensaje}", mensaje);
        }
    }
}
