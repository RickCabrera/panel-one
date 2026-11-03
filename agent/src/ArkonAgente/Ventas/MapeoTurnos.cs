using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace ArkonAgente.Ventas;

/// <summary>Un turno tal como sale de <c>sr_turnos.sql</c>. Fechas en hora local de SR, sin zona.</summary>
internal sealed record FilaTurno(
    long? IdTurno,
    DateTime? Apertura,
    DateTime? Cierre,
    string? Estacion,
    decimal? Fondo,
    decimal? Efectivo,
    decimal? Tarjeta,
    decimal? Vales,
    decimal? Credito);

/// <summary>Un turno listo para encolar: el <c>datos</c> del evento <c>turno</c> y su huella.</summary>
/// <param name="AperturaLocal">La apertura tal como la guarda SR: detecta un <c>idturno</c> reusado.</param>
internal sealed record TurnoMapeado(string TurnoSr, string AperturaLocal, string Payload, string Huella);

/// <summary>Lo que se manda, y por qué no se manda lo demás (Warning en el log).</summary>
internal sealed record TurnosMapeados(IReadOnlyList<TurnoMapeado> Turnos, IReadOnlyList<string> Avisos);

/// <summary>
/// Traduce las filas de <c>sr_turnos.sql</c> al contrato del evento <c>turno</c> de
/// <c>POST /ingesta/eventos</c> (<c>DatosTurnoDto</c>, api/src/ingesta/dto/ingesta.dto.ts). Puro: sin
/// SQL ni reloj. El significado de las columnas está VALIDADO en F1-090 (docs/esquema-sr.md §2,
/// "Turnos"); lo que no se vio va marcado.
/// </summary>
internal static class MapeoTurnos
{
    /// <summary>Largo máximo de <c>estacion</c> en el contrato.</summary>
    public const int MaxEstacion = 100;

    public static TurnosMapeados Mapear(IReadOnlyList<FilaTurno> filas, TimeZoneInfo zonaSr)
    {
        var avisos = new List<string>();
        var turnos = new List<TurnoMapeado>();
        var vistos = new HashSet<long>();
        foreach (var fila in filas)
        {
            if (fila.IdTurno is not { } id || id <= 0 || fila.Apertura is not { } apertura)
            {
                // Sin llave o sin apertura no hay turno que mandar: no se inventa.
                var cual = fila.IdTurno?.ToString(CultureInfo.InvariantCulture) ?? "NULL";
                avisos.Add($"Un turno de SoftRestaurant no trae idturno o apertura (idturno {cual}): no se manda.");
                continue;
            }

            if (!vistos.Add(id))
            {
                // DECISION PROVISIONAL (nocturno): idturno se supone único (sólo se vieron 1 y 2). Si
                // aparece repetido en una lectura, ninguno se manda: el upsert del API pisaría uno con otro.
                var texto = id.ToString(CultureInfo.InvariantCulture);
                avisos.Add($"El turno {texto} aparece más de una vez en dbo.turnos: no se manda ninguno. Ver docs/esquema-sr.md §2.");
                turnos.RemoveAll(t => t.TurnoSr == texto);
                continue;
            }

            turnos.Add(MapearFila(id, apertura, fila, zonaSr));
        }

        return new TurnosMapeados(turnos, avisos);
    }

    private static TurnoMapeado MapearFila(long idTurno, DateTime apertura, FilaTurno fila, TimeZoneInfo zonaSr)
    {
        var turnoSr = idTurno.ToString(CultureInfo.InvariantCulture);
        using var buffer = new MemoryStream();
        using (var json = new Utf8JsonWriter(buffer))
        {
            json.WriteStartObject();
            json.WriteString("turnoSr", turnoSr);
            // Hora local de la PC del POS con el offset de su zona en ESE instante, igual que los cheques.
            json.WriteString("aperturaAt", MapeoCheques.ConZona(apertura, zonaSr));
            if (fila.Cierre is { } cierre)
            {
                json.WriteString("cierreAt", MapeoCheques.ConZona(cierre, zonaSr));
            }
            else
            {
                json.WriteNull("cierreAt");
            }

            var estacion = string.IsNullOrWhiteSpace(fila.Estacion) ? null : fila.Estacion.Trim();
            if (estacion is null)
            {
                json.WriteNull("estacion");
            }
            else
            {
                json.WriteString("estacion", estacion.Length <= MaxEstacion ? estacion : estacion[..MaxEstacion]);
            }

            // Un NULL de SR en estos importes es "no se capturó": se manda 0 (en F1-090 los declarados
            // se vieron en 0.00 tras el corte; mientras el turno está abierto, SR los deja en 0).
            json.WriteString("fondo", MapeoCheques.Importe(fila.Fondo ?? 0m));
            json.WriteString("declaradoEfectivo", MapeoCheques.Importe(fila.Efectivo ?? 0m));
            json.WriteString("declaradoTarjeta", MapeoCheques.Importe(fila.Tarjeta ?? 0m));
            json.WriteString("declaradoVales", MapeoCheques.Importe(fila.Vales ?? 0m));
            json.WriteString("declaradoCredito", MapeoCheques.Importe(fila.Credito ?? 0m));
            json.WriteEndObject();
        }

        var payload = Encoding.UTF8.GetString(buffer.ToArray());
        var huella = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload)));
        return new TurnoMapeado(
            turnoSr, apertura.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture), payload, huella);
    }
}
