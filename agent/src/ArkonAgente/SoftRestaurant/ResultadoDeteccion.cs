namespace ArkonAgente.SoftRestaurant;

internal enum EstadoDeteccion
{
    /// <summary>Versión reconocida y reader elegido.</summary>
    Soportada,

    /// <summary>Se leyó la base, pero no es una versión que el agente sepa leer.</summary>
    NoSoportada,

    /// <summary>No se pudo consultar la base (servidor apagado, credenciales, permisos).</summary>
    SinConexion,
}

/// <summary>
/// Resultado de detectar SoftRestaurant. <see cref="VersionSr"/> y <see cref="Error"/>
/// son lo que el heartbeat (F1-025) reporta; se acotan aquí a lo que acepta el DTO
/// del api (50 y 2000 caracteres). Ningún mensaje trae la contraseña ni la cadena de
/// conexión: el servidor, la base y el usuario salen de
/// <c>ConexionSoftRestaurant.Resumen()</c>.
/// </summary>
/// <param name="Aviso">
/// Sólo con <see cref="EstadoDeteccion.Soportada"/>: algo que el técnico debe saber
/// aunque el reader se haya elegido (p. ej. una versión que nunca se ha visto).
/// </param>
internal sealed record ResultadoDeteccion
{
    public const int LargoMaximoVersion = 50;
    public const int LargoMaximoError = 2000;

    private ResultadoDeteccion(
        EstadoDeteccion estado, ISoftRestaurantReader? reader, string? versionSr, string? error, string? aviso)
    {
        Estado = estado;
        Reader = reader;
        VersionSr = Acotar(versionSr, LargoMaximoVersion);
        Error = Acotar(error, LargoMaximoError);
        Aviso = aviso;
    }

    public EstadoDeteccion Estado { get; }

    public ISoftRestaurantReader? Reader { get; }

    public string? VersionSr { get; }

    public string? Error { get; }

    public string? Aviso { get; }

    public static ResultadoDeteccion Soportada(ISoftRestaurantReader reader, string? aviso = null) =>
        new(EstadoDeteccion.Soportada, reader, reader.Version.Texto, null, aviso);

    public static ResultadoDeteccion NoSoportada(string error, string? versionSr = null) =>
        new(EstadoDeteccion.NoSoportada, null, versionSr, error, null);

    public static ResultadoDeteccion SinConexion(string error) =>
        new(EstadoDeteccion.SinConexion, null, null, error, null);

    private static string? Acotar(string? texto, int largo) =>
        texto is null || texto.Length <= largo ? texto : texto[..(largo - 1)] + "…";
}
