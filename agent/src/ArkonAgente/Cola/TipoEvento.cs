namespace ArkonAgente.Cola;

/// <summary>Los tipos de evento del contrato de <c>POST /ingesta/eventos</c> (F1-031).</summary>
internal enum TipoEvento
{
    Cheque,
    Snapshot,
    Heartbeat,
}

internal static class TiposEvento
{
    /// <summary>El valor de <c>tipo</c> en el contrato y en la columna <c>eventos.tipo</c>.</summary>
    public static string Texto(this TipoEvento tipo) => tipo switch
    {
        TipoEvento.Cheque => "cheque",
        TipoEvento.Snapshot => "snapshot",
        TipoEvento.Heartbeat => "heartbeat",
        _ => throw new ArgumentOutOfRangeException(nameof(tipo), tipo, null),
    };
}
