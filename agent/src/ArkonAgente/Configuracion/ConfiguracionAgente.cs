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
    int IntervaloSegundos,
    TimeOnly? HoraSincronizacionCatalogos = null)
{
    public const int IntervaloPorDefecto = 30;

    /// <summary>
    /// A qué hora (reloj de ESTA PC, no de la sucursal en el panel) corre la sincronización
    /// diaria de catálogos (F2-240) si <c>config.json</c> no dice otra.
    /// </summary>
    public static readonly TimeOnly HoraCatalogosPorDefecto = new(4, 0);

    public TimeOnly HoraCatalogos => HoraSincronizacionCatalogos ?? HoraCatalogosPorDefecto;
    public const int IntervaloMinimo = 5;
    public const int IntervaloMaximo = 3600;

    // El record generado imprimiría la API key y la cadena en un ToString().
    public override string ToString() =>
        $"ConfiguracionAgente {{ ApiUrl = {ApiUrl}, IntervaloSegundos = {IntervaloSegundos}, " +
        $"HoraCatalogos = {HoraCatalogos.ToString("HH:mm", System.Globalization.CultureInfo.InvariantCulture)} }}";
}
