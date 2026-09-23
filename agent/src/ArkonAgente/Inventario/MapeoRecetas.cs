using System.Data;

namespace ArkonAgente.Inventario;

/// <summary>
/// Convierte las filas de <c>sr_recetas.sql</c> (<c>dbo.costos</c>) en recetas para
/// <c>POST /ingesta/recetas</c> (F2-125). PURO, sobre un <see cref="IDataReader"/>; todo en <c>decimal</c>.
/// </summary>
/// <remarks>
/// Obligaciones del contrato (docs/esquema-sr.md §10 "Recetas") y cómo se cumplen:
/// <list type="bullet">
/// <item>(1) Receta COMPLETA: se lee <c>costos</c> entera y cada producto viaja con todos sus renglones,
/// ordenados (insumo, cantidad) para que el hash sea estable.</item>
/// <item>(2) Una receta que SR ya no tiene la manda el sincronizador con <c>renglones: []</c>
/// (<see cref="DocumentoInventario.JsonAusente"/>).</item>
/// <item>(3) Cantidad numeric(12,4) de SR tal cual (cabe exacta en el contrato; no se redondea).
/// SUPUESTO no validado: está en la unidad del insumo y es por UNA unidad vendida. Una negativa o
/// nula viaja igual y el API rechaza esa receta (con aviso).</item>
/// <item>(4) Producto e insumo con los ids de SR, los mismos de los catálogos.</item>
/// <item>DECISION PROVISIONAL (nocturno): <c>costos</c> trae <c>idempresa</c>. Si un producto tiene
/// renglones de varias empresas y son IGUALES, viaja uno; si difieren, esa receta NO se manda (no se
/// elige empresa al azar, igual que <c>productosdetalle</c> §6) y cuenta como vista, así el panel
/// conserva la que tenía en vez de recibir una vacía.</item>
/// </list>
/// </remarks>
internal static class MapeoRecetas
{
    public static DocumentosLeidos Mapear(IDataReader lector)
    {
        var col = ApoyoMapeo.Indices(lector);
        int iProducto = col("producto"), iInsumo = col("insumo"), iCantidad = col("cantidad"), iEmpresa = col("empresa");

        var productos = new Dictionary<string, Dictionary<string, List<(string? Insumo, decimal? Cantidad)>>>(StringComparer.Ordinal);
        var filasSql = 0;
        var sinProducto = 0;
        while (lector.Read())
        {
            filasSql++;
            var producto = ApoyoMapeo.Texto(lector, iProducto);
            if (producto is null)
            {
                sinProducto++; // un renglón sin producto no es de ninguna receta
                continue;
            }

            if (!productos.TryGetValue(producto, out var empresas))
            {
                empresas = new Dictionary<string, List<(string?, decimal?)>>(StringComparer.Ordinal);
                productos[producto] = empresas;
            }

            var empresa = ApoyoMapeo.Texto(lector, iEmpresa) ?? "";
            if (!empresas.TryGetValue(empresa, out var renglones))
            {
                renglones = [];
                empresas[empresa] = renglones;
            }

            renglones.Add((ApoyoMapeo.Texto(lector, iInsumo), ApoyoMapeo.Decimal(lector, iCantidad)));
        }

        var documentos = new List<DocumentoInventario>();
        var omitidos = new List<string>();
        int enConflicto = 0, invalidas = 0;
        foreach (var (producto, empresas) in productos.OrderBy(p => p.Key, StringComparer.Ordinal))
        {
            var versiones = empresas.Values
                .Select(r => r.OrderBy(x => x.Insumo ?? "", StringComparer.Ordinal).ThenBy(x => x.Cantidad).ToList())
                .ToList();
            if (versiones.Skip(1).Any(v => !v.SequenceEqual(versiones[0])))
            {
                enConflicto++;
                omitidos.Add(producto);
                continue;
            }

            var renglones = versiones[0];
            invalidas += renglones.Any(r => r.Insumo is null || r.Cantidad is null or < 0m) ? 1 : 0;
            string Json(bool vacia) => MapeoMovimientos.Escribir(w =>
            {
                w.WriteStartObject();
                w.WriteString("productoOrigenSrId", producto);
                w.WriteStartArray("renglones");
                foreach (var (insumo, cantidad) in vacia ? Enumerable.Empty<(string? Insumo, decimal? Cantidad)>() : renglones)
                {
                    w.WriteStartObject();
                    w.WriteString("insumoOrigenSrId", insumo);
                    w.WriteString("cantidad", cantidad is { } c ? ApoyoMapeo.Formatear(c) : null);
                    w.WriteEndObject();
                }

                w.WriteEndArray();
                w.WriteEndObject();
            });

            documentos.Add(new DocumentoInventario(producto, null, renglones.Count, Json(false), Json(true)));
        }

        var avisos = new List<string>();
        if (sinProducto > 0)
        {
            avisos.Add($"{sinProducto} renglón(es) de costos sin producto: se ignoran.");
        }

        if (enConflicto > 0)
        {
            avisos.Add($"{enConflicto} receta(s) con renglones distintos en varias empresas de la base de SoftRestaurant: no se " +
                       "mandan (el panel conserva la que tenía).");
        }

        if (invalidas > 0)
        {
            avisos.Add($"{invalidas} receta(s) con un renglón sin insumo o con cantidad nula o negativa: el panel las rechaza.");
        }

        return new DocumentosLeidos(documentos, omitidos, filasSql, null, avisos);
    }
}
