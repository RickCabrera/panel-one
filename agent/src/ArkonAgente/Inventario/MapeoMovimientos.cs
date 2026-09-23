using System.Data;
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace ArkonAgente.Inventario;

/// <summary>
/// Convierte las filas de <c>sr_movimientos.sql</c> en pólizas para <c>POST /ingesta/movimientos</c>
/// (F2-122). Es PURO: recibe un <see cref="IDataReader"/>, así que los tests lo alimentan con fixtures
/// sin SQL Server. Todo en <c>decimal</c>, nunca <c>double</c>.
/// </summary>
/// <remarks>
/// Obligaciones del contrato (docs/esquema-sr.md §10 y §13) y cómo se cumplen:
/// <list type="bullet">
/// <item>(1) Póliza COMPLETA: la consulta trae todas las filas de cada documento elegido, y aquí se
/// agrupan por la columna <c>documento</c> que calcula el SQL (no se recalcula la clave).</item>
/// <item>(2) Cantidad CON SIGNO tal como la suma el trigger de SR; DECISION PROVISIONAL (nocturno):
/// de 4 a 3 decimales mitad lejos de cero, con aviso. Costo <c>money</c> en texto (el API redondea).
/// Costo o cantidad NULL viajan <c>null</c>: el API rechaza ESA póliza sola (no se inventa $0).</item>
/// <item>(3) <see cref="TipoDe"/> traduce el concepto de SR y el crudo va en <c>tipoSr</c>.</item>
/// <item>(4) Un almacén por póliza: el almacén es parte de la clave, así un traspaso sale en DOS
/// pólizas (salida en el origen, entrada en el destino) con la misma <c>referencia</c>.</item>
/// <item>(5) Una póliza cuyas filas están todas en <c>movsinvcancelados</c> viaja
/// <c>cancelada=true</c>; la que desaparece la manda el sincronizador con <see cref="DocumentoInventario.JsonAusente"/>.</item>
/// <item>(6) La <c>fecha</c> es la MÍNIMA de sus filas, del reloj del POS, con la zona de Windows.</item>
/// </list>
/// </remarks>
internal static class MapeoMovimientos
{
    /// <summary>
    /// DECISION PROVISIONAL (nocturno) / SUPUESTO no validado: la traducción de los 17 conceptos vistos en
    /// <c>dbo.conceptos</c> de SR 10 al tipo del panel. Lo dudoso (cancelaciones, devoluciones, entradas y
    /// salidas genéricas, producción) va a <c>otro</c>: no se adivina. F2-192 la valida.
    /// </summary>
    private static readonly Dictionary<string, string> Tipos = new(StringComparer.OrdinalIgnoreCase)
    {
        ["EPC"] = "compra",
        ["SPV"] = "consumo",
        ["CP"] = "consumo",
        ["SPM"] = "merma",
        ["SPD"] = "merma",
        ["EPA"] = "ajuste",
        ["SPA"] = "ajuste",
        ["STA"] = "traspaso_salida",
        ["ETA"] = "traspaso_entrada",
    };

    /// <summary>El tipo del panel para un <c>idconcepto</c> de SR; lo que no se sabe traducir, <c>otro</c>.</summary>
    public static string TipoDe(string? concepto) =>
        concepto is not null && Tipos.TryGetValue(concepto, out var tipo) ? tipo : "otro";

    private sealed record Fila(bool Cancelada, DateTime? Fecha, string? Insumo, decimal? Cantidad, decimal? Costo);

    public static DocumentosLeidos Mapear(IDataReader lector, TimeZoneInfo zona)
    {
        var col = ApoyoMapeo.Indices(lector);
        int iCancelado = col("cancelado"), iFecha = col("fecha"), iConcepto = col("concepto"), iInsumo = col("insumo"),
            iCosto = col("costo"), iCantidad = col("cantidad"), iAlmacen = col("almacen"), iDocumento = col("documento");

        var grupos = new Dictionary<string, (string? Almacen, string? Concepto, List<Fila> Filas)>(StringComparer.Ordinal);
        var filasSql = 0;
        DateTime? maxima = null;
        while (lector.Read())
        {
            filasSql++;
            var documento = ApoyoMapeo.Texto(lector, iDocumento)
                ?? throw new InvalidDataException("La consulta de movimientos devolvió una fila sin documento.");
            var fecha = ApoyoMapeo.Fecha(lector, iFecha);
            if (fecha is { } f && (maxima is null || f > maxima))
            {
                maxima = f;
            }

            if (!grupos.TryGetValue(documento, out var grupo))
            {
                grupo = (ApoyoMapeo.Texto(lector, iAlmacen), ApoyoMapeo.Texto(lector, iConcepto), []);
                grupos[documento] = grupo;
            }

            grupo.Filas.Add(new Fila(
                Convert.ToInt32(lector.GetValue(iCancelado), CultureInfo.InvariantCulture) == 1,
                fecha, ApoyoMapeo.Texto(lector, iInsumo), ApoyoMapeo.Decimal(lector, iCantidad), ApoyoMapeo.Decimal(lector, iCosto)));
        }

        var documentos = new List<DocumentoInventario>();
        var omitidos = new List<string>();
        int redondeadas = 0, sinCosto = 0, sinInsumoOCantidad = 0, mezcladas = 0, sinAlmacen = 0, sinFecha = 0;
        foreach (var (clave, (almacen, concepto, todas)) in grupos.OrderBy(g => g.Key, StringComparer.Ordinal))
        {
            // Una clave con filas vivas Y canceladas: SR la sigue teniendo. Viajan las vivas; no se
            // inventa una cancelación parcial.
            var vivas = todas.Where(f => !f.Cancelada).ToList();
            if (vivas.Count > 0 && vivas.Count < todas.Count)
            {
                mezcladas++;
            }

            var cancelada = vivas.Count == 0;
            var filas = cancelada ? todas : vivas;
            var fechas = filas.Where(f => f.Fecha is not null).Select(f => f.Fecha!.Value).ToList();
            if (almacen is null || fechas.Count == 0)
            {
                // El contrato exige almacén y fecha: no hay póliza que mandar, pero SR sí la tiene.
                sinAlmacen += almacen is null ? 1 : 0;
                sinFecha += almacen is not null ? 1 : 0;
                omitidos.Add(clave);
                continue;
            }

            var partidas = filas
                .Select(f =>
                {
                    var cantidad = f.Cantidad is { } c ? ApoyoMapeo.Cantidad3(c) : (decimal?)null;
                    if (cantidad is not null && cantidad != f.Cantidad)
                    {
                        redondeadas++;
                    }

                    sinCosto += f.Costo is null ? 1 : 0;
                    sinInsumoOCantidad += f.Insumo is null || f.Cantidad is null ? 1 : 0;
                    return (f.Insumo, Cantidad: cantidad, f.Costo);
                })
                .OrderBy(p => p.Insumo ?? "", StringComparer.Ordinal).ThenBy(p => p.Cantidad).ThenBy(p => p.Costo)
                .ToList();

            var (clase, numero) = (clave[0], clave[1..clave.IndexOf('|')]);
            var fechaMinima = fechas.Min();
            string Json(bool comoCancelada) => Escribir(w =>
            {
                w.WriteStartObject();
                w.WriteString("origenSrId", clave);
                w.WriteString("folio", numero);
                w.WriteString("tipo", TipoDe(concepto));
                w.WriteString("tipoSr", concepto);
                w.WriteString("almacenOrigenSrId", almacen);
                w.WriteString("fecha", ApoyoMapeo.Instante(fechaMinima, zona));
                w.WriteString("referencia", Referencia(clase, numero));
                w.WriteBoolean("cancelada", comoCancelada);
                w.WriteStartArray("partidas");
                foreach (var (insumo, cantidad, costo) in partidas)
                {
                    w.WriteStartObject();
                    w.WriteString("insumoOrigenSrId", insumo);
                    w.WriteString("cantidad", cantidad is { } c ? ApoyoMapeo.Formatear(c) : null);
                    w.WriteString("costoUnitario", costo is { } k ? ApoyoMapeo.Formatear(k) : null);
                    w.WriteEndObject();
                }

                w.WriteEndArray();
                w.WriteEndObject();
            });

            documentos.Add(new DocumentoInventario(clave, fechas.Max(), partidas.Count, Json(cancelada), Json(true)));
        }

        var avisos = new List<string>();
        void Avisar(int n, string texto)
        {
            if (n > 0)
            {
                avisos.Add($"{n} {texto}");
            }
        }

        Avisar(redondeadas, "cantidad(es) con 4 decimales se redondearon a 3.");
        Avisar(sinCosto, "partida(s) sin costo en SR: viajan sin costo y el panel rechaza su póliza (no se inventa $0).");
        Avisar(sinInsumoOCantidad, "partida(s) sin insumo o sin cantidad en SR: el panel rechaza su póliza.");
        Avisar(mezcladas, "póliza(s) con filas en movsinv Y en movsinvcancelados: viajan las vivas, sin cancelar.");
        Avisar(sinAlmacen, "póliza(s) sin almacén en SR: no se mandan (el contrato exige un almacén por póliza).");
        Avisar(sinFecha, "póliza(s) sin fecha en SR: no se mandan.");
        return new DocumentosLeidos(documentos, omitidos, filasSql, maxima, avisos);
    }

    /// <summary>El documento que originó la póliza, legible; S (sin documento) = null.</summary>
    private static string? Referencia(char clase, string numero) => clase switch
    {
        'T' => "Traspaso " + numero,
        'C' => "Compra " + numero,
        'F' => "Inventario físico " + numero,
        'V' => "Cheque " + numero,
        'M' => "Movimiento " + numero,
        _ => null,
    };

    internal static string Escribir(Action<Utf8JsonWriter> escribir)
    {
        using var memoria = new MemoryStream();
        using (var w = new Utf8JsonWriter(memoria))
        {
            escribir(w);
        }

        return Encoding.UTF8.GetString(memoria.ToArray());
    }
}
