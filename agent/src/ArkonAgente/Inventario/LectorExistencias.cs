using System.Diagnostics;
using ArkonAgente.Catalogos;
using ArkonAgente.SoftRestaurant;
using ArkonAgente.Sql;
using Microsoft.Data.SqlClient;

namespace ArkonAgente.Inventario;

/// <summary>Una lectura de existencias con lo que tardó (para el log).</summary>
internal sealed record LecturaExistencias(ExistenciasLeidas Leidas, long Milisegundos);

/// <summary>Lee las existencias en SoftRestaurant; los tests lo sustituyen con fixtures.</summary>
internal interface ILectorExistencias
{
    /// <summary>Lo mismo que <see cref="ILectorCatalogos.RevisarPermisosAsync"/>: sólo con SOLO LECTURA confirmado.</summary>
    Task<PermisosLectura> RevisarPermisosAsync(CancellationToken cancelacion);

    /// <summary>Lee TODAS las existencias. Lanza si falla: el que llama nunca lo toma por "almacén vacío".</summary>
    Task<LecturaExistencias> LeerAsync(CancellationToken cancelacion);
}

/// <summary>
/// El lector real: la consulta que dice el reader elegido por versión
/// (<see cref="ISoftRestaurantReader.ConsultaExistencias"/>), por
/// <see cref="ConexionSoftRestaurant.CrearComando"/> (timeout corto, <c>WITH (NOLOCK)</c> en el
/// <c>.sql</c>, sin transacción), y el mapeo puro de <see cref="MapeoExistencias"/>. SOLO LECTURA.
/// </summary>
internal sealed class LectorExistenciasSr(ConexionSoftRestaurant conexion, ISoftRestaurantReader reader) : ILectorExistencias
{
    public Task<PermisosLectura> RevisarPermisosAsync(CancellationToken cancelacion) =>
        LectorCatalogosSr.RevisarPermisosAsync(conexion, cancelacion);

    public async Task<LecturaExistencias> LeerAsync(CancellationToken cancelacion)
    {
        try
        {
            await using var sql = conexion.CrearConexion();
            await sql.OpenAsync(cancelacion);
            await using var comando = ConexionSoftRestaurant.CrearComando(sql, reader.ConsultaExistencias);
            var inicio = Stopwatch.GetTimestamp();
            await using var lector = await comando.ExecuteReaderAsync(cancelacion);
            var leidas = MapeoExistencias.Mapear(lector);
            return new LecturaExistencias(leidas, (long)Stopwatch.GetElapsedTime(inicio).TotalMilliseconds);
        }
        catch (SqlException) when (cancelacion.IsCancellationRequested)
        {
            throw new OperationCanceledException(cancelacion);
        }
    }
}
