namespace ArkonAgente.Diagnostico;

/// <summary>Una de las dos comprobaciones de <c>agente test</c> (SQL Server o API).</summary>
internal interface IVerificacion
{
    string Nombre { get; }

    Task<ResultadoVerificacion> VerificarAsync(CancellationToken cancelacion);
}

/// <summary>
/// Lo que salió de una verificación. <see cref="Detalle"/> dice qué pasó y
/// <see cref="Sugerencia"/> qué hacer. Ninguno de los dos lleva secretos.
/// </summary>
internal sealed record ResultadoVerificacion(
    string Nombre,
    bool Ok,
    string Detalle,
    string? Sugerencia = null,
    IReadOnlyList<string>? Avisos = null)
{
    public IReadOnlyList<string> AvisosOVacio => Avisos ?? [];

    public static ResultadoVerificacion Bien(string nombre, string detalle, IReadOnlyList<string>? avisos = null) =>
        new(nombre, true, detalle, null, avisos);

    public static ResultadoVerificacion Falla(
        string nombre, string detalle, string? sugerencia = null, IReadOnlyList<string>? avisos = null) =>
        new(nombre, false, detalle, sugerencia, avisos);
}
