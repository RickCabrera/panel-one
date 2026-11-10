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
/// <param name="NoSeSupo">
/// La revisión misma falló (timeout, red): no se confirmó nada. Distinto de "puede escribir" (F1-022 lo
/// reintenta al siguiente ciclo en vez de bloquear las ventas).
/// </param>
internal sealed record PermisosLectura(bool SoloLectura, string? Mensaje, bool NoSeSupo = false);

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
    public Task<PermisosLectura> RevisarPermisosAsync(CancellationToken cancelacion) =>
        RevisarPermisosAsync(conexion, cancelacion);

    /// <summary>
    /// La revisión de <c>diagnostico.sql</c>, compartida con el lector de existencias (F2-241): el
    /// mismo criterio para cualquier lectura de tablas del POS.
    /// </summary>
    internal static async Task<PermisosLectura> RevisarPermisosAsync(
        ConexionSoftRestaurant conexion, CancellationToken cancelacion)
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
            return new PermisosLectura(false, $"No se pudieron revisar los permisos del usuario SQL. {detalle}", NoSeSupo: true);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancelacion.IsCancellationRequested)
        {
            // Sólo el tipo: el mensaje podría citar la cadena de conexión.
            return new PermisosLectura(
                false, $"No se pudieron revisar los permisos del usuario SQL ({ex.GetType().Name}).", NoSeSupo: true);
        }
    }

    /// <summary>"Invalid column name": la consulta nombra una columna que esta base no tiene.</summary>
    internal const int ErrorColumnaInexistente = 207;

    internal const string AvisoSinTipo =
        "La tabla formasdepago de esta instalación no tiene la columna 'tipo': las formas de pago se mandan " +
        "sin tipo y el panel no las clasifica: siguen contando como 'otro' (docs/esquema-sr.md §4).";

    public Task<LecturaCatalogo> LeerAsync(CatalogoPanel catalogo, CancellationToken cancelacion) =>
        LeerConRespaldoAsync(catalogo, reader, consulta => LeerConAsync(catalogo, consulta, cancelacion));

    /// <summary>
    /// Lee con la consulta del reader. Sólo para las formas de pago (PAG-01): si SQL Server la rechaza
    /// porque la base no tiene <c>formasdepago.tipo</c> (error 207), se lee con
    /// <see cref="ISoftRestaurantReader.ConsultaFormasPagoSinTipo"/> y el aviso va al log. Cualquier
    /// otro error sigue siendo falla del catálogo (nunca "0 filas"). Separado para probarlo sin SQL Server.
    /// </summary>
    internal static async Task<LecturaCatalogo> LeerConRespaldoAsync(
        CatalogoPanel catalogo, ISoftRestaurantReader reader, Func<string, Task<LecturaCatalogo>> leer)
    {
        try
        {
            return await leer(reader.ConsultaCatalogo(catalogo));
        }
        catch (SqlException ex) when (catalogo == CatalogoPanel.FormasPago && ex.Number == ErrorColumnaInexistente)
        {
            var lectura = await leer(reader.ConsultaFormasPagoSinTipo);
            return lectura with { Leido = lectura.Leido with { Avisos = [AvisoSinTipo, .. lectura.Leido.Avisos] } };
        }
    }

    private async Task<LecturaCatalogo> LeerConAsync(CatalogoPanel catalogo, string consulta, CancellationToken cancelacion)
    {
        try
        {
            await using var sql = conexion.CrearConexion();
            await sql.OpenAsync(cancelacion);
            await using var comando = ConexionSoftRestaurant.CrearComando(sql, consulta);
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
