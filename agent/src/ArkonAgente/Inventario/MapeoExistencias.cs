using System.Data;
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace ArkonAgente.Inventario;

/// <summary>Un renglón de la foto, ya en texto del contrato. <c>Costo</c> nulo = SR no lo tiene.</summary>
internal sealed record RegistroExistencia(string Insumo, string Cantidad, string? Costo);

/// <summary>La foto completa de UN almacén (0 registros = el almacén no tiene nada en SR).</summary>
/// <param name="Huerfano">Sus filas de <c>acumuladoinsumos</c> apuntan a un almacén que no está en <c>dbo.almacen</c>.</param>
internal sealed record FotoAlmacen(string Almacen, IReadOnlyList<RegistroExistencia> Registros, bool Huerfano);

/// <summary>Lo que salió de leer las existencias de SoftRestaurant.</summary>
/// <param name="Fotos">Las que se pueden mandar (≤ <see cref="MapeoExistencias.MaxRegistrosPorFoto"/>).</param>
/// <param name="Excedidas">Almacenes con más registros de los que caben en una foto: NO se mandan.</param>
/// <param name="FilasSql">Filas que devolvió la consulta.</param>
/// <param name="Avisos">Rarezas del POS que van al log (sin valores de costo ni cantidades).</param>
internal sealed record ExistenciasLeidas(
    IReadOnlyList<FotoAlmacen> Fotos,
    IReadOnlyList<(string Almacen, int Registros)> Excedidas,
    int FilasSql,
    IReadOnlyList<string> Avisos);

/// <summary>
/// Convierte las filas de <c>sr_existencias.sql</c> en fotos por almacén para
/// <c>POST /ingesta/existencias</c> (F2-121). Es PURO: recibe un <see cref="IDataReader"/>, así que
/// los tests lo alimentan con fixtures sin SQL Server. Todo en <c>decimal</c>, nunca <c>double</c>.
/// </summary>
/// <remarks>
/// Obligaciones del contrato (docs/esquema-sr.md §10 y §13) y cómo se cumplen:
/// <list type="bullet">
/// <item>TODAS las filas del almacén, también en 0 y negativas: se manda cada fila de
/// <c>acumuladoinsumos</c> tal cual, sin filtrar.</item>
/// <item>Cantidad en texto NUMERIC(12,3): DECISION PROVISIONAL (nocturno) SR la guarda con 4
/// decimales y se redondea a 3 mitad lejos de cero (0.0004 viaja 0.000; −0.0005 viaja −0.001). Lo
/// que cambió al redondear se cuenta en un aviso. Una que no cabe (10 enteros) viaja igual: el API
/// rechaza ese registro solo y el agente lo avisa; nunca se trunca.</item>
/// <item>Costo con la regla de dinero: el <c>costopromedio</c> de SR tal cual (el API redondea a 2).
/// DECISION PROVISIONAL (nocturno): sin costo (no hay fila de <c>insumosdetalle</c> para la empresa
/// del almacén, o hay varias con costos distintos) viaja <c>costoPromedio: null</c>: el API rechaza
/// ese registro solo y conserva su fila anterior (no se inventa $0 ni se borra). Consecuencia: un
/// insumo NUEVO sin costo no aparece en el panel, y uno viejo muestra su último costo.</item>
/// <item>Foto de un almacén sin filas = vacía (la lectura sí salió bien). Una lectura que falla lanza
/// y el que llama no manda nada.</item>
/// <item>A lo más 5000 registros por foto: un almacén con más va a <see cref="ExistenciasLeidas.Excedidas"/>
/// y no se manda (paginar sería cambio de contrato).</item>
/// <item>Un insumo repetido en un almacén (<c>acumuladoinsumos</c> no tiene índice único) viaja
/// repetido, sin sumar, con aviso: el API rechaza todas sus apariciones.</item>
/// </list>
/// </remarks>
internal static class MapeoExistencias
{
    /// <summary>El tope de <c>MAX_REGISTROS_EXISTENCIAS</c> del contrato (existencias.dto.ts).</summary>
    public const int MaxRegistrosPorFoto = 5000;

    private static readonly decimal TopeCantidad = 1_000_000_000m; // 9 enteros (CANTIDAD)
    private static readonly decimal TopeDinero = 10_000_000_000m; // 10 enteros (DINERO)

    public static ExistenciasLeidas Mapear(IDataReader lector)
    {
        var indices = Indices(lector);
        int iAlmacen = indices("almacen"), iHuerfano = indices("huerfano"), iFila = indices("fila"),
            iInsumo = indices("insumo"), iExistencia = indices("existencia"), iCosto = indices("costo");

        // Por almacén, en el orden en que llegan: sus filas de acumuladoinsumos con los costos vistos.
        var almacenes = new Dictionary<string, (bool Huerfano, List<(long Fila, string Insumo, decimal Existencia, List<decimal?> Costos)> Filas)>(
            StringComparer.Ordinal);
        var orden = new List<string>();
        var filasSql = 0;

        while (lector.Read())
        {
            filasSql++;
            var almacen = Texto(lector, iAlmacen)
                ?? throw new InvalidDataException("La consulta de existencias devolvió una fila sin almacén.");
            if (!almacenes.TryGetValue(almacen, out var grupo))
            {
                grupo = (Convert.ToInt32(lector.GetValue(iHuerfano), CultureInfo.InvariantCulture) == 1, []);
                almacenes[almacen] = grupo;
                orden.Add(almacen);
            }

            if (lector.IsDBNull(iFila))
            {
                continue; // almacén sin existencias: su foto va vacía
            }

            var fila = Convert.ToInt64(lector.GetValue(iFila), CultureInfo.InvariantCulture);
            decimal? costo = lector.IsDBNull(iCosto) ? null : Convert.ToDecimal(lector.GetValue(iCosto), CultureInfo.InvariantCulture);
            var ultima = grupo.Filas.Count > 0 ? grupo.Filas[^1] : default;
            if (grupo.Filas.Count > 0 && ultima.Fila == fila)
            {
                ultima.Costos.Add(costo); // otra fila de insumosdetalle de la misma empresa
                continue;
            }

            var insumo = Texto(lector, iInsumo)
                ?? throw new InvalidDataException("La consulta de existencias devolvió una fila sin insumo.");
            if (lector.IsDBNull(iExistencia))
            {
                throw new InvalidDataException("La consulta de existencias devolvió una fila sin existencia.");
            }

            var existencia = Convert.ToDecimal(lector.GetValue(iExistencia), CultureInfo.InvariantCulture);
            grupo.Filas.Add((fila, insumo, existencia, [costo]));
        }

        var fotos = new List<FotoAlmacen>();
        var excedidas = new List<(string, int)>();
        var avisos = new List<string>();
        foreach (var almacen in orden)
        {
            var (huerfano, filas) = almacenes[almacen];
            int redondeadas = 0, sinCosto = 0, costosDistintos = 0, fueraDeRango = 0;
            var registros = new List<RegistroExistencia>(filas.Count);
            foreach (var (_, insumo, existencia, costos) in filas)
            {
                var cantidad = Math.Round(existencia, 3, MidpointRounding.AwayFromZero);
                if (cantidad != existencia)
                {
                    redondeadas++;
                }

                var distintos = costos.Distinct().ToList();
                var costo = distintos.Count == 1 ? distintos[0] : null;
                if (distintos.Count > 1)
                {
                    costosDistintos++;
                }
                else if (costo is null)
                {
                    sinCosto++;
                }

                if (Math.Abs(cantidad) >= TopeCantidad || (costo is { } c && Math.Abs(c) >= TopeDinero))
                {
                    fueraDeRango++;
                }

                registros.Add(new RegistroExistencia(
                    insumo, Formatear(cantidad), costo is { } valor ? Formatear(valor) : null));
            }

            if (registros.Count > MaxRegistrosPorFoto)
            {
                excedidas.Add((almacen, registros.Count));
                continue;
            }

            if (huerfano)
            {
                avisos.Add($"El almacén {almacen} tiene existencias en acumuladoinsumos pero no está en dbo.almacen: " +
                           "su foto se manda, pero sin costo (no se sabe de qué empresa es).");
            }

            if (redondeadas > 0)
            {
                avisos.Add($"Almacén {almacen}: {redondeadas} existencia(s) con 4 decimales se redondearon a 3.");
            }

            if (sinCosto > 0)
            {
                avisos.Add($"Almacén {almacen}: {sinCosto} insumo(s) sin costo promedio en insumosdetalle para la empresa " +
                           "del almacén: viajan sin costo y el panel los rechaza (conserva lo que tenía).");
            }

            if (costosDistintos > 0)
            {
                avisos.Add($"Almacén {almacen}: {costosDistintos} insumo(s) con varias filas en insumosdetalle y costos " +
                           "distintos: viajan sin costo y el panel los rechaza (conserva lo que tenía).");
            }

            if (fueraDeRango > 0)
            {
                avisos.Add($"Almacén {almacen}: {fueraDeRango} registro(s) con una cantidad o un costo que no cabe en el " +
                           "contrato: el panel los rechaza.");
            }

            var repetidos = registros.GroupBy(r => r.Insumo, StringComparer.Ordinal).Count(g => g.Count() > 1);
            if (repetidos > 0)
            {
                avisos.Add($"Almacén {almacen}: {repetidos} insumo(s) aparecen más de una vez en acumuladoinsumos: " +
                           "viajan tal cual y el panel rechaza todas sus apariciones.");
            }

            fotos.Add(new FotoAlmacen(almacen, registros, huerfano));
        }

        return new ExistenciasLeidas(fotos, excedidas, filasSql, avisos);
    }

    /// <summary>El cuerpo de <c>POST /ingesta/existencias</c> de una foto, con los campos en orden fijo.</summary>
    public static string Payload(FotoAlmacen foto, DateTimeOffset capturadoAt)
    {
        using var memoria = new MemoryStream();
        using (var w = new Utf8JsonWriter(memoria))
        {
            w.WriteStartObject();
            w.WriteString("almacenOrigenSrId", foto.Almacen);
            w.WriteString("capturadoAt", Instante(capturadoAt));
            w.WriteStartArray("registros");
            foreach (var r in foto.Registros)
            {
                w.WriteStartObject();
                w.WriteString("insumoOrigenSrId", r.Insumo);
                w.WriteString("cantidad", r.Cantidad);
                w.WriteString("costoPromedio", r.Costo); // null se escribe null: ver el remarks
                w.WriteEndObject();
            }

            w.WriteEndArray();
            w.WriteEndObject();
        }

        return Encoding.UTF8.GetString(memoria.ToArray());
    }

    /// <summary>ISO-8601 en UTC con milisegundos, como el <c>capturadoAt</c> de los catálogos.</summary>
    public static string Instante(DateTimeOffset cuando) =>
        cuando.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    /// <summary>Texto invariante; un cero negativo (−0.0004 redondeado) viaja como cero.</summary>
    private static string Formatear(decimal valor) =>
        (valor == 0m ? 0m : valor).ToString(CultureInfo.InvariantCulture);

    private static string? Texto(IDataRecord r, int i)
    {
        if (r.IsDBNull(i))
        {
            return null;
        }

        var texto = Convert.ToString(r.GetValue(i), CultureInfo.InvariantCulture)?.TrimEnd(' ');
        return string.IsNullOrEmpty(texto) ? null : texto;
    }

    private static Func<string, int> Indices(IDataRecord registro)
    {
        var indices = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < registro.FieldCount; i++)
        {
            indices.TryAdd(registro.GetName(i), i);
        }

        return columna => indices.TryGetValue(columna, out var i)
            ? i
            : throw new InvalidDataException($"La consulta no trae la columna '{columna}'.");
    }
}
