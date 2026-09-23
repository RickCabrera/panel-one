using System.Data;
using System.Diagnostics;
using ArkonAgente.Catalogos;
using ArkonAgente.SoftRestaurant;
using ArkonAgente.Sql;
using Microsoft.Data.SqlClient;

namespace ArkonAgente.Inventario;

/// <summary>Una lectura de documentos con lo que tardó (para el log).</summary>
internal sealed record LecturaDocumentos(DocumentosLeidos Leidos, long Milisegundos);

/// <summary>
/// Qué parte de SR se lee, en hora LOCAL de SR: <paramref name="Desde"/> elige los documentos vivos y
/// <paramref name="DesdeCanceladas"/> los cancelados (ventana más amplia; sólo movimientos la usa).
/// </summary>
internal sealed record VentanaLectura(DateTime Desde, DateTime DesdeCanceladas);

/// <summary>Lee movimientos, compras y recetas en SoftRestaurant; los tests lo sustituyen con fixtures.</summary>
internal interface ILectorDocumentos
{
    /// <summary>Lo mismo que <see cref="ILectorCatalogos.RevisarPermisosAsync"/>: sólo con SOLO LECTURA confirmado.</summary>
    Task<PermisosLectura> RevisarPermisosAsync(CancellationToken cancelacion);

    /// <summary>
    /// Lee un tipo de documento (con ventana para movimientos y compras; null para recetas). Lanza si
    /// falla: el que llama nunca lo toma por "no hay nada" (eso cancelaría todo en el panel).
    /// </summary>
    Task<LecturaDocumentos> LeerAsync(TipoDocumentoInventario tipo, VentanaLectura? ventana, CancellationToken cancelacion);
}

/// <summary>
/// El lector real: la consulta que dice el reader elegido por versión, por
/// <see cref="ConexionSoftRestaurant.CrearComando"/> (timeout corto, <c>WITH (NOLOCK)</c> en el
/// <c>.sql</c>, sin transacción), con la ventana como parámetros <c>datetime</c> (nunca SQL armado con
/// texto) y el mapeo puro de cada tipo. SOLO LECTURA: el cursor vive en el SQLite del agente.
/// </summary>
internal sealed class LectorDocumentosSr(ConexionSoftRestaurant conexion, ISoftRestaurantReader reader, TimeZoneInfo zona)
    : ILectorDocumentos
{
    public Task<PermisosLectura> RevisarPermisosAsync(CancellationToken cancelacion) =>
        LectorCatalogosSr.RevisarPermisosAsync(conexion, cancelacion);

    public async Task<LecturaDocumentos> LeerAsync(
        TipoDocumentoInventario tipo, VentanaLectura? ventana, CancellationToken cancelacion)
    {
        try
        {
            await using var sql = conexion.CrearConexion();
            await sql.OpenAsync(cancelacion);
            var consulta = tipo switch
            {
                TipoDocumentoInventario.Movimientos => reader.ConsultaMovimientos,
                TipoDocumentoInventario.Compras => reader.ConsultaCompras,
                _ => reader.ConsultaRecetas,
            };
            await using var comando = ConexionSoftRestaurant.CrearComando(sql, consulta);
            if (tipo.ConVentana())
            {
                var v = ventana ?? throw new ArgumentNullException(nameof(ventana));
                // datetime, como las columnas: se compara tipo a tipo, sin conversión implícita a datetime2.
                comando.Parameters.Add("@desde", SqlDbType.DateTime).Value = v.Desde;
                if (tipo == TipoDocumentoInventario.Movimientos)
                {
                    comando.Parameters.Add("@desdecanceladas", SqlDbType.DateTime).Value = v.DesdeCanceladas;
                }
            }

            var inicio = Stopwatch.GetTimestamp();
            await using var lector = await comando.ExecuteReaderAsync(cancelacion);
            var leidos = tipo switch
            {
                TipoDocumentoInventario.Movimientos => MapeoMovimientos.Mapear(lector, zona),
                TipoDocumentoInventario.Compras => MapeoCompras.Mapear(lector, zona),
                _ => MapeoRecetas.Mapear(lector),
            };
            return new LecturaDocumentos(leidos, (long)Stopwatch.GetElapsedTime(inicio).TotalMilliseconds);
        }
        catch (SqlException) when (cancelacion.IsCancellationRequested)
        {
            throw new OperationCanceledException(cancelacion);
        }
    }
}
