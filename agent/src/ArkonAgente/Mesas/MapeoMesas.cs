using System.Data;
using System.Globalization;
using System.Text;
using System.Text.Json;
using ArkonAgente.Inventario;

namespace ArkonAgente.Mesas;

/// <summary>Un modificador vendido de una partida, ya en texto del snapshot.</summary>
internal sealed record ModificadorAbierto(string Nombre, string? Precio);

/// <summary>Una partida de una cuenta abierta, ya en texto del snapshot.</summary>
internal sealed record PartidaAbierta(
    string Producto,
    string? Categoria,
    string? Cantidad,
    string? PrecioUnit,
    string? Total,
    IReadOnlyList<ModificadorAbierto> Modificadores,
    bool? ComandaImpresa);

/// <summary>Una cuenta abierta de SoftRestaurant (una fila de <c>tempcheques</c> sin cobrar ni cancelar).</summary>
internal sealed record MesaAbierta(
    string Folio,
    string? FolioTicket,
    string? Mesa,
    string? Mesero,
    string? AbiertoAt,
    int? Comensales,
    bool? Impreso,
    string? Total,
    IReadOnlyList<PartidaAbierta> Partidas);

/// <summary>Lo que salió de leer las cuentas abiertas.</summary>
/// <param name="Avisos">Rarezas del POS que van al log (sin importes).</param>
internal sealed record MesasLeidas(IReadOnlyList<MesaAbierta> Mesas, IReadOnlyList<string> Avisos);

/// <summary>
/// Convierte los dos resultados de <c>sr_mesas_abiertas.sql</c> en el snapshot de mesas (F1-023,
/// <c>DatosSnapshotDto</c>) con la forma que lee el panel (<c>leerMesa</c> en
/// <c>web/src/paginas/mesas/mesa.ts</c>). Es PURO: recibe un <see cref="IDataReader"/>, así que los
/// tests lo alimentan con fixtures sin SQL Server. Todo en <c>decimal</c>, nunca <c>double</c>.
/// </summary>
/// <remarks>
/// Lo validado en F1-090 (docs/esquema-sr.md §5) y las decisiones que no salen de SR:
/// <list type="bullet">
/// <item>Importes a 2 decimales, mitad lejos de cero: el snapshot no pasa por la normalización del
/// API y el panel no lee más de 2 (§5). <c>total</c> es <c>tempcheques.total</c>, que ya trae IVA y
/// descuentos; nunca se suma de las partidas.</item>
/// <item>DECISION PROVISIONAL (nocturno): <c>folio</c> es <c>tempcheques.folio</c>, el único número
/// que no cambia mientras la cuenta está abierta (<c>numcheque</c> vale 0 hasta imprimirla y
/// cambiaría la identidad de la tarjeta, del modal y de las alertas). El folio del ticket viaja aparte
/// en <c>folioTicket</c> (<c>numcheque</c> &gt; 0), que el panel todavía no muestra.</item>
/// <item>El total de la partida es <c>cantidad × precio × (1 − descuento/100)</c>: SR guarda el
/// PORCENTAJE de descuento de la partida y no el importe (§3).</item>
/// <item>DECISION PROVISIONAL (nocturno): una fila con <c>modificador = 1</c> es un modificador de la
/// partida anterior, con <c>precio</c> como su precio; nunca se ha visto uno vendido (§3). Uno sin
/// partida antes se manda como partida, con aviso.</item>
/// <item><c>comandaImpresa</c> = <c>comanda_impresa = 1</c>: el 1 se vio en todas las partidas enviadas;
/// que 0 sea "pendiente de enviar" es SUPUESTO (§5).</item>
/// </list>
/// </remarks>
internal static class MapeoMesas
{
    /// <summary>El tope de <c>mesas</c> del contrato (<c>@ArrayMaxSize(500)</c> en ingesta.dto.ts).</summary>
    public const int MaxMesas = 500;

    public static MesasLeidas Mapear(IDataReader lector, TimeZoneInfo zona)
    {
        var avisos = new List<string>();
        var cuentas = LeerCuentas(lector, zona, avisos);
        if (!lector.NextResult())
        {
            throw new InvalidDataException("La consulta de mesas abiertas no devolvió el resultado de partidas.");
        }

        var partidas = LeerPartidas(lector, cuentas, avisos);
        var mesas = cuentas.Values
            .Select(c => c with { Partidas = partidas.TryGetValue(c.Folio, out var p) ? p : [] })
            .ToList();
        return new MesasLeidas(mesas, avisos);
    }

    /// <summary>El <c>datos</c> del evento <c>snapshot</c>, con los campos en orden fijo.</summary>
    public static string Payload(IReadOnlyList<MesaAbierta> mesas, DateTimeOffset capturadoAt)
    {
        using var memoria = new MemoryStream();
        using (var w = new Utf8JsonWriter(memoria))
        {
            w.WriteStartObject();
            w.WriteString("capturadoAt", MapeoExistencias.Instante(capturadoAt));
            w.WriteStartArray("mesas");
            foreach (var m in mesas)
            {
                EscribirMesa(w, m);
            }

            w.WriteEndArray();
            w.WriteEndObject();
        }

        return Encoding.UTF8.GetString(memoria.ToArray());
    }

    private static Dictionary<string, MesaAbierta> LeerCuentas(IDataReader lector, TimeZoneInfo zona, List<string> avisos)
    {
        var indices = Indices(lector);
        int iFolio = indices("folio"), iNumcheque = indices("numcheque"), iMesa = indices("mesa"),
            iMesero = indices("mesero"), iAbierto = indices("abierto"), iComensales = indices("comensales"),
            iImpreso = indices("impreso"), iTotal = indices("total");

        // Por folio, en el orden de la consulta. Un folio repetido sale de un mesero con la misma
        // clave en dos filas de dbo.meseros (sin índice único): se queda la primera.
        var cuentas = new Dictionary<string, MesaAbierta>(StringComparer.Ordinal);
        var repetidos = 0;
        while (lector.Read())
        {
            var folio = ApoyoMapeo.Texto(lector, iFolio)
                ?? throw new InvalidDataException("La consulta de mesas abiertas devolvió una cuenta sin folio.");
            if (cuentas.ContainsKey(folio))
            {
                repetidos++;
                continue;
            }

            var numcheque = ApoyoMapeo.Decimal(lector, iNumcheque);
            var abierto = ApoyoMapeo.Fecha(lector, iAbierto);
            cuentas[folio] = new MesaAbierta(
                folio,
                numcheque is > 0 ? ApoyoMapeo.Formatear(numcheque.Value) : null,
                ApoyoMapeo.Texto(lector, iMesa)?.Trim(),
                ApoyoMapeo.Texto(lector, iMesero)?.Trim(),
                abierto is { } f ? ApoyoMapeo.Instante(f, zona) : null,
                Entero(lector, iComensales),
                lector.IsDBNull(iImpreso) ? null : Convert.ToBoolean(lector.GetValue(iImpreso), CultureInfo.InvariantCulture),
                Dinero(ApoyoMapeo.Decimal(lector, iTotal)),
                []);
        }

        if (repetidos > 0)
        {
            avisos.Add($"{repetidos} cuenta(s) abierta(s) salieron repetidas (clave de mesero duplicada en dbo.meseros); se tomó la primera.");
        }

        return cuentas;
    }

    private static Dictionary<string, List<PartidaAbierta>> LeerPartidas(
        IDataReader lector, Dictionary<string, MesaAbierta> cuentas, List<string> avisos)
    {
        var indices = Indices(lector);
        int iFolio = indices("folio"), iClave = indices("clave"), iProducto = indices("producto"),
            iCategoria = indices("categoria"), iCantidad = indices("cantidad"), iPrecio = indices("precio"),
            iDescuento = indices("descuento"), iModificador = indices("modificador"), iComanda = indices("comanda_impresa");

        var porCuenta = new Dictionary<string, List<PartidaAbierta>>(StringComparer.Ordinal);
        var huerfanos = 0;
        while (lector.Read())
        {
            var folio = ApoyoMapeo.Texto(lector, iFolio);
            if (folio is null || !cuentas.ContainsKey(folio))
            {
                continue; // la cobraron entre las dos lecturas: ya no es una mesa abierta
            }

            if (!porCuenta.TryGetValue(folio, out var lista))
            {
                lista = [];
                porCuenta[folio] = lista;
            }

            var nombre = ApoyoMapeo.Texto(lector, iProducto)?.Trim() ?? ApoyoMapeo.Texto(lector, iClave)?.Trim() ?? "Sin nombre";
            var cantidad = ApoyoMapeo.Decimal(lector, iCantidad);
            var precio = ApoyoMapeo.Decimal(lector, iPrecio);
            var esModificador = !lector.IsDBNull(iModificador)
                                && Convert.ToBoolean(lector.GetValue(iModificador), CultureInfo.InvariantCulture);

            if (esModificador && lista.Count > 0)
            {
                var anterior = lista[^1];
                lista[^1] = anterior with
                {
                    Modificadores = [.. anterior.Modificadores, new ModificadorAbierto(nombre, Dinero(precio))],
                };
                continue;
            }

            if (esModificador)
            {
                huerfanos++;
            }

            var descuento = ApoyoMapeo.Decimal(lector, iDescuento) ?? 0m;
            decimal? total = cantidad is { } c && precio is { } p ? c * p * (1m - (descuento / 100m)) : null;
            lista.Add(new PartidaAbierta(
                nombre,
                ApoyoMapeo.Texto(lector, iCategoria)?.Trim(),
                cantidad is { } q ? ApoyoMapeo.Formatear(Normalizar(ApoyoMapeo.Cantidad3(q))) : null,
                Dinero(precio),
                Dinero(total),
                [],
                lector.IsDBNull(iComanda) ? null : Convert.ToBoolean(lector.GetValue(iComanda), CultureInfo.InvariantCulture)));
        }

        if (huerfanos > 0)
        {
            avisos.Add($"{huerfanos} modificador(es) sin partida antes en su cuenta; se mandan como partida.");
        }

        return porCuenta;
    }

    private static void EscribirMesa(Utf8JsonWriter w, MesaAbierta m)
    {
        w.WriteStartObject();
        w.WriteString("folio", m.Folio);
        w.WriteString("folioTicket", m.FolioTicket);
        w.WriteString("mesa", m.Mesa);
        w.WriteString("mesero", m.Mesero);
        w.WriteString("abiertoAt", m.AbiertoAt);
        if (m.Comensales is { } comensales)
        {
            w.WriteNumber("comensales", comensales);
        }
        else
        {
            w.WriteNull("comensales");
        }

        if (m.Impreso is { } impreso)
        {
            w.WriteBoolean("impreso", impreso);
        }
        else
        {
            w.WriteNull("impreso");
        }

        w.WriteString("total", m.Total);
        w.WriteStartArray("partidas");
        foreach (var p in m.Partidas)
        {
            w.WriteStartObject();
            w.WriteString("producto", p.Producto);
            w.WriteString("categoria", p.Categoria);
            w.WriteString("cantidad", p.Cantidad);
            w.WriteString("precioUnit", p.PrecioUnit);
            w.WriteString("total", p.Total);
            w.WriteStartArray("modificadores");
            foreach (var mod in p.Modificadores)
            {
                w.WriteStartObject();
                w.WriteString("nombre", mod.Nombre);
                w.WriteString("precio", mod.Precio);
                w.WriteEndObject();
            }

            w.WriteEndArray();
            if (p.ComandaImpresa is { } comanda)
            {
                w.WriteBoolean("comandaImpresa", comanda);
            }

            w.WriteEndObject();
        }

        w.WriteEndArray();
        w.WriteEndObject();
    }

    /// <summary>Importe del snapshot: 2 decimales, mitad lejos de cero, siempre con los 2 (<c>"120.00"</c>).</summary>
    private static string? Dinero(decimal? valor)
    {
        if (valor is not { } v)
        {
            return null;
        }

        var redondeado = Math.Round(v, 2, MidpointRounding.AwayFromZero);
        return (redondeado == 0m ? 0m : redondeado).ToString("0.00", CultureInfo.InvariantCulture);
    }

    /// <summary><c>1.000000</c> viaja <c>"1"</c>, <c>0.750</c> viaja <c>"0.75"</c>.</summary>
    private static decimal Normalizar(decimal valor) => valor / 1.000000000000000000000000000000000m;

    private static int? Entero(IDataRecord r, int i)
    {
        if (r.IsDBNull(i))
        {
            return null;
        }

        var valor = Convert.ToDecimal(r.GetValue(i), CultureInfo.InvariantCulture);
        return valor >= 0 && valor == decimal.Truncate(valor) && valor <= int.MaxValue ? (int)valor : null;
    }

    private static Func<string, int> Indices(IDataRecord registro)
    {
        var indices = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < registro.FieldCount; i++)
        {
            indices.TryAdd(registro.GetName(i), i);
        }

        return columna => indices.TryGetValue(columna, out var i)
            ? i
            : throw new InvalidDataException($"La consulta de mesas abiertas no trae la columna '{columna}'.");
    }
}
