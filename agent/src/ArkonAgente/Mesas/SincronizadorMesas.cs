using System.Text;
using ArkonAgente.Catalogos;
using ArkonAgente.Cola;
using ArkonAgente.Configuracion;
using ArkonAgente.Diagnostico;
using ArkonAgente.SoftRestaurant;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Mesas;

/// <summary>Lo que el worker hace con las mesas abiertas en cada ciclo; los tests lo sustituyen.</summary>
internal interface ISincronizadorMesas
{
    /// <summary>Con el reader ya elegido: lee las cuentas abiertas y encola el snapshot en <paramref name="cola"/>.</summary>
    Task CicloAsync(ISoftRestaurantReader reader, ColaLocal cola, CancellationToken cancelacion);
}

/// <summary>
/// Las cuentas abiertas del POS hacia el Monitor de mesas (F1-023): en CADA ciclo, el snapshot
/// completo (no delta) como evento <c>snapshot</c> de <c>POST /ingesta/eventos</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Sólo con un usuario de solo lectura confirmado</b> (<c>diagnostico.sql</c>, la misma revisión
/// que catálogos y existencias). Sin confirmarlo NO se leen las tablas de operación: Error en el log
/// (una vez por mensaje) y en el <c>ultimoError</c> del heartbeat. Es la opción conservadora que pide
/// la ficha de F1-022 mientras Ricardo no decida otra cosa. La confirmación se repite cada
/// <see cref="RevisionPermisos"/>; un rechazo se vuelve a revisar en <see cref="EsperaReintento"/>.
/// </para>
/// <para>
/// <b>Qué manda.</b> Cada lectura buena encola un snapshot con <c>capturadoAt</c> = cuándo EMPEZÓ la
/// lectura (UTC), también vacío (<c>mesas: []</c> = no hay cuentas abiertas). La cola deja un solo
/// snapshot pendiente (el nuevo borra al viejo). Una lectura que falla NO manda nada —nunca un snapshot
/// vacío, que diría "no hay mesas"—: el panel ve el dato envejecer y marca la sucursal desconectada.
/// Un snapshot de más de <see cref="MapeoMesas.MaxMesas"/> mesas o de más de
/// <see cref="MaxBytesSnapshot"/> no se manda (nunca uno recortado): cabe en un lote o no sale.
/// </para>
/// <para>
/// Nunca lanza, salvo la parada del servicio o una falla del SQLite propio; el worker lo envuelve.
/// </para>
/// </remarks>
internal sealed class SincronizadorMesas : ISincronizadorMesas
{
    public static readonly TimeSpan RevisionPermisos = TimeSpan.FromMinutes(15);
    public static readonly TimeSpan EsperaReintento = TimeSpan.FromMinutes(5);

    /// <summary>
    /// Por debajo de los 5 MB por lote del API (medido ya inflado), con margen para el sobre y los
    /// demás eventos del lote: un snapshot que solo no cabe se rechazaría para siempre (413).
    /// </summary>
    public const int MaxBytesSnapshot = 4 * 1024 * 1024;

    private readonly Func<ISoftRestaurantReader, ILectorMesas> _crearLector;
    private readonly EstadoSoftRestaurant _estadoSr;
    private readonly ConfiguracionAgente _config;
    private readonly TimeProvider _reloj;
    private readonly ILogger _logger;

    private ISoftRestaurantReader? _readerDelLector;
    private ILectorMesas? _lector;
    private DateTimeOffset _permisosConfirmadosHasta = DateTimeOffset.MinValue;
    private DateTimeOffset _reintentarPermisosDesde = DateTimeOffset.MinValue;
    private string? _ultimoError;

    public SincronizadorMesas(
        Func<ISoftRestaurantReader, ILectorMesas> crearLector,
        EstadoSoftRestaurant estadoSr,
        ConfiguracionAgente config,
        TimeProvider reloj,
        ILogger logger)
    {
        _crearLector = crearLector;
        _estadoSr = estadoSr;
        _config = config;
        _reloj = reloj;
        _logger = logger;
    }

    /// <summary>El de verdad: el SQL Server de la config y la zona de Windows de la PC del POS.</summary>
    public static SincronizadorMesas DeVerdad(ConfiguracionAgente config, ILogger logger, EstadoSoftRestaurant estadoSr)
    {
        var conexion = new Sql.ConexionSoftRestaurant(config.ConnectionString);
        return new SincronizadorMesas(
            reader => new LectorMesasSr(conexion, reader, TimeZoneInfo.Local), estadoSr, config, TimeProvider.System, logger);
    }

    public async Task CicloAsync(ISoftRestaurantReader reader, ColaLocal cola, CancellationToken cancelacion)
    {
        if (!ReferenceEquals(reader, _readerDelLector))
        {
            _lector = _crearLector(reader);
            _readerDelLector = reader;
            _permisosConfirmadosHasta = DateTimeOffset.MinValue;
        }

        if (!await PermisosConfirmadosAsync(_lector!, cancelacion))
        {
            return;
        }

        var capturadoAt = _reloj.GetUtcNow();
        LecturaMesas lectura;
        try
        {
            lectura = await _lector!.LeerAsync(cancelacion);
        }
        catch (OperationCanceledException) when (cancelacion.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Timeout de SQL, una columna que no está, un tipo que no convierte: falla de ESTA lectura.
            var detalle = ex is SqlException sql
                ? VerificacionSql.ClasificarError(sql, new Sql.ConexionSoftRestaurant(_config.ConnectionString)).Detalle
                : $"({ex.GetType().Name})";
            Fallar($"Mesas abiertas: no se pudieron leer en SoftRestaurant {detalle}. No se manda snapshot; se reintenta en el siguiente ciclo.");
            return;
        }

        foreach (var aviso in lectura.Leidas.Avisos)
        {
            _logger.LogWarning("Mesas abiertas: {Aviso}", aviso);
        }

        var mesas = lectura.Leidas.Mesas;
        if (mesas.Count > MapeoMesas.MaxMesas)
        {
            Fallar($"Mesas abiertas: hay {mesas.Count} cuentas abiertas y un snapshot admite a lo más {MapeoMesas.MaxMesas}. " +
                   "No se manda (nunca uno recortado): hace falta partir el snapshot, que es un cambio de contrato.");
            return;
        }

        var payload = MapeoMesas.Payload(mesas, capturadoAt);
        if (Encoding.UTF8.GetByteCount(payload) > MaxBytesSnapshot)
        {
            Fallar($"Mesas abiertas: el snapshot de {mesas.Count} cuentas pesa más de {MaxBytesSnapshot / (1024 * 1024)} MB y " +
                   "no cabría en un lote. No se manda (nunca uno recortado).");
            return;
        }

        cola.Encolar(TipoEvento.Snapshot, payload);
        _estadoSr.RegistrarErrorMesas(null);
        if (_ultimoError is not null)
        {
            _logger.LogInformation("Mesas abiertas: se vuelven a leer ({Mesas} cuenta(s) abierta(s)).", mesas.Count);
            _ultimoError = null;
        }
    }

    private async Task<bool> PermisosConfirmadosAsync(ILectorMesas lector, CancellationToken cancelacion)
    {
        var ahora = _reloj.GetUtcNow();
        if (ahora < _permisosConfirmadosHasta)
        {
            return true;
        }

        if (ahora < _reintentarPermisosDesde)
        {
            return false;
        }

        var permisos = await lector.RevisarPermisosAsync(cancelacion);
        if (permisos.SoloLectura)
        {
            _permisosConfirmadosHasta = ahora + RevisionPermisos;
            return true;
        }

        // Sólo un "puede escribir" CONFIRMADO espera EsperaReintento. Si la revisión misma falló (un
        // parpadeo del SQL), el siguiente ciclo vuelve a revisar: no deja el Monitor 5 min sin mesas.
        if (permisos.NoSeSupo)
        {
            Fallar($"Mesas abiertas: no se leen las cuentas abiertas de SoftRestaurant en este ciclo. {permisos.Mensaje} " +
                   "Se vuelve a revisar en el siguiente ciclo.");
            return false;
        }

        _reintentarPermisosDesde = ahora + EsperaReintento;
        Fallar($"Mesas abiertas: no se leen las cuentas abiertas de SoftRestaurant. {permisos.Mensaje} El agente sólo lee " +
               $"el POS con un usuario de SOLO LECTURA confirmado (ver 'agente test'). Se vuelve a revisar en " +
               $"{EsperaReintento.TotalMinutes} min.");
        return false;
    }

    /// <summary>Al log una vez por mensaje distinto, y SIEMPRE al heartbeat.</summary>
    private void Fallar(string mensaje)
    {
        _estadoSr.RegistrarErrorMesas(mensaje);
        if (mensaje != _ultimoError)
        {
            _ultimoError = mensaje;
            _logger.LogError("{Mensaje}", mensaje);
        }
    }
}
