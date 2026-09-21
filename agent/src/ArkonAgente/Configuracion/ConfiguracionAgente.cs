namespace ArkonAgente.Configuracion;

/// <summary>
/// Configuración ya validada del agente, tal como sale de <c>config.json</c>.
/// </summary>
/// <remarks>
/// <see cref="ApiKey"/> y <see cref="ConnectionString"/> son secretos del cliente:
/// nunca se escriben en un log, en la consola ni en un mensaje de error. Para
/// mostrar la conexión se usa <see cref="Sql.ConexionSoftRestaurant.Resumen"/>.
/// </remarks>
internal sealed record ConfiguracionAgente(
    Uri ApiUrl,
    string ApiKey,
    string ConnectionString,
    int IntervaloSegundos)
{
    public const int IntervaloPorDefecto = 30;
    public const int IntervaloMinimo = 5;
    public const int IntervaloMaximo = 3600;

    // El record generado imprimiría la API key y la cadena en un ToString().
    public override string ToString() =>
        $"ConfiguracionAgente {{ ApiUrl = {ApiUrl}, IntervaloSegundos = {IntervaloSegundos} }}";
}
