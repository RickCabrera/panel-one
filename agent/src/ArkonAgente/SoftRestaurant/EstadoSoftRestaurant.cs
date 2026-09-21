namespace ArkonAgente.SoftRestaurant;

/// <summary>
/// Lo último que el agente sabe de SoftRestaurant: el reader elegido, la versión y
/// el último error de detección. Es un singleton: el worker lo escribe y el
/// heartbeat (F1-025) lo lee para mandar <c>versionSr</c> y <c>ultimoError</c>.
/// </summary>
internal sealed class EstadoSoftRestaurant
{
    private ResultadoDeteccion? _ultimo;

    /// <summary>Resultado de la última detección; <c>null</c> si aún no se intentó.</summary>
    public ResultadoDeteccion? Ultimo => Volatile.Read(ref _ultimo);

    public ISoftRestaurantReader? Reader => Ultimo?.Reader;

    public string? VersionSr => Ultimo?.VersionSr;

    public string? UltimoError => Ultimo?.Error;

    public void Registrar(ResultadoDeteccion resultado) => Volatile.Write(ref _ultimo, resultado);
}
