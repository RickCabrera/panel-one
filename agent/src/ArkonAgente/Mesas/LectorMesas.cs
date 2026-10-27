using System.Diagnostics;
using ArkonAgente.Catalogos;
using ArkonAgente.SoftRestaurant;
using ArkonAgente.Sql;
using Microsoft.Data.SqlClient;

namespace ArkonAgente.Mesas;

/// <summary>Una lectura de cuentas abiertas con lo que tardó (para el log y el heartbeat).</summary>
internal sealed record LecturaMesas(MesasLeidas Leidas, long Milisegundos);

/// <summary>Lee las cuentas abiertas en SoftRestaurant; los tests lo sustituyen con fixtures.</summary>
internal interface ILectorMesas
{
    /// <summary>Lo mismo que <see cref="ILectorCatalogos.RevisarPermisosAsync"/>: sólo con SOLO LECTURA confirmado.</summary>
    Task<PermisosLectura> RevisarPermisosAsync(CancellationToken cancelacion);

    /// <summary>Lee TODAS las cuentas abiertas. Lanza si falla: el que llama nunca lo toma por "no hay mesas".</summary>
    Task<LecturaMesas> LeerAsync(CancellationToken cancelacion);
}

/// <summary>
/// El lector real: la consulta que dice el reader elegido por versión
/// (<see cref="ISoftRestaurantReader.ConsultaMesasAbiertas"/>), por
/// <see cref="ConexionSoftRestaurant.CrearComando"/> (timeout corto, <c>WITH (NOLOCK)</c> en el
/// <c>.sql</c>, sin transacción), y el mapeo puro de <see cref="MapeoMesas"/>. SOLO LECTURA.
/// </summary>
internal sealed class LectorMesasSr(ConexionSoftRestaurant conexion, ISoftRestaurantReader reader, TimeZoneInfo zona)
    : ILectorMesas
{
    public Task<PermisosLectura> RevisarPermisosAsync(CancellationToken cancelacion) =>
        LectorCatalogosSr.RevisarPermisosAsync(conexion, cancelacion);

    public async Task<LecturaMesas> LeerAsync(CancellationToken cancelacion)
    {
        try
        {
            await using var sql = conexion.CrearConexion();
            await sql.OpenAsync(cancelacion);
            await using var comando = ConexionSoftRestaurant.CrearComando(sql, reader.ConsultaMesasAbiertas);
            var inicio = Stopwatch.GetTimestamp();
            await using var lector = await comando.ExecuteReaderAsync(cancelacion);
            var leidas = MapeoMesas.Mapear(lector, zona);
            return new LecturaMesas(leidas, (long)Stopwatch.GetElapsedTime(inicio).TotalMilliseconds);
        }
        catch (SqlException) when (cancelacion.IsCancellationRequested)
        {
            throw new OperationCanceledException(cancelacion);
        }
    }
}
