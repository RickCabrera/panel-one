using System.Diagnostics;
using ArkonAgente.Diagnostico;
using ArkonAgente.Sql;
using Microsoft.Data.SqlClient;

namespace ArkonAgente.SoftRestaurant;

/// <summary>Resultado de la sonda de un ciclo.</summary>
/// <param name="LatenciaMs">Lo que tardó la consulta (sin abrir la conexión); null si falló.</param>
/// <param name="Error">Mensaje sin secretos; null si respondió.</param>
internal sealed record ResultadoSondeo(DateTimeOffset Instante, int? LatenciaMs, string? Error)
{
    public bool Ok => Error is null;

    public static ResultadoSondeo Exito(DateTimeOffset instante, int latenciaMs) => new(instante, latenciaMs, null);

    public static ResultadoSondeo Falla(DateTimeOffset instante, string error) =>
        new(instante, null, error.Length <= ResultadoDeteccion.LargoMaximoError
            ? error
            : error[..(ResultadoDeteccion.LargoMaximoError - 1)] + "…");
}

/// <summary>
/// La sonda de salud de SoftRestaurant (F1-025): una vez por ciclo, ya con el reader
/// elegido, corre <c>sr_sondeo.sql</c> (una fila de <c>dbo.parametros2</c>, NOLOCK,
/// timeout corto) y mide cuánto tarda. De aquí salen la <c>ultimaLecturaAt</c> y la
/// <c>latenciaQueryMs</c> del heartbeat.
/// </summary>
/// <remarks>
/// <para>
/// DECISION PROVISIONAL (nocturno): mientras el agente no lea ventas (F1-022/F1-023,
/// bloqueadas por F1-090), "última lectura" es la última vez que la SONDA respondió.
/// Una sonda que responde dice que la base de SR contesta, NO que las ventas estén
/// llegando: el panel puede mostrar "última lectura hace 10 s" sin un solo cheque.
/// Cuando F1-022 lea cheques, su lectura reemplaza a la sonda como fuente de las dos
/// cifras (nota en su ficha de backlog.md).
/// </para>
/// <para>
/// Nunca lanza, salvo la cancelación del servicio. Una <see cref="SqlException"/>
/// que llega por la parada a media consulta se convierte en
/// <see cref="OperationCanceledException"/>: el Worker sólo trata ésa como parada
/// normal.
/// </para>
/// </remarks>
internal sealed class SondeoSr(ConexionSoftRestaurant conexion, TimeProvider reloj)
{
    public async Task<ResultadoSondeo> SondearAsync(CancellationToken cancelacion)
    {
        try
        {
            await using var sql = conexion.CrearConexion();
            await sql.OpenAsync(cancelacion);

            await using var comando = ConexionSoftRestaurant.CrearComando(sql, "sr_sondeo");
            var inicio = Stopwatch.GetTimestamp();
            await using (var lector = await comando.ExecuteReaderAsync(cancelacion))
            {
                while (await lector.ReadAsync(cancelacion))
                {
                }
            }

            var ms = Stopwatch.GetElapsedTime(inicio).TotalMilliseconds;
            return ResultadoSondeo.Exito(reloj.GetUtcNow(), (int)Math.Min(int.MaxValue, Math.Round(ms)));
        }
        catch (SqlException) when (cancelacion.IsCancellationRequested)
        {
            throw new OperationCanceledException(cancelacion);
        }
        catch (SqlException ex)
        {
            var (detalle, sugerencia) = VerificacionSql.ClasificarError(ex, conexion);
            return ResultadoSondeo.Falla(
                reloj.GetUtcNow(), $"SoftRestaurant no respondió a la consulta del ciclo. {detalle} {sugerencia}".TrimEnd());
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancelacion.IsCancellationRequested)
        {
            // Sólo el tipo: el mensaje podría citar la cadena de conexión.
            return ResultadoSondeo.Falla(
                reloj.GetUtcNow(),
                $"SoftRestaurant no respondió a la consulta del ciclo ({ex.GetType().Name}) en {conexion.Resumen()}.");
        }
    }
}
