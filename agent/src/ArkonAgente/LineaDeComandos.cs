using ArkonAgente.Configuracion;
using ArkonAgente.Diagnostico;

namespace ArkonAgente;

/// <summary>
/// Comandos de consola del agente. Sin argumentos, <c>agente.exe</c> corre como
/// servicio (ver Program.cs).
/// </summary>
internal static class LineaDeComandos
{
    public const string NombreServicio = "ArkonAgente";
    public const int CodigoUso = 64;

    public const string Uso =
        """
        Uso:
          agente.exe                       Corre el agente (así lo arranca el servicio de Windows).
          agente.exe test [--config RUTA]  Valida la configuración y las conexiones a SQL Server y al API.
          agente.exe --help                Muestra esta ayuda.

        La configuración se lee de C:\ProgramData\ArkonAgente\config.json (o de RUTA).
        Códigos de salida de 'test': 0 todo OK · 1 falla alguna conexión · 2 configuración inválida.
        """;

    public static Task<int> EjecutarAsync(string[] args, RutasAgente rutas, TextWriter salida) =>
        EjecutarAsync(args, rutas, salida, CargadorConfiguracion.Cargar, Diagnosticador.VerificacionesPara, CancellationToken.None);

    internal static async Task<int> EjecutarAsync(
        string[] args,
        RutasAgente rutas,
        TextWriter salida,
        Func<string, ResultadoConfiguracion> cargarConfig,
        Func<ConfiguracionAgente, IReadOnlyList<IVerificacion>> crearVerificaciones,
        CancellationToken cancelacion)
    {
        switch (args)
        {
            case ["test"]:
                return await ProbarAsync(rutas.ArchivoConfig, salida, cargarConfig, crearVerificaciones, cancelacion);

            case ["test", "--config", var ruta] when !string.IsNullOrWhiteSpace(ruta):
                return await ProbarAsync(Path.GetFullPath(ruta), salida, cargarConfig, crearVerificaciones, cancelacion);

            case ["--help"] or ["-h"] or ["/?"] or ["help"]:
                await salida.WriteLineAsync(Uso);
                return 0;

            default:
                await salida.WriteLineAsync($"Comando no reconocido: {string.Join(' ', args)}");
                await salida.WriteLineAsync();
                await salida.WriteLineAsync(Uso);
                return CodigoUso;
        }
    }

    private static async Task<int> ProbarAsync(
        string archivoConfig,
        TextWriter salida,
        Func<string, ResultadoConfiguracion> cargarConfig,
        Func<ConfiguracionAgente, IReadOnlyList<IVerificacion>> crearVerificaciones,
        CancellationToken cancelacion)
    {
        var configuracion = cargarConfig(archivoConfig);
        var reporte = await Diagnosticador.EjecutarAsync(archivoConfig, configuracion, crearVerificaciones, cancelacion);
        await salida.WriteAsync(reporte.ComoTexto());
        return reporte.CodigoSalida;
    }
}
