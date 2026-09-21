using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Json;
using ArkonAgente.Cola;

namespace ArkonAgente.Salud;

/// <summary>Todo lo que entra al heartbeat de un ciclo. Sin I/O: el worker lo junta.</summary>
/// <param name="VersionSr">La de <c>EstadoSoftRestaurant</c>: null si no se leyó, la leída aunque no se soporte.</param>
/// <param name="ErrorSr">Error de detección o, con reader, de la sonda del ciclo.</param>
/// <param name="UltimaLecturaAt">Última vez que la sonda respondió (UTC).</param>
/// <param name="LatenciaQueryMs">Latencia de la sonda del ciclo; null si falló o no corrió.</param>
/// <param name="TamanoCola">Pendientes sin contar el heartbeat.</param>
internal sealed record EntradaHeartbeat(
    string VersionAgente,
    string? VersionSr,
    string? ErrorSr,
    DateTimeOffset? UltimaLecturaAt,
    int? LatenciaQueryMs,
    int TamanoCola,
    EstadoEnvio Envio,
    ResumenRechazos Rechazos,
    DateTimeOffset Ahora);

/// <summary>
/// Arma el <c>datos</c> del evento <c>heartbeat</c> (F1-025) con la forma de
/// <c>DatosHeartbeatDto</c> (api/src/ingesta/dto/ingesta.dto.ts). Es puro: todo lo que
/// decide está aquí y se prueba sin reloj, red ni SQL Server.
/// </summary>
/// <remarks>
/// <para>
/// <c>ultimoError</c> junta hasta tres partes, separadas por <c> | </c>, en este orden:
/// <list type="number">
/// <item>Rechazos definitivos del API que siguen en la cola (7 días): un cheque
/// rechazado es una venta que falta en el panel, y si no, sólo quedaría en el log local.</item>
/// <item>El envío al API: la falla vigente o, si ya se recuperó hace menos de
/// <see cref="VentanaIncidente"/>, la última racha cerrada (durante la caída no llega
/// ningún heartbeat; al reconectar el panel tiene que poder ver qué pasó).</item>
/// <item>SoftRestaurant: la detección de versión o la sonda del ciclo.</item>
/// </list>
/// Cada parte se acota a <see cref="LargoMaximoParte"/> para que las tres quepan en
/// los 2000 del DTO, y el total también se acota.
/// </para>
/// </remarks>
internal static class ArmadorHeartbeat
{
    public const int LargoMaximoError = 2000;
    public const int LargoMaximoParte = 600;
    public const int LargoMaximoVersion = 50;
    public const string Separador = " | ";

    /// <summary>Cuánto tiempo después de recuperarse sigue reportándose la última caída del envío.</summary>
    public static readonly TimeSpan VentanaIncidente = TimeSpan.FromHours(1);

    /// <summary>
    /// <c>AssemblyInformationalVersion</c> del agente con el hash recortado a 7
    /// (<c>1.0.0+c0908e6</c>), acotada a lo que acepta el DTO.
    /// </summary>
    public static string VersionAgente() =>
        VersionAgente(typeof(ArmadorHeartbeat).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion);

    internal static string VersionAgente(string? informacional)
    {
        if (string.IsNullOrWhiteSpace(informacional))
        {
            return "desconocida";
        }

        var mas = informacional.IndexOf('+', StringComparison.Ordinal);
        var texto = mas >= 0 && informacional.Length - mas - 1 > 7 ? informacional[..(mas + 8)] : informacional;
        return Acotar(texto, LargoMaximoVersion)!;
    }

    public static string ArmarJson(EntradaHeartbeat e)
    {
        using var memoria = new MemoryStream();
        using (var json = new Utf8JsonWriter(memoria))
        {
            json.WriteStartObject();
            json.WriteString("versionAgente", Acotar(e.VersionAgente, LargoMaximoVersion));
            EscribirTextoONull(json, "versionSr", Acotar(e.VersionSr, LargoMaximoVersion));
            EscribirTextoONull(json, "ultimaLecturaAt", e.UltimaLecturaAt is { } t ? Fecha(t) : null);
            EscribirTextoONull(json, "ultimoError", UltimoError(e));
            json.WriteNumber("tamanoCola", Math.Max(0, e.TamanoCola));
            if (e.LatenciaQueryMs is { } ms)
            {
                json.WriteNumber("latenciaQueryMs", Math.Max(0, ms));
            }
            else
            {
                json.WriteNull("latenciaQueryMs");
            }

            json.WriteEndObject();
        }

        return Encoding.UTF8.GetString(memoria.ToArray());
    }

    /// <summary>Las partes del <c>ultimoError</c>; null si todo está sano.</summary>
    internal static string? UltimoError(EntradaHeartbeat e)
    {
        var partes = new[] { ParteRechazos(e.Rechazos), ParteEnvio(e.Envio, e.Ahora), e.ErrorSr }
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Select(p => Acotar(p!.Trim(), LargoMaximoParte)!)
            .ToList();
        return partes.Count == 0 ? null : Acotar(string.Join(Separador, partes), LargoMaximoError);
    }

    private static string? ParteRechazos(ResumenRechazos r)
    {
        if (r.Total == 0 || r.Ultimo is not { } ultimo)
        {
            return null;
        }

        var cheques = r.Cheques > 0
            ? $"{r.Cheques} cheque(s): son ventas que FALTAN en el panel"
            : "ningún cheque";
        var cual = ultimo.Tipo == TipoEvento.Cheque && ultimo.Clave is { } folio
            ? $"cheque folio {folio}"
            : ultimo.Tipo.Texto();
        return $"El API rechazó {r.Total} evento(s) en los últimos {ColaLocal.Retencion.TotalDays:0} días " +
               $"({cheques}). Último: {cual}, {Fecha(ultimo.RechazadoAt)}: {ultimo.Motivo}";
    }

    private static string? ParteEnvio(EstadoEnvio envio, DateTimeOffset ahora)
    {
        if (envio.FallaVigente is { } falla)
        {
            var desde = envio.Desde is { } d ? $" desde {Fecha(d)}" : "";
            return $"El envío al API falla{desde} ({envio.FallasSeguidas} intento(s)): {falla}";
        }

        if (envio.UltimoIncidente is { } inc && ahora - inc.Hasta < VentanaIncidente)
        {
            return $"El envío al API falló de {Fecha(inc.Desde)} a {Fecha(inc.Hasta)}: {inc.Mensaje}";
        }

        return null;
    }

    /// <summary>ISO-8601 UTC con milisegundos y <c>Z</c>: lo que acepta el DTO.</summary>
    internal static string Fecha(DateTimeOffset instante) =>
        instante.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    private static void EscribirTextoONull(Utf8JsonWriter json, string nombre, string? valor)
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

    /// <summary>Recorta a <paramref name="largo"/> con <c>…</c> sin partir un par sustituto (JSON inválido).</summary>
    internal static string? Acotar(string? texto, int largo)
    {
        if (texto is null || texto.Length <= largo)
        {
            return texto;
        }

        var corte = largo - 1;
        if (char.IsHighSurrogate(texto[corte - 1]))
        {
            corte--;
        }

        return texto[..corte] + "…";
    }
}
