using System.Text;
using ArkonAgente.Configuracion;
using ArkonAgente.Sql;

namespace ArkonAgente.Diagnostico;

/// <summary>Resultado completo de <c>agente test</c>.</summary>
internal sealed record ReporteDiagnostico(
    string ArchivoConfig,
    ResultadoConfiguracion Configuracion,
    IReadOnlyList<ResultadoVerificacion> Verificaciones)
{
    public const int CodigoOk = 0;
    public const int CodigoConexionFalla = 1;
    public const int CodigoConfigInvalida = 2;

    public int CodigoSalida =>
        !Configuracion.Ok ? CodigoConfigInvalida
        : Verificaciones.All(v => v.Ok) ? CodigoOk
        : CodigoConexionFalla;

    public string ComoTexto()
    {
        var sb = new StringBuilder();
        sb.AppendLine("Diagnóstico del agente ArkonAgente");
        sb.AppendLine();

        if (!Configuracion.Ok)
        {
            sb.AppendLine($"[FALLA] Configuración: {ArchivoConfig}");
            foreach (var error in Configuracion.Errores)
            {
                sb.AppendLine($"        - {error}");
            }
        }
        else
        {
            sb.AppendLine($"[OK]    Configuración: {ArchivoConfig}");
        }

        foreach (var aviso in Configuracion.Avisos)
        {
            sb.AppendLine($"        Aviso: {aviso}");
        }

        foreach (var v in Verificaciones)
        {
            sb.AppendLine($"{(v.Ok ? "[OK]   " : "[FALLA]")} {v.Nombre}: {v.Detalle}");
            if (v.Sugerencia is not null)
            {
                sb.AppendLine($"        Qué hacer: {v.Sugerencia}");
            }

            foreach (var aviso in v.AvisosOVacio)
            {
                sb.AppendLine($"        Aviso: {aviso}");
            }
        }

        sb.AppendLine();
        sb.AppendLine(Conclusion());
        return sb.ToString();
    }

    /// <summary>La última línea: dice en una frase cuál conexión falla.</summary>
    public string Conclusion()
    {
        if (!Configuracion.Ok)
        {
            return "Resultado: FALLA la configuración. Corrígela; no se probó ninguna conexión.";
        }

        var fallas = Verificaciones.Where(v => !v.Ok).Select(v => v.Nombre).ToList();
        return fallas.Count switch
        {
            0 => "Resultado: OK. Las dos conexiones funcionan.",
            1 => $"Resultado: FALLA la conexión a {fallas[0]}. La otra funciona.",
            _ => $"Resultado: FALLAN las dos conexiones: {string.Join(" y ", fallas)}.",
        };
    }
}

/// <summary>
/// Corre las dos verificaciones SIEMPRE, aunque la primera falle: el objetivo de
/// <c>agente test</c> es decir cuál de las dos conexiones falla, y si fallan las
/// dos, decirlo también.
/// </summary>
internal static class Diagnosticador
{
    /// <summary>Verificaciones reales a partir de una config válida.</summary>
    public static IReadOnlyList<IVerificacion> VerificacionesPara(ConfiguracionAgente config) =>
    [
        new VerificacionSql(new ConexionSoftRestaurant(config.ConnectionString)),
        new VerificacionApi(config),
    ];

    public static async Task<ReporteDiagnostico> EjecutarAsync(
        string archivoConfig,
        ResultadoConfiguracion configuracion,
        Func<ConfiguracionAgente, IReadOnlyList<IVerificacion>> crearVerificaciones,
        CancellationToken cancelacion)
    {
        if (configuracion.Configuracion is not { } config)
        {
            return new ReporteDiagnostico(archivoConfig, configuracion, []);
        }

        var resultados = new List<ResultadoVerificacion>();
        foreach (var verificacion in crearVerificaciones(config))
        {
            resultados.Add(await EjecutarUnaAsync(verificacion, cancelacion));
        }

        return new ReporteDiagnostico(archivoConfig, configuracion, resultados);
    }

    private static async Task<ResultadoVerificacion> EjecutarUnaAsync(IVerificacion verificacion, CancellationToken cancelacion)
    {
        try
        {
            return await verificacion.VerificarAsync(cancelacion);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancelacion.IsCancellationRequested)
        {
            // Una excepción no prevista en una verificación no debe impedir correr la
            // otra. Sólo el tipo: el mensaje podría traer la cadena de conexión.
            return ResultadoVerificacion.Falla(
                verificacion.Nombre, $"Error inesperado al verificar ({ex.GetType().Name}).");
        }
    }
}
