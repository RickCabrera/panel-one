using System.Globalization;

namespace ArkonAgente.SoftRestaurant;

/// <summary>
/// Versión de la base de SoftRestaurant tal como la guarda
/// <c>dbo.parametros2.versiondb</c>.
/// </summary>
/// <remarks>
/// <para>
/// ✅ VALIDADO en SR 10.0.323: <c>versiondb</c> es <c>numeric(15,6)</c> y vale
/// <c>10.021800</c>. ⚠️ SUPUESTO: que la parte entera es la versión mayor de SR
/// (10, 11...) en todas las versiones. No se sabe cómo se relaciona la parte
/// decimal (<c>021800</c>) con la versión del ejecutable (<c>10.0.323</c>): por eso
/// se guarda y se reporta el texto tal cual. Ver docs/esquema-sr.md §1.
/// </para>
/// </remarks>
internal sealed record VersionSr(string Texto, int Mayor)
{
    /// <summary>
    /// Interpreta el texto de <c>versiondb</c>. Devuelve <c>null</c> si no es un
    /// número decimal positivo con parte entera ≥ 1 (vacío, <c>'0'</c>, letras,
    /// signo, coma decimal): una versión que no se entiende no se adivina.
    /// </summary>
    public static VersionSr? Interpretar(string? texto)
    {
        var limpio = texto?.Trim();
        if (string.IsNullOrEmpty(limpio)
            || !decimal.TryParse(limpio, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var valor)
            || valor < 1m
            || valor > int.MaxValue)
        {
            return null;
        }

        return new VersionSr(limpio, (int)decimal.Truncate(valor));
    }

    public override string ToString() => Texto;
}
