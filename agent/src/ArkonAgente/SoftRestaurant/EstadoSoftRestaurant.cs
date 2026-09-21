namespace ArkonAgente.SoftRestaurant;

/// <summary>
/// Lo último que el agente sabe de SoftRestaurant: el reader elegido, la versión, el
/// último error de detección y la última sonda (F1-025). Es un singleton: el worker
/// lo escribe y el heartbeat lo lee.
/// </summary>
internal sealed class EstadoSoftRestaurant
{
    private readonly object _candado = new();
    private ResultadoDeteccion? _ultimo;
    private ResultadoSondeo? _ultimoSondeo;
    private DateTimeOffset? _ultimaLecturaAt;

    /// <summary>Resultado de la última detección; <c>null</c> si aún no se intentó.</summary>
    public ResultadoDeteccion? Ultimo
    {
        get { lock (_candado) { return _ultimo; } }
    }

    public ISoftRestaurantReader? Reader => Ultimo?.Reader;

    public string? VersionSr => Ultimo?.VersionSr;

    public string? UltimoError => Ultimo?.Error;

    /// <summary>Última vez que la sonda respondió (UTC). No retrocede si la sonda falla.</summary>
    public DateTimeOffset? UltimaLecturaAt
    {
        get { lock (_candado) { return _ultimaLecturaAt; } }
    }

    /// <summary>Latencia de la ÚLTIMA sonda; <c>null</c> si falló o no ha corrido.</summary>
    public int? LatenciaQueryMs
    {
        get { lock (_candado) { return _ultimoSondeo?.LatenciaMs; } }
    }

    /// <summary>Error de la ÚLTIMA sonda; <c>null</c> si respondió o no ha corrido.</summary>
    public string? ErrorLectura
    {
        get { lock (_candado) { return _ultimoSondeo?.Error; } }
    }

    public void Registrar(ResultadoDeteccion resultado)
    {
        lock (_candado)
        {
            _ultimo = resultado;
        }
    }

    public void RegistrarSondeo(ResultadoSondeo resultado)
    {
        lock (_candado)
        {
            _ultimoSondeo = resultado;
            if (resultado.Ok)
            {
                _ultimaLecturaAt = resultado.Instante;
            }
        }
    }
}
