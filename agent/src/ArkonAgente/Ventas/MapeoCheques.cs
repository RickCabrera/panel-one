using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace ArkonAgente.Ventas;

/// <summary>Un cheque listo para encolar: el <c>datos</c> del evento y su huella.</summary>
/// <param name="AbiertoLocal">La apertura tal como la guarda SR: detecta un <c>numcheque</c> reusado.</param>
internal sealed record ChequeMapeado(
    string FolioSr, OrigenCuenta Origen, long FolioInterno, string AbiertoLocal, string Payload, string Huella);

/// <summary>El resultado del mapeo: lo que se manda, y por qué no se manda lo demás.</summary>
/// <param name="Avisos">Cuentas que se dejan para la siguiente lectura o que no traen llave (Warning).</param>
/// <param name="Errores">Lo que pide una decisión humana: un <c>numcheque</c> repetido, un tope del contrato (Error).</param>
/// <param name="Releer">Cuentas que llegaron incompletas (una lectura a media escritura de SR): el cursor no las salta.</param>
internal sealed record ChequesMapeados(
    IReadOnlyList<ChequeMapeado> Cheques,
    IReadOnlyList<string> Avisos,
    IReadOnlyList<string> Errores,
    IReadOnlyList<(OrigenCuenta Origen, long Folio)> Releer);

/// <summary>
/// Traduce las filas de <c>sr_cheques.sql</c> al contrato de <c>POST /ingesta/eventos</c>
/// (<c>DatosChequeDto</c>, api/src/ingesta/dto/ingesta.dto.ts). Puro: sin SQL ni reloj, para
/// probar cada regla con fixtures. El mapeo de columnas está VALIDADO contra SR 10 en F1-090
/// (docs/esquema-sr.md §2–§4); lo que no se vio va marcado.
/// </summary>
internal static class MapeoCheques
{
    // Topes del contrato (ingesta.dto.ts): una cuenta que no cabe no se recorta en silencio.
    public const int MaxPartidas = 500;
    public const int MaxModificadores = 50;
    public const int MaxPagos = 50;

    /// <summary>Tolerancia de Σ pagos contra el total: los importes de SR son <c>money</c> (4 decimales).</summary>
    private const decimal ToleranciaPagos = 0.005m;

    public static ChequesMapeados Mapear(
        IReadOnlyList<FilaCuenta> cuentas,
        IReadOnlyList<FilaPartida> partidas,
        IReadOnlyList<FilaPago> pagos,
        TimeZoneInfo zonaSr)
    {
        var avisos = new List<string>();
        var errores = new List<string>();
        var releer = new List<(OrigenCuenta, long)>();
        var partidasDe = partidas
            .GroupBy(p => (p.Origen, p.Folio))
            .ToDictionary(g => g.Key, g => g.OrderBy(p => p.Movimiento).ToList());
        var pagosDe = pagos
            .GroupBy(p => (p.Origen, p.Folio))
            .ToDictionary(g => g.Key, g => g.ToList());

        var candidatos = new List<ChequeMapeado>();
        foreach (var cuenta in cuentas)
        {
            var donde = $"{(cuenta.Origen == OrigenCuenta.Temporal ? "tempcheques" : "cheques")}.folio {cuenta.Folio}";
            if (cuenta.NumCheque is not > 0)
            {
                // Una cuenta cobrada o cancelada sin el folio del ticket no tiene llave estable: no se inventa.
                avisos.Add($"La cuenta {donde} está cerrada pero no trae numcheque: no se manda.");
                continue;
            }

            var cheque = MapearCuenta(
                cuenta, donde, partidasDe.GetValueOrDefault((cuenta.Origen, cuenta.Folio)) ?? [],
                pagosDe.GetValueOrDefault((cuenta.Origen, cuenta.Folio)) ?? [], zonaSr, avisos, errores, out var incompleta);
            if (incompleta)
            {
                releer.Add((cuenta.Origen, cuenta.Folio));
            }

            if (cheque is not null)
            {
                candidatos.Add(cheque);
            }
        }

        var elegidos = new List<ChequeMapeado>();
        foreach (var grupo in candidatos.GroupBy(c => c.FolioSr, StringComparer.Ordinal))
        {
            var definitivas = grupo.Where(c => c.Origen == OrigenCuenta.Definitiva).ToList();
            var temporales = grupo.Where(c => c.Origen == OrigenCuenta.Temporal).ToList();
            if (definitivas.Count > 1 || temporales.Count > 1)
            {
                // DECISION PROVISIONAL (nocturno): numcheque es la llave (folio del ticket; sobrevive al
                // corte y no reinició por turno en F1-090) pero la base no lo obliga a ser único. Dos
                // cuentas con el mismo en una lectura se quedan sin mandar: el upsert del API pisaría una
                // venta con otra sin avisar. Es la decisión abierta de esquema-sr §2.
                errores.Add(
                    $"El folio {grupo.Key} aparece en {grupo.Count()} cuentas distintas de SoftRestaurant: no se manda " +
                    "ninguna (la llave del cheque no sería única). Ver docs/esquema-sr.md §2.");
                continue;
            }

            // La misma cuenta puede verse en tempcheques y en cheques mientras corre el corte: manda la de
            // cheques. Si las dos traen OTRA apertura no son la misma cuenta: es una colisión de llave.
            if (definitivas.Count == 1 && temporales.Count == 1 && definitivas[0].AbiertoLocal != temporales[0].AbiertoLocal)
            {
                errores.Add(
                    $"El folio {grupo.Key} aparece en tempcheques y en cheques en cuentas con distinta apertura: no se " +
                    "manda ninguna (la llave del cheque no sería única). Ver docs/esquema-sr.md §2.");
                continue;
            }

            elegidos.Add(definitivas.Count == 1 ? definitivas[0] : temporales[0]);
        }

        return new ChequesMapeados(elegidos, avisos, errores, releer);
    }

    private static ChequeMapeado? MapearCuenta(
        FilaCuenta cuenta, string donde, List<FilaPartida> filasPartida, List<FilaPago> filasPago, TimeZoneInfo zonaSr,
        List<string> avisos, List<string> errores, out bool incompleta)
    {
        // Un dato nulo no se arregla releyendo: la cuenta se queda fuera sin detener el cursor. Sólo la
        // cuenta a la que le faltan filas (abajo) se vuelve a leer.
        incompleta = false;
        if (cuenta.Fecha is not { } fecha || cuenta.Subtotal is not { } subtotal || cuenta.Total is not { } total)
        {
            avisos.Add($"La cuenta {donde} no trae fecha, subtotal o total: no se manda.");
            return null;
        }

        var partidas = ArmarPartidas(filasPartida, donde, avisos, errores, out var completas, out var excede);
        if (excede || filasPago.Count > MaxPagos)
        {
            if (filasPago.Count > MaxPagos)
            {
                errores.Add($"La cuenta {donde} trae {filasPago.Count} pagos y el contrato admite {MaxPagos}: no se manda.");
            }

            return null;
        }

        if (!completas)
        {
            return null;
        }

        if (filasPago.Any(p => p.Importe is null))
        {
            avisos.Add($"La cuenta {donde} trae un pago sin importe: no se manda.");
            return null;
        }

        // Una lectura a media escritura de SR (o a medio corte) puede traer la cuenta sin todas sus filas.
        // Σ pagos = total se cumplió en todas las cuentas cobradas de F1-090. ⚠️ SUPUESTO: una cuenta
        // CANCELADA (cancelado = 1) nunca se ha visto en SR (no se pudo provocar en F1-090): no se sabe si
        // conserva partidas, pagos ni su total. Por eso viaja sin esta revisión, tal como venga.
        if (!cuenta.Cancelado
            && (partidas.Count == 0 || Math.Abs(filasPago.Sum(p => p.Importe!.Value) - total) >= ToleranciaPagos))
        {
            avisos.Add($"La cuenta {donde} llegó incompleta (sin partidas, o sus pagos no suman el total): se relee en el siguiente ciclo.");
            incompleta = true;
            return null;
        }

        var serie = Limpio(cuenta.SerieFolio);
        var folio = cuenta.NumCheque!.Value.ToString(CultureInfo.InvariantCulture);
        // DECISION PROVISIONAL (nocturno): folioSr = folio del ticket = numcheque (con su serie si la
        // hay). Ni cheques.folio (lo reasigna el corte) ni tempcheques.folio (reinicia por turno) son
        // estables (F1-090, esquema-sr §2). Si numcheque reinicia por año o serie, falta algo en la llave.
        var folioSr = serie is null ? folio : $"{serie}-{folio}";

        using var buffer = new MemoryStream();
        using (var json = new Utf8JsonWriter(buffer))
        {
            json.WriteStartObject();
            json.WriteString("folioSr", folioSr);
            json.WriteString("folio", folioSr);
            json.WriteString("abiertoAt", ConZona(fecha, zonaSr));
            // cierre es la hora de IMPRESIÓN: SR no guarda la de cobro (esquema-sr §2). Es la más cercana.
            if (cuenta.Cierre is { } cierre)
            {
                json.WriteString("cerradoAt", ConZona(cierre, zonaSr));
            }
            else
            {
                json.WriteNull("cerradoAt");
            }

            EscribirTextoONulo(json, "mesa", Limpio(cuenta.Mesa));
            EscribirTextoONulo(json, "mesero", Limpio(cuenta.Mesero));
            if (cuenta.Comensales is >= 0 and <= 10000)
            {
                json.WriteNumber("comensales", cuenta.Comensales.Value);
            }
            else
            {
                json.WriteNull("comensales");
            }

            EscribirTextoONulo(json, "clienteOrigenSrId", Limpio(cuenta.Cliente));
            EscribirTextoONulo(json, "areaOrigenSrId", Limpio(cuenta.Area));
            // SR guarda subtotal SIN IVA pero ANTES del descuento general; la venta neta es la resta (§2).
            json.WriteString("subtotal", Importe(subtotal - (cuenta.DescuentoImporte ?? 0m)));
            // Un NULL de SR en estos tres es "no hubo": no se distingue de 0 en ninguna cuenta vista.
            json.WriteString("impuestos", Importe(cuenta.Impuestos ?? 0m));
            // DECISION PROVISIONAL (nocturno): las cortesías (descuentos del 100 %, totalcortesias) van
            // sumadas en descuentos porque el contrato no tiene campo propio. Si se agrega, se separan.
            json.WriteString("descuentos", Importe((cuenta.TotalDescuentos ?? 0m) + (cuenta.TotalCortesias ?? 0m)));
            json.WriteString("propina", Importe(cuenta.Propina ?? 0m));
            // total ya viene sin propina; cheques.efectivo/tarjeta la INCLUYEN y nunca se usan (§2).
            json.WriteString("total", Importe(total));
            json.WriteBoolean("cancelado", cuenta.Cancelado);

            json.WriteStartArray("partidas");
            foreach (var partida in partidas)
            {
                partida.Escribir(json);
            }

            json.WriteEndArray();
            json.WriteStartArray("pagos");
            foreach (var pago in filasPago)
            {
                json.WriteStartObject();
                json.WriteString("formaRaw", Limpio(pago.Forma) ?? Limpio(pago.IdFormaDePago) ?? "(sin forma de pago)");
                json.WriteString("monto", Importe(pago.Importe!.Value));
                json.WriteEndObject();
            }

            json.WriteEndArray();
            json.WriteEndObject();
        }

        var payload = Encoding.UTF8.GetString(buffer.ToArray());
        var huella = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload)));
        return new ChequeMapeado(
            folioSr, cuenta.Origen, cuenta.Folio, fecha.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture),
            payload, huella);
    }

    private static List<PartidaArmada> ArmarPartidas(
        List<FilaPartida> filas, string donde, List<string> avisos, List<string> errores, out bool completas,
        out bool excede)
    {
        var partidas = new List<PartidaArmada>();
        completas = false;
        excede = false;
        foreach (var fila in filas)
        {
            var nombre = Limpio(fila.Producto) ?? Limpio(fila.IdProducto);
            if (nombre is null || fila.Cantidad is not { } cantidad || fila.Precio is not { } precio)
            {
                avisos.Add($"La cuenta {donde} trae una partida sin producto, cantidad o precio: no se manda.");
                return partidas;
            }

            // DECISION PROVISIONAL (nocturno): una fila con modificador = 1 es un modificador de la
            // partida anterior. Nunca se vio vender uno en F1-090 (esquema-sr §3).
            if (fila.Modificador && partidas.Count > 0)
            {
                partidas[^1].Modificadores.Add((nombre, precio));
                continue;
            }

            partidas.Add(new PartidaArmada(nombre, Limpio(fila.Categoria), cantidad, precio, fila.Descuento ?? 0m));
        }

        if (partidas.Count > MaxPartidas || partidas.Any(p => p.Modificadores.Count > MaxModificadores))
        {
            errores.Add(
                $"La cuenta {donde} excede el contrato ({MaxPartidas} partidas, {MaxModificadores} modificadores por " +
                "partida): no se manda.");
            excede = true;
            return partidas;
        }

        completas = true;
        return partidas;
    }

    private sealed record PartidaArmada(string Producto, string? Categoria, decimal Cantidad, decimal Precio, decimal Descuento)
    {
        public List<(string Nombre, decimal Precio)> Modificadores { get; } = [];

        public void Escribir(Utf8JsonWriter json)
        {
            json.WriteStartObject();
            json.WriteString("producto", Recortar(Producto, 200));
            EscribirTextoONulo(json, "categoria", Categoria is null ? null : Recortar(Categoria, 200));
            json.WriteString("cantidad", Cantidad3(Cantidad));
            json.WriteString("precioUnit", Importe(Precio));
            // SR no guarda el importe de la partida: es cantidad × precio con su % de descuento (§3).
            json.WriteString("total", Importe(Cantidad * Precio * (1m - Descuento / 100m)));
            if (Modificadores.Count > 0)
            {
                json.WriteStartArray("modificadores");
                foreach (var (nombre, precio) in Modificadores)
                {
                    json.WriteStartObject();
                    json.WriteString("nombre", Recortar(nombre, 200));
                    json.WriteString("precio", Importe(precio));
                    json.WriteEndObject();
                }

                json.WriteEndArray();
            }

            json.WriteEndObject();
        }
    }

    /// <summary>
    /// Una fecha de SR (hora local de la PC, sin zona) con el offset que tenía la zona en ESE instante.
    /// </summary>
    internal static string ConZona(DateTime local, TimeZoneInfo zona)
    {
        var sinTipo = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
        return new DateTimeOffset(sinTipo, zona.GetUtcOffset(sinTipo))
            .ToString("yyyy-MM-dd'T'HH:mm:ss.fffzzz", CultureInfo.InvariantCulture);
    }

    /// <summary>Importe del contrato: texto decimal con hasta 4 decimales (el <c>money</c> de SR).</summary>
    internal static string Importe(decimal valor) =>
        Math.Round(valor, 4, MidpointRounding.AwayFromZero).ToString("0.####", CultureInfo.InvariantCulture);

    private static string Cantidad3(decimal valor) =>
        Math.Round(valor, 3, MidpointRounding.AwayFromZero).ToString("0.###", CultureInfo.InvariantCulture);

    private static string? Limpio(string? texto) =>
        string.IsNullOrWhiteSpace(texto) ? null : texto.Trim();

    private static string Recortar(string texto, int maximo) => texto.Length <= maximo ? texto : texto[..maximo];

    private static void EscribirTextoONulo(Utf8JsonWriter json, string nombre, string? valor)
    {
        if (valor is null)
        {
            json.WriteNull(nombre);
        }
        else
        {
            json.WriteString(nombre, valor);
        }
    }
}
