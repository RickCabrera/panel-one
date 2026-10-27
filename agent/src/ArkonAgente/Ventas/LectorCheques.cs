using System.Data;
using System.Data.Common;
using System.Diagnostics;
using ArkonAgente.Catalogos;
using ArkonAgente.SoftRestaurant;
using ArkonAgente.Sql;
using Microsoft.Data.SqlClient;

namespace ArkonAgente.Ventas;

/// <summary>
/// De qué tabla salió una cuenta: <c>T</c> = <c>tempcheques</c> (turno en curso), <c>C</c> =
/// <c>cheques</c> (ya pasada por el corte, con otro <c>folio</c> interno). docs/esquema-sr.md §2.
/// </summary>
internal enum OrigenCuenta
{
    Temporal,
    Definitiva,
}

/// <summary>Una cuenta cerrada tal como sale de <c>sr_cheques.sql</c>. Fechas en hora local de SR, sin zona.</summary>
internal sealed record FilaCuenta(
    OrigenCuenta Origen,
    long Folio,
    long? NumCheque,
    string? SerieFolio,
    DateTime? Fecha,
    DateTime? Cierre,
    string? Mesa,
    int? Comensales,
    string? Mesero,
    string? Area,
    string? Cliente,
    decimal? Subtotal,
    decimal? DescuentoImporte,
    decimal? Impuestos,
    decimal? TotalDescuentos,
    decimal? TotalCortesias,
    decimal? Propina,
    decimal? Total,
    bool Cancelado);

/// <summary>Una partida (o un modificador, si <see cref="Modificador"/>) de una cuenta cerrada.</summary>
internal sealed record FilaPartida(
    OrigenCuenta Origen,
    long Folio,
    int Movimiento,
    decimal? Cantidad,
    string? IdProducto,
    string? Producto,
    string? Categoria,
    decimal? Precio,
    decimal? Descuento,
    bool Modificador);

/// <summary>Un pago de una cuenta cerrada; <see cref="Importe"/> ya viene SIN propina ni cambio (§4).</summary>
internal sealed record FilaPago(OrigenCuenta Origen, long Folio, string? IdFormaDePago, string? Forma, decimal? Importe);

/// <summary>Lo que devolvió una lectura, con el mayor <c>cheques.folio</c> que existe hoy.</summary>
internal sealed record LecturaCheques(
    long? MaxFolio,
    IReadOnlyList<FilaCuenta> Cuentas,
    IReadOnlyList<FilaPartida> Partidas,
    IReadOnlyList<FilaPago> Pagos,
    long Milisegundos);

/// <summary>Los parámetros de una lectura, en hora LOCAL de SR (así se comparan con sus columnas).</summary>
internal sealed record VentanaCheques(long UltimoFolio, DateTime Piso, DateTime Desde);

/// <summary>Lee cuentas cerradas en SoftRestaurant; los tests lo sustituyen con fixtures.</summary>
internal interface ILectorCheques
{
    /// <summary>Lo mismo que <see cref="ILectorCatalogos.RevisarPermisosAsync"/>: sólo con SOLO LECTURA confirmado.</summary>
    Task<PermisosLectura> RevisarPermisosAsync(CancellationToken cancelacion);

    /// <summary>Lanza si falla: el que llama nunca lo toma por "no hubo ventas".</summary>
    Task<LecturaCheques> LeerAsync(VentanaCheques ventana, CancellationToken cancelacion);
}

/// <summary>
/// El lector real: <c>sr_cheques.sql</c> (la que diga el reader elegido por versión) por
/// <see cref="ConexionSoftRestaurant.CrearComando"/>: timeout corto, <c>WITH (NOLOCK)</c>, sin
/// transacción. SOLO LECTURA.
/// </summary>
internal sealed class LectorChequesSr(ConexionSoftRestaurant conexion, ISoftRestaurantReader reader) : ILectorCheques
{
    public Task<PermisosLectura> RevisarPermisosAsync(CancellationToken cancelacion) =>
        LectorCatalogosSr.RevisarPermisosAsync(conexion, cancelacion);

    public async Task<LecturaCheques> LeerAsync(VentanaCheques ventana, CancellationToken cancelacion)
    {
        try
        {
            await using var sql = conexion.CrearConexion();
            await sql.OpenAsync(cancelacion);
            await using var comando = ConexionSoftRestaurant.CrearComando(sql, reader.ConsultaCheques);
            comando.Parameters.Add("@ultimofolio", SqlDbType.BigInt).Value = ventana.UltimoFolio;
            comando.Parameters.Add("@piso", SqlDbType.DateTime).Value = ventana.Piso;
            comando.Parameters.Add("@desde", SqlDbType.DateTime).Value = ventana.Desde;
            var inicio = Stopwatch.GetTimestamp();
            await using var lector = await comando.ExecuteReaderAsync(cancelacion);

            long? maxFolio = null;
            if (await lector.ReadAsync(cancelacion) && !lector.IsDBNull(0))
            {
                maxFolio = Convert.ToInt64(lector.GetValue(0));
            }

            var cuentas = new List<FilaCuenta>();
            await SiguienteAsync(lector, cancelacion);
            while (await lector.ReadAsync(cancelacion))
            {
                cuentas.Add(new FilaCuenta(
                    Origen(lector, "origen"), Entero(lector, "folio")!.Value, Entero(lector, "numcheque"),
                    Texto(lector, "seriefolio"), Fecha(lector, "fecha"), Fecha(lector, "cierre"), Texto(lector, "mesa"),
                    (int?)Entero(lector, "nopersonas"), Texto(lector, "mesero"), Texto(lector, "area"), Texto(lector, "cliente"),
                    Dinero(lector, "subtotal"), Dinero(lector, "descuentoimporte"), Dinero(lector, "impuestos"),
                    Dinero(lector, "totaldescuentos"), Dinero(lector, "totalcortesias"), Dinero(lector, "propina"),
                    Dinero(lector, "total"), Bit(lector, "cancelado")));
            }

            var partidas = new List<FilaPartida>();
            await SiguienteAsync(lector, cancelacion);
            while (await lector.ReadAsync(cancelacion))
            {
                partidas.Add(new FilaPartida(
                    Origen(lector, "origen"), Entero(lector, "folio")!.Value, (int)(Entero(lector, "movimiento") ?? 0),
                    Dinero(lector, "cantidad"), Texto(lector, "idproducto"), Texto(lector, "producto"),
                    Texto(lector, "categoria"), Dinero(lector, "precio"), Dinero(lector, "descuento"),
                    Bit(lector, "modificador")));
            }

            var pagos = new List<FilaPago>();
            await SiguienteAsync(lector, cancelacion);
            while (await lector.ReadAsync(cancelacion))
            {
                pagos.Add(new FilaPago(
                    Origen(lector, "origen"), Entero(lector, "folio")!.Value, Texto(lector, "idformadepago"),
                    Texto(lector, "forma"), Dinero(lector, "importe")));
            }

            return new LecturaCheques(
                maxFolio, cuentas, partidas, pagos, (long)Stopwatch.GetElapsedTime(inicio).TotalMilliseconds);
        }
        catch (SqlException) when (cancelacion.IsCancellationRequested)
        {
            throw new OperationCanceledException(cancelacion);
        }
    }

    private static async Task SiguienteAsync(DbDataReader lector, CancellationToken cancelacion)
    {
        if (!await lector.NextResultAsync(cancelacion))
        {
            throw new InvalidOperationException("sr_cheques.sql devolvió menos resultados de los esperados.");
        }
    }

    private static OrigenCuenta Origen(DbDataReader lector, string columna) =>
        lector.GetString(lector.GetOrdinal(columna)) == "T" ? OrigenCuenta.Temporal : OrigenCuenta.Definitiva;

    private static long? Entero(DbDataReader lector, string columna)
    {
        var i = lector.GetOrdinal(columna);
        return lector.IsDBNull(i) ? null : Convert.ToInt64(lector.GetValue(i));
    }

    private static decimal? Dinero(DbDataReader lector, string columna)
    {
        var i = lector.GetOrdinal(columna);
        return lector.IsDBNull(i) ? null : Convert.ToDecimal(lector.GetValue(i));
    }

    private static string? Texto(DbDataReader lector, string columna)
    {
        var i = lector.GetOrdinal(columna);
        return lector.IsDBNull(i) ? null : Convert.ToString(lector.GetValue(i));
    }

    private static DateTime? Fecha(DbDataReader lector, string columna)
    {
        var i = lector.GetOrdinal(columna);
        return lector.IsDBNull(i) ? null : lector.GetDateTime(i);
    }

    private static bool Bit(DbDataReader lector, string columna)
    {
        var i = lector.GetOrdinal(columna);
        return !lector.IsDBNull(i) && Convert.ToBoolean(lector.GetValue(i));
    }
}
