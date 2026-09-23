using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using ArkonAgente.Configuracion;

namespace ArkonAgente.Actualizacion;

/// <summary>
/// La versión del canal (F2-143): <c>X.Y.Z</c>, cada parte de 1 a 4 dígitos. El MISMO formato que
/// el CHECK de <c>versiones_agente</c> y el <c>REGEX_VERSION_AGENTE</c> del api.
/// </summary>
internal static partial class VersionCanal
{
    [GeneratedRegex(@"^\d{1,4}\.\d{1,4}\.\d{1,4}$", RegexOptions.CultureInvariant)]
    private static partial Regex Formato();

    [GeneratedRegex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex FormatoSha();

    /// <summary>Tope del binario: el mismo que acepta el api al publicar (128 MB).</summary>
    public const long TamanoMaximo = 128L * 1024 * 1024;

    public static bool EsValida(string? version) => version is not null && Formato().IsMatch(version);

    public static bool EsShaValido(string? sha) => sha is not null && FormatoSha().IsMatch(sha);

    /// <summary><c>1.2.0+1a99dc7</c> → <c>1.2.0</c>; null si lo que queda no es X.Y.Z.</summary>
    public static string? SinCommit(string? version)
    {
        if (version is null)
        {
            return null;
        }

        var baseVersion = version.Split('+')[0].Trim();
        return EsValida(baseVersion) ? baseVersion : null;
    }

    /// <summary>SHA-256 de un archivo, en hex minúsculas, leído en streaming.</summary>
    public static async Task<string> ShaDeArchivoAsync(string ruta, CancellationToken cancelacion)
    {
        await using var flujo = new FileStream(ruta, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true);
        var hash = await SHA256.HashDataAsync(flujo, cancelacion);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}

/// <summary>
/// La carpeta de intercambio entre el servicio del agente y el watchdog (F2-143):
/// <c>C:\ProgramData\ArkonAgente\actualizacion\</c>, dentro de la carpeta protegida del agente
/// (F1-026). Los NOMBRES son fijos: el watchdog nunca toma una ruta de un archivo que escribió el
/// agente (lo pidió el revisor: un <c>..</c> o una ruta absoluta en la solicitud haría que el
/// watchdog, que corre como SYSTEM, instalara cualquier archivo).
/// </summary>
internal sealed record CarpetaActualizacion(string Ruta)
{
    public const string NombreCarpeta = "actualizacion";

    public static CarpetaActualizacion De(RutasAgente rutas) => new(Path.Combine(rutas.Carpeta, NombreCarpeta));

    /// <summary>El binario ya verificado, listo para que el watchdog lo instale.</summary>
    public string Preparado => Path.Combine(Ruta, "preparado.exe");

    /// <summary>La descarga en curso. Nunca se usa sin verificar y renombrar a <see cref="Preparado"/>.</summary>
    public string Descarga => Path.Combine(Ruta, "preparado.exe.descarga");

    /// <summary>La orden del agente al watchdog: "instala esta versión, con este SHA-256".</summary>
    public string Solicitud => Path.Combine(Ruta, "solicitud.json");

    /// <summary>Lo que hizo el watchdog; el agente lo reporta al api y lo borra.</summary>
    public string Resultado => Path.Combine(Ruta, "resultado.json");

    /// <summary>El estado de reintentos del agente (SQLite: ver <see cref="EstadoActualizacion"/>).</summary>
    public string Estado => Path.Combine(Ruta, "estado.db");

    public void Crear() => Directory.CreateDirectory(Ruta);
}

/// <summary>La orden del agente al watchdog. Todo se valida al leerla.</summary>
internal sealed record SolicitudActualizacion(string Version, string Sha256, long TamanoBytes)
{
    public bool EsValida() =>
        VersionCanal.EsValida(Version) && VersionCanal.EsShaValido(Sha256) &&
        TamanoBytes > 0 && TamanoBytes <= VersionCanal.TamanoMaximo;
}

/// <summary>
/// Lo que hizo el watchdog con una solicitud. <see cref="Motivo"/> usa los mismos valores que el
/// enum <c>motivo_falla_actualizacion</c> del api.
/// </summary>
internal sealed record ResultadoActualizacion(string Resultado, string Version, string Sha256, string? Motivo, string? Detalle)
{
    public const string Aplicada = "aplicada";
    public const string Fallida = "fallida";

    public static ResultadoActualizacion Bien(SolicitudActualizacion s) => new(Aplicada, s.Version, s.Sha256, null, null);

    public static ResultadoActualizacion Falla(SolicitudActualizacion s, string motivo, string detalle) =>
        new(Fallida, s.Version, s.Sha256, motivo, detalle);
}

/// <summary>Los motivos de falla, como los espera el api.</summary>
internal static class MotivoFalla
{
    public const string HashInvalido = "hash_invalido";
    public const string Descarga = "descarga";
    public const string Detener = "detener";
    public const string Reemplazo = "reemplazo";
    public const string Arranque = "arranque";
    public const string VersionDistinta = "version_distinta";
}

/// <summary>JSON de la carpeta de intercambio: escritura atómica y lectura que no confía.</summary>
internal static class ArchivoIntercambio
{
    private static readonly JsonSerializerOptions Opciones = new(JsonSerializerDefaults.Web);

    /// <summary>Escribe a un temporal y lo renombra: el otro proceso nunca lee un JSON a medias.</summary>
    public static void EscribirAtomico<T>(string ruta, T valor)
    {
        var temporal = ruta + "." + Guid.NewGuid().ToString("N") + ".tmp";
        File.WriteAllText(temporal, JsonSerializer.Serialize(valor, Opciones));
        File.Move(temporal, ruta, overwrite: true);
    }

    /// <summary>Null si no existe, es un reparse point, pasa de 4 KB o no se entiende.</summary>
    public static T? Leer<T>(string ruta) where T : class
    {
        try
        {
            var info = new FileInfo(ruta);
            if (!info.Exists || EsReparsePoint(ruta) || info.Length > 4096)
            {
                return null;
            }

            return JsonSerializer.Deserialize<T>(File.ReadAllText(ruta), Opciones);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// ¿Es un symlink, junction u otro reparse point? El watchdog corre como SYSTEM: nunca sigue uno
    /// dentro de la carpeta de intercambio (así no se le hace leer o instalar un archivo de otro lado).
    /// </summary>
    public static bool EsReparsePoint(string ruta)
    {
        try
        {
            return (File.GetAttributes(ruta) & FileAttributes.ReparsePoint) != 0;
        }
        catch (FileNotFoundException)
        {
            return false;
        }
        catch (DirectoryNotFoundException)
        {
            return false;
        }
    }

    public static void BorrarSiExiste(string ruta)
    {
        try
        {
            File.Delete(ruta);
        }
        catch (DirectoryNotFoundException)
        {
        }
    }
}
