using System.Data;
using System.Diagnostics;
using ArkonAgente.Diagnostico;
using ArkonAgente.SoftRestaurant;
using ArkonAgente.Sql;
using Microsoft.Data.SqlClient;

namespace ArkonAgente.Catalogos;

/// <summary>Una lectura de catálogo con lo que tardó (para el log).</summary>
internal sealed record LecturaCatalogo(CatalogoLeido Leido, long Milisegundos);

/// <summary>
/// ¿Se puede leer SoftRestaurant con este usuario? <paramref name="SoloLectura"/> es true sólo
/// si se CONFIRMÓ; <paramref name="Mensaje"/> dice por qué no (sin secretos).
/// </summary>
internal sealed record PermisosLectura(bool SoloLectura, string? Mensaje);

/// <summary>Lee catálogos en SoftRestaurant; los tests lo sustituyen con fixtures.</summary>
internal interface ILectorCatalogos
{
    /// <summary>
    /// Corre <c>diagnostico.sql</c>: sólo con un usuario de SOLO LECTURA confirmado se leen
    /// catálogos. Una excepción aquí (timeout, red) NO es "puede leer": es "no se pudo confirmar".
    /// </summary>
    Task<PermisosLectura> RevisarPermisosAsync(CancellationToken cancelacion);

    /// <summary>Lee un catálogo completo. Lanza si falla: el que llama nunca lo toma por "0 filas".</summary>
    Task<LecturaCatalogo> LeerAsync(CatalogoPanel catalogo, CancellationToken cancelacion);
}

/// <summary>
/// El lector real: la consulta que dice el reader elegido por versión
/// (<see cref="ISoftRestaurantReader.ConsultaCatalogo"/>), por
/// <see cref="ConexionSoftRestaurant.CrearComando"/> (timeout corto, <c>WITH (NOLOCK)</c> en el
/// <c>.sql</c>), y el mapeo puro de <see cref="MapeoCatalogos"/>. SOLO LECTURA: ni una sentencia
/// que escriba, ni una tabla auxiliar; el estado vive en el SQLite del agente.
/// </summary>
internal sealed class LectorCatalogosSr(ConexionSoftRestaurant conexion, ISoftRestaurantReader reader) : ILectorCatalogos
{
    public async Task<PermisosLectura> RevisarPermisosAsync(CancellationToken cancelacion)
    {
        try
        {
            await using var sql = conexion.CrearConexion();
            await sql.OpenAsync(cancelacion);
            await using var comando = ConexionSoftRestaurant.CrearComando(sql, "diagnostico");
            await using var lector = await comando.ExecuteReaderAsync(CommandBehavior.SingleRow, cancelacion);
            if (!await lector.ReadAsync(cancelacion))
            {
                return new PermisosLectura(false, "La consulta de permisos no devolvió filas.");
            }

            var permisos = FilaDiagnostico.Leer(lector).PermisosDeEscritura();
            return permisos.Count == 0
                ? new PermisosLectura(true, null)
                : new PermisosLectura(false, $"El usuario SQL puede escribir en SoftRestaurant: {string.Join(", ", permisos)}.");
        }
        catch (SqlException) when (cancelacion.IsCancellationRequested)
        {
            throw new OperationCanceledException(cancelacion);
        }
        catch (SqlException ex)
        {
            var (detalle, _) = VerificacionSql.ClasificarError(ex, conexion);
            return new PermisosLectura(false, $"No se pudieron revisar los permisos del usuario SQL. {detalle}");
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancelacion.IsCancellationRequested)
        {
            // Sólo el tipo: el mensaje podría citar la cadena de conexión.
            return new PermisosLectura(false, $"No se pudieron revisar los permisos del usuario SQL ({ex.GetType().Name}).");
        }
    }

    public async Task<LecturaCatalogo> LeerAsync(CatalogoPanel catalogo, CancellationToken cancelacion)
    {
        try
        {
            await using var sql = conexion.CrearConexion();
            await sql.OpenAsync(cancelacion);
            await using var comando = ConexionSoftRestaurant.CrearComando(sql, reader.ConsultaCatalogo(catalogo));
            var inicio = Stopwatch.GetTimestamp();
            await using var lector = await comando.ExecuteReaderAsync(cancelacion);
            var leido = MapeoCatalogos.Mapear(catalogo, lector);
            return new LecturaCatalogo(leido, (long)Stopwatch.GetElapsedTime(inicio).TotalMilliseconds);
        }
        catch (SqlException) when (cancelacion.IsCancellationRequested)
        {
            throw new OperationCanceledException(cancelacion);
        }
    }
}
