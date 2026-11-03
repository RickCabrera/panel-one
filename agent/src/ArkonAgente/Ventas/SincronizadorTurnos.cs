using ArkonAgente.Cola;
using ArkonAgente.Configuracion;
using ArkonAgente.Diagnostico;
using ArkonAgente.SoftRestaurant;
using ArkonAgente.Sql;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Ventas;

/// <summary>Lo que el worker hace con los turnos en cada ciclo; los tests lo sustituyen.</summary>
internal interface ISincronizadorTurnos
{
    /// <summary>Con el reader ya elegido: lee los turnos y encola en <paramref name="cola"/> los que cambiaron.</summary>
    Task CicloAsync(ISoftRestaurantReader reader, ColaLocal cola, CancellationToken cancelacion);
}

/// <summary>
/// Los turnos (cortes de caja) del POS hacia el panel (MVP de cortes), como eventos <c>turno</c> de
/// <c>POST /ingesta/eventos</c>, por la MISMA cola local que los cheques: sin red o sin luz se quedan
/// en <c>cola.db</c> y salen al volver; el API los guarda con upsert por <c>(sucursal, turnoSr)</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Qué lee.</b> Cada ciclo, <c>sr_turnos.sql</c>: los turnos abiertos y los abiertos o cerrados en
/// los últimos <see cref="Ventana"/> (hora local de la PC del POS). La tabla tiene una fila por turno.
/// </para>
/// <para>
/// <b>Qué encola.</b> Sólo lo que cambió desde lo último que encoló: la huella del <c>datos</c> por
/// <c>turnoSr</c> vive EN MEMORIA. DECISION PROVISIONAL (nocturno): tras reiniciar el servicio se
/// vuelven a encolar los turnos de la ventana (unos cuantos), y el API los deja iguales (reenvío
/// idéntico = no escribe). Un <c>turnoSr</c> que reaparece con OTRA apertura (SR reusó el número) no
/// se manda y va al log como Error: pisaría el corte anterior en el panel.
/// </para>
/// <para>
/// <b>Sólo con un usuario de solo lectura confirmado</b>, como cheques y mesas.
/// </para>
/// <para>
/// Nunca lanza por una falla de SQL: la registra (una vez por mensaje) y reintenta el siguiente ciclo.
/// Una falla del SQLite propio sí sube; el worker la atrapa sin cortar el ciclo.
/// </para>
/// </remarks>
internal sealed class SincronizadorTurnos : ISincronizadorTurnos
{
    /// <summary>Un turno cerrado hace más de esto ya no cambia: no se relee.</summary>
    public static readonly TimeSpan Ventana = TimeSpan.FromDays(7);

    public static readonly TimeSpan RevisionPermisos = TimeSpan.FromMinutes(15);

    private readonly Func<ISoftRestaurantReader, ILectorTurnos> _crearLector;
    private readonly ConfiguracionAgente _config;
    private readonly TimeProvider _reloj;
    private readonly TimeZoneInfo _zonaSr;
    private readonly ILogger _logger;
    private readonly Dictionary<string, (string AperturaLocal, string Huella)> _encolados = new(StringComparer.Ordinal);

    private ISoftRestaurantReader? _readerDelLector;
    private ILectorTurnos? _lector;
    private DateTimeOffset _permisosHasta = DateTimeOffset.MinValue;
    private string? _ultimoError;
    private HashSet<string> _avisosDelCicloAnterior = new(StringComparer.Ordinal);
    private HashSet<string> _avisosDeEsteCiclo = new(StringComparer.Ordinal);

    public SincronizadorTurnos(
        Func<ISoftRestaurantReader, ILectorTurnos> crearLector,
        ConfiguracionAgente config,
        TimeProvider reloj,
        TimeZoneInfo zonaSr,
        ILogger logger)
    {
        _crearLector = crearLector;
        _config = config;
        _reloj = reloj;
        _zonaSr = zonaSr;
        _logger = logger;
    }

    /// <summary>El de verdad: el SQL Server de la config y la zona de Windows de la PC del POS.</summary>
    public static SincronizadorTurnos DeVerdad(ConfiguracionAgente config, ILogger logger)
    {
        var conexion = new ConexionSoftRestaurant(config.ConnectionString);
        return new SincronizadorTurnos(
            reader => new LectorTurnosSr(conexion, reader), config, TimeProvider.System, TimeZoneInfo.Local, logger);
    }

    public async Task CicloAsync(ISoftRestaurantReader reader, ColaLocal cola, CancellationToken cancelacion)
    {
        if (!ReferenceEquals(reader, _readerDelLector))
        {
            _lector = _crearLector(reader);
            _readerDelLector = reader;
            _permisosHasta = DateTimeOffset.MinValue;
        }

        var ahora = _reloj.GetUtcNow();
        if (ahora >= _permisosHasta)
        {
            var permisos = await _lector!.RevisarPermisosAsync(cancelacion);
            if (!permisos.SoloLectura)
            {
                // Un "no se supo" se vuelve a revisar el siguiente ciclo; un "puede escribir", en 15 min.
                _permisosHasta = permisos.NoSeSupo ? ahora : ahora + RevisionPermisos;
                Fallar(
                    $"Turnos: no se leen los turnos de SoftRestaurant. {permisos.Mensaje} El agente sólo lee el POS " +
                    "con un usuario de SOLO LECTURA confirmado (ver 'agente test').");
                return;
            }

            _permisosHasta = ahora + RevisionPermisos;
        }

        var local = TimeZoneInfo.ConvertTime(ahora, _zonaSr).DateTime;
        LecturaTurnos lectura;
        try
        {
            lectura = await _lector!.LeerAsync(local - Ventana, cancelacion);
        }
        catch (OperationCanceledException) when (cancelacion.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            var detalle = ex is SqlException sql
                ? VerificacionSql.ClasificarError(sql, new ConexionSoftRestaurant(_config.ConnectionString)).Detalle
                : $"({ex.GetType().Name})";
            Fallar($"Turnos: no se pudieron leer en SoftRestaurant {detalle}. Se reintenta en el siguiente ciclo.");
            return;
        }

        if (_ultimoError is not null)
        {
            _logger.LogInformation("Turnos: SoftRestaurant vuelve a responder a la lectura de turnos.");
            _ultimoError = null;
        }

        var mapeo = MapeoTurnos.Mapear(lectura.Filas, _zonaSr);
        _avisosDeEsteCiclo = new HashSet<string>(StringComparer.Ordinal);
        foreach (var aviso in mapeo.Avisos)
        {
            RegistrarUnaVez(LogLevel.Warning, aviso);
        }

        var encolados = 0;
        foreach (var turno in mapeo.Turnos)
        {
            if (_encolados.TryGetValue(turno.TurnoSr, out var previo))
            {
                if (previo.AperturaLocal != turno.AperturaLocal)
                {
                    RegistrarUnaVez(
                        LogLevel.Error,
                        $"El turno {turno.TurnoSr} ya se mandó con apertura {previo.AperturaLocal} y ahora aparece con " +
                        $"apertura {turno.AperturaLocal}: NO se manda (pisaría el corte anterior en el panel). " +
                        "SoftRestaurant reusó el número de turno; ver docs/esquema-sr.md §2.");
                    continue;
                }

                if (previo.Huella == turno.Huella)
                {
                    continue;
                }
            }

            cola.Encolar(TipoEvento.Turno, turno.Payload);
            _encolados[turno.TurnoSr] = (turno.AperturaLocal, turno.Huella);
            encolados++;
        }

        _avisosDelCicloAnterior = _avisosDeEsteCiclo;
        if (encolados > 0)
        {
            _logger.LogInformation(
                "Turnos: leídos {Turnos} turno(s) en {Ms} ms; encolados {Encolados}.",
                lectura.Filas.Count, lectura.Milisegundos, encolados);
        }
    }

    /// <summary>Al log una vez por mensaje distinto.</summary>
    private void Fallar(string mensaje)
    {
        if (mensaje != _ultimoError)
        {
            _ultimoError = mensaje;
            _logger.LogError("{Mensaje}", mensaje);
        }
    }

    /// <summary>Un aviso que se repite cada ciclo va al log sólo si no salió en el ciclo anterior.</summary>
    private void RegistrarUnaVez(LogLevel nivel, string mensaje)
    {
        _avisosDeEsteCiclo.Add(mensaje);
        if (!_avisosDelCicloAnterior.Contains(mensaje))
        {
            _logger.Log(nivel, "Turnos: {Mensaje}", mensaje);
        }
    }
}
