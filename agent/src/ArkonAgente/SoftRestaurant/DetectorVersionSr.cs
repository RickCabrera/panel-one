using ArkonAgente.Diagnostico;
using ArkonAgente.Sql;
using Microsoft.Data.SqlClient;

namespace ArkonAgente.SoftRestaurant;

/// <summary>
/// Detecta la versión de SoftRestaurant y elige el reader. SOLO LECTURA: corre
/// <c>sr_estructura.sql</c> (vistas de catálogo) y, si existe
/// <c>dbo.parametros2.versiondb</c>, <c>sr_version.sql</c> (una fila, NOLOCK).
/// Ambas con el timeout corto de <see cref="ConexionSoftRestaurant.CrearComando"/>.
/// </summary>
/// <remarks>
/// Nunca lanza, salvo la cancelación del servicio: cualquier falla vuelve como
/// <see cref="EstadoDeteccion.SinConexion"/> con un mensaje sin secretos. La
/// decisión está en <see cref="SelectorReader"/>, que es puro y se prueba sin SQL
/// Server; aquí sólo se leen filas.
/// </remarks>
internal sealed class DetectorVersionSr(ConexionSoftRestaurant conexion)
{
    public async Task<ResultadoDeteccion> DetectarAsync(CancellationToken cancelacion)
    {
        try
        {
            await using var sql = conexion.CrearConexion();
            await sql.OpenAsync(cancelacion);

            var estructura = new List<(string Tabla, bool TieneVersionDb)>();
            await using (var comando = ConexionSoftRestaurant.CrearComando(sql, "sr_estructura"))
            await using (var lector = await comando.ExecuteReaderAsync(cancelacion))
            {
                while (await lector.ReadAsync(cancelacion))
                {
                    estructura.Add((
                        lector.GetString(lector.GetOrdinal("tabla")),
                        lector.GetBoolean(lector.GetOrdinal("tiene_versiondb"))));
                }
            }

            var versiones = new List<string?>();
            if (estructura.Any(f => f.Tabla == SelectorReader.TablaVersion && f.TieneVersionDb))
            {
                await using var comando = ConexionSoftRestaurant.CrearComando(sql, "sr_version");
                await using var lector = await comando.ExecuteReaderAsync(cancelacion);
                var columna = lector.GetOrdinal("version_db");
                while (await lector.ReadAsync(cancelacion))
                {
                    versiones.Add(lector.IsDBNull(columna) ? null : lector.GetString(columna));
                }
            }

            return SelectorReader.Elegir(HuellaSr.Desde(conexion.BaseDatos, estructura, versiones));
        }
        catch (SqlException ex)
        {
            var (detalle, sugerencia) = VerificacionSql.ClasificarError(ex, conexion);
            return ResultadoDeteccion.SinConexion($"No se pudo detectar la versión de SoftRestaurant. {detalle} {sugerencia}");
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancelacion.IsCancellationRequested)
        {
            // Sólo el tipo: el mensaje podría citar la cadena de conexión.
            return ResultadoDeteccion.SinConexion(
                $"No se pudo detectar la versión de SoftRestaurant ({ex.GetType().Name}) en {conexion.Resumen()}.");
        }
    }
}
