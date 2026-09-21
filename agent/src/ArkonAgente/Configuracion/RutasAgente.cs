namespace ArkonAgente.Configuracion;

/// <summary>
/// Dónde viven la config y los logs del agente: <c>C:\ProgramData\ArkonAgente</c>
/// (<c>config.json</c> y <c>cola.db</c> en la raíz, logs en <c>logs\</c>).
/// </summary>
/// <remarks>
/// La carpeta se inyecta a todo lo demás; sólo <c>Program</c> decide cuál es. La
/// variable <c>ARKON_AGENTE_DIR</c> la cambia para desarrollo, y se lee únicamente
/// ahí (los tests pasan su propia carpeta y no tocan variables de entorno).
/// </remarks>
internal sealed record RutasAgente(string Carpeta)
{
    public const string VariableCarpeta = "ARKON_AGENTE_DIR";
    public const string NombreCarpeta = "ArkonAgente";

    public string ArchivoConfig => Path.Combine(Carpeta, "config.json");

    /// <summary>La cola local del agente (F1-024), SQLite: <c>cola.db</c>.</summary>
    public string ArchivoCola => Path.Combine(Carpeta, Cola.ColaLocal.NombreArchivo);

    public string CarpetaLogs => Path.Combine(Carpeta, "logs");

    /// <summary>Plantilla de Serilog: <c>logs\agente-AAAAMMDD.log</c>.</summary>
    public string PlantillaLog => Path.Combine(CarpetaLogs, "agente-.log");

    public static RutasAgente PorDefecto(string? carpetaDeVariable)
    {
        if (!string.IsNullOrWhiteSpace(carpetaDeVariable))
        {
            return new RutasAgente(carpetaDeVariable);
        }

        var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        return new RutasAgente(Path.Combine(programData, NombreCarpeta));
    }
}
