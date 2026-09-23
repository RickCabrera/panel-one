using System.Data;
using System.Globalization;

namespace ArkonAgente.Inventario;

/// <summary>
/// Convierte las filas de <c>sr_compras.sql</c> en compras para <c>POST /ingesta/compras</c> (F2-126).
/// PURO, sobre un <see cref="IDataReader"/>; todo en <c>decimal</c>.
/// </summary>
/// <remarks>
/// Obligaciones del contrato (docs/esquema-sr.md §10 "Compras") y cómo se cumplen:
/// <list type="bullet">
/// <item>(1) Compra COMPLETA: la consulta trae la cabecera con TODOS sus renglones de
/// <c>comprasmovtos</c>; una sin renglones viaja con <c>partidas: []</c>.</item>
/// <item>(2) <c>cancelada</c> = <c>compras.cancelado</c>; la que desaparece la manda el sincronizador
/// cancelada.</item>
/// <item>(3) Cantidad en texto NUMERIC(12,3): DECISION PROVISIONAL (nocturno) 4→3 decimales mitad lejos
/// de cero, con aviso. Una ≤ 0 viaja igual (el API rechaza esa compra, con aviso). Costo =
/// <c>comprasmovtos.costo</c>: SUPUESTO sin IVA y SIN aplicar el descuento (el descuento distinto de 0
/// se avisa); F2-193 lo valida contra el piloto.</item>
/// <item>(4) Proveedor y almacén por los ids de SR (los mismos de los catálogos) o nulos.
/// DECISION PROVISIONAL (nocturno): SR guarda el almacén POR RENGLÓN; si todos coinciden viaja ése, si
/// se mezclan viaja nulo (no se parte la compra ni se elige uno).</item>
/// <item>La fecha es <c>fechaaplicacion</c> con la zona de Windows; una compra sin fecha no se manda
/// (el contrato la exige) y cuenta como vista.</item>
/// </list>
/// </remarks>
internal static class MapeoCompras
{
    private sealed record Renglon(string? Insumo, decimal? Cantidad, decimal? Costo, decimal? Descuento, string? Almacen);

    private sealed record Cabecera(
        string Folio, DateTime? Fecha, string? Proveedor, bool Cancelada, decimal? Descuento, List<Renglon> Renglones);

    public static DocumentosLeidos Mapear(IDataReader lector, TimeZoneInfo zona)
    {
        var col = ApoyoMapeo.Indices(lector);
        int iCompra = col("compra"), iFolio = col("folio"), iFecha = col("fecha"), iProveedor = col("proveedor"),
            iCancelado = col("cancelado"), iDescCompra = col("descuento_compra"), iInsumo = col("insumo"),
            iCantidad = col("cantidad"), iCosto = col("costo"), iDescRenglon = col("descuento_renglon"),
            iAlmacen = col("almacen");

        var compras = new Dictionary<string, Cabecera>(StringComparer.Ordinal);
        var filasSql = 0;
        DateTime? maxima = null;
        while (lector.Read())
        {
            filasSql++;
            var id = ApoyoMapeo.Numero(lector, iCompra)
                ?? throw new InvalidDataException("La consulta de compras devolvió una fila sin idcompra.");
            if (!compras.TryGetValue(id, out var compra))
            {
                var fecha = ApoyoMapeo.Fecha(lector, iFecha);
                if (fecha is { } f && (maxima is null || f > maxima))
                {
                    maxima = f;
                }

                compra = new Cabecera(
                    ApoyoMapeo.Texto(lector, iFolio) ?? id, fecha, ApoyoMapeo.Texto(lector, iProveedor),
                    !lector.IsDBNull(iCancelado) && Convert.ToBoolean(lector.GetValue(iCancelado), CultureInfo.InvariantCulture),
                    ApoyoMapeo.Decimal(lector, iDescCompra), []);
                compras[id] = compra;
            }

            var insumo = ApoyoMapeo.Texto(lector, iInsumo);
            var cantidad = ApoyoMapeo.Decimal(lector, iCantidad);
            var costo = ApoyoMapeo.Decimal(lector, iCosto);
            if (insumo is null && cantidad is null && costo is null)
            {
                continue; // LEFT JOIN de una compra sin renglones
            }

            compra.Renglones.Add(new Renglon(
                insumo, cantidad, costo, ApoyoMapeo.Decimal(lector, iDescRenglon), ApoyoMapeo.Texto(lector, iAlmacen)));
        }

        var documentos = new List<DocumentoInventario>();
        var omitidos = new List<string>();
        int sinFecha = 0, redondeadas = 0, noPositivas = 0, sinCosto = 0, conDescuento = 0, almacenMezclado = 0;
        foreach (var (id, c) in compras.OrderBy(c => c.Key.Length).ThenBy(c => c.Key, StringComparer.Ordinal))
        {
            if (c.Fecha is not { } fecha)
            {
                sinFecha++;
                omitidos.Add(id);
                continue;
            }

            var almacenes = c.Renglones.Select(r => r.Almacen).Distinct().ToList();
            var almacen = almacenes.Count == 1 ? almacenes[0] : null;
            almacenMezclado += almacenes.Count > 1 ? 1 : 0;
            conDescuento += (c.Descuento ?? 0m) != 0m || c.Renglones.Any(r => (r.Descuento ?? 0m) != 0m) ? 1 : 0;

            var partidas = c.Renglones
                .Select(r =>
                {
                    var cantidad = r.Cantidad is { } q ? ApoyoMapeo.Cantidad3(q) : (decimal?)null;
                    redondeadas += cantidad is not null && cantidad != r.Cantidad ? 1 : 0;
                    noPositivas += cantidad is null or <= 0m ? 1 : 0;
                    sinCosto += r.Costo is null ? 1 : 0;
                    return (r.Insumo, Cantidad: cantidad, r.Costo);
                })
                .OrderBy(p => p.Insumo ?? "", StringComparer.Ordinal).ThenBy(p => p.Cantidad).ThenBy(p => p.Costo)
                .ToList();

            string Json(bool cancelada) => MapeoMovimientos.Escribir(w =>
            {
                w.WriteStartObject();
                w.WriteString("origenSrId", id);
                w.WriteString("folio", c.Folio);
                w.WriteString("proveedorOrigenSrId", c.Proveedor);
                w.WriteString("almacenOrigenSrId", almacen);
                w.WriteString("fecha", ApoyoMapeo.Instante(fecha, zona));
                w.WriteBoolean("cancelada", cancelada);
                w.WriteStartArray("partidas");
                foreach (var (insumo, cantidad, costo) in partidas)
                {
                    w.WriteStartObject();
                    w.WriteString("insumoOrigenSrId", insumo);
                    w.WriteString("cantidad", cantidad is { } q ? ApoyoMapeo.Formatear(q) : null);
                    w.WriteString("costoUnitario", costo is { } k ? ApoyoMapeo.Formatear(k) : null);
                    w.WriteEndObject();
                }

                w.WriteEndArray();
                w.WriteEndObject();
            });

            documentos.Add(new DocumentoInventario(id, fecha, partidas.Count, Json(c.Cancelada), Json(true)));
        }

        var avisos = new List<string>();
        void Avisar(int n, string texto)
        {
            if (n > 0)
            {
                avisos.Add($"{n} {texto}");
            }
        }

        Avisar(sinFecha, "compra(s) sin fechaaplicacion en SR: no se mandan (el contrato exige la fecha).");
        Avisar(redondeadas, "cantidad(es) de compra con 4 decimales se redondearon a 3.");
        Avisar(noPositivas, "partida(s) de compra con cantidad nula, cero o negativa: el panel rechaza su compra.");
        Avisar(sinCosto, "partida(s) de compra sin costo en SR: el panel rechaza su compra (no se inventa $0).");
        Avisar(conDescuento, "compra(s) con descuento en SR: el costo viaja SIN aplicar el descuento (supuesto a validar).");
        Avisar(almacenMezclado, "compra(s) con renglones de varios almacenes: viajan sin almacén.");
        return new DocumentosLeidos(documentos, omitidos, filasSql, maxima, avisos);
    }
}
