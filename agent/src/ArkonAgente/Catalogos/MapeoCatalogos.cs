using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace ArkonAgente.Catalogos;

/// <summary>
/// Los catálogos que el agente manda por el contrato de F2-230: los ONCE espejos (los seis de venta
/// de F2-240 y los cinco de inventario de F2-120/F2-241) y las formas de pago (PAG-01), que llenan
/// el catálogo de formas de pago de la EMPRESA en el panel. Un forzado del panel lee los doce.
/// </summary>
internal enum CatalogoPanel
{
    Grupos,
    Productos,
    Meseros,
    Areas,
    Canales,
    Clientes,
    Unidades,
    GruposInsumo,
    Insumos,
    Almacenes,
    Proveedores,
    FormasPago,
}

internal static class CatalogosPanel
{
    /// <summary>
    /// En este orden se leen: el grupo llega antes que el producto que lo usa, y la unidad y el
    /// grupo de insumo antes que el insumo (el panel no exige el orden: no hay FK).
    /// </summary>
    public static readonly IReadOnlyList<CatalogoPanel> Todos =
    [
        CatalogoPanel.Grupos, CatalogoPanel.Productos, CatalogoPanel.Meseros,
        CatalogoPanel.Areas, CatalogoPanel.Canales, CatalogoPanel.Clientes,
        CatalogoPanel.Unidades, CatalogoPanel.GruposInsumo, CatalogoPanel.Insumos,
        CatalogoPanel.Almacenes, CatalogoPanel.Proveedores, CatalogoPanel.FormasPago,
    ];

    /// <summary>El valor del enum <c>CatalogoIngesta</c> del contrato (<c>CatalogoSr</c> + <c>formas_pago</c>).</summary>
    public static string Texto(this CatalogoPanel catalogo) => catalogo switch
    {
        CatalogoPanel.Grupos => "grupos",
        CatalogoPanel.Productos => "productos",
        CatalogoPanel.Meseros => "meseros",
        CatalogoPanel.Areas => "areas",
        CatalogoPanel.Canales => "canales",
        CatalogoPanel.Clientes => "clientes",
        CatalogoPanel.Unidades => "unidades",
        CatalogoPanel.GruposInsumo => "grupos_insumo",
        CatalogoPanel.Insumos => "insumos",
        CatalogoPanel.Almacenes => "almacenes",
        CatalogoPanel.Proveedores => "proveedores",
        CatalogoPanel.FormasPago => "formas_pago",
        _ => throw new ArgumentOutOfRangeException(nameof(catalogo), catalogo, null),
    };

    public static CatalogoPanel Parsear(string texto)
    {
        foreach (var catalogo in Todos)
        {
            if (catalogo.Texto() == texto)
            {
                return catalogo;
            }
        }

        throw new InvalidDataException($"Catálogo desconocido en la cola: '{texto}'.");
    }
}

/// <summary>
/// Un registro listo para el contrato: su <c>origenSrId</c> (para ordenar) y el objeto JSON
/// con los campos de su catálogo en orden fijo (el mismo texto entra al hash y a la página).
/// </summary>
internal sealed record RegistroCatalogo(string? OrigenSrId, string Json);

/// <summary>Lo que salió de leer un catálogo en SoftRestaurant.</summary>
/// <param name="FilasSql">Filas que devolvió la consulta (productos: una por fila de detalle).</param>
/// <param name="Avisos">Rarezas del POS que van al log (sin datos personales).</param>
internal sealed record CatalogoLeido(
    CatalogoPanel Catalogo,
    IReadOnlyList<RegistroCatalogo> Registros,
    int FilasSql,
    IReadOnlyList<string> Avisos)
{
    /// <summary>El <c>total</c> del cierre: registros YA consolidados, no filas SQL.</summary>
    public int Total => Registros.Count;
}

/// <summary>
/// Convierte las filas de las consultas <c>sr_catalogo_*.sql</c> en registros del contrato
/// de <c>POST /ingesta/catalogos</c> (F2-230, F2-145). Es PURO: recibe un
/// <see cref="IDataReader"/>, así que los tests lo alimentan con fixtures sin SQL Server.
/// </summary>
/// <remarks>
/// <para>
/// Reglas comunes (docs/esquema-sr.md §13): todo texto pierde los espacios de la DERECHA (SR
/// rellena <c>char</c>/<c>nchar</c>, y SQL Server compara <c>varchar</c> ignorándolos: para el
/// POS "A1 " y "A1" son lo mismo); un opcional vacío viaja nulo; el nombre viaja tal cual
/// (nulo o vacío lo rechaza el API, el agente no inventa uno); nada se recorta a los largos del
/// contrato (lo que no quepa lo rechaza el API, registro por registro).
/// </para>
/// <para>
/// Las columnas se buscan por nombre SIN distinguir mayúsculas: SR mezcla <c>Estatus</c> e
/// <c>Idtiposervicio</c> con columnas en minúsculas (§12). Una columna que falte o un tipo que
/// no se pueda convertir lanza: el catálogo falla solo y no se manda nada (nunca "0 filas").
/// </para>
/// </remarks>
internal static class MapeoCatalogos
{
    private static readonly JsonWriterOptions OpcionesEscritura = new() { Indented = false };

    public static CatalogoLeido Mapear(CatalogoPanel catalogo, IDataReader lector)
    {
        var columnas = new Columnas(lector);
        var avisos = new List<string>();
        var filas = 0;
        List<RegistroCatalogo> registros;

        if (catalogo == CatalogoPanel.Productos)
        {
            registros = MapearProductos(lector, columnas, avisos, ref filas);
        }
        else if (catalogo == CatalogoPanel.Insumos)
        {
            registros = MapearInsumos(lector, columnas, avisos, ref filas);
        }
        else if (catalogo == CatalogoPanel.Unidades)
        {
            registros = MapearUnidades(lector, columnas, ref filas);
        }
        else if (catalogo == CatalogoPanel.FormasPago)
        {
            registros = MapearFormasPago(lector, columnas, avisos, ref filas);
        }
        else
        {
            registros = [];
            while (lector.Read())
            {
                filas++;
                registros.Add(catalogo switch
                {
                    CatalogoPanel.Grupos => Registro(columnas.Texto(lector, "id"), columnas.Texto(lector, "id"),
                        columnas.TextoNombre(lector), null),
                    CatalogoPanel.Meseros => Registro(columnas.Texto(lector, "id"), columnas.Texto(lector, "clave"),
                        columnas.TextoNombre(lector), EstadoUnoCero(columnas.Valor(lector, "visible"), "visible", avisos)),
                    CatalogoPanel.Areas => Registro(columnas.Texto(lector, "id"), columnas.Texto(lector, "id"),
                        columnas.TextoNombre(lector), EstadoUnoCero(columnas.Valor(lector, "estatus"), "Estatus", avisos)),
                    CatalogoPanel.Canales => Registro(columnas.Texto(lector, "id"), columnas.Texto(lector, "id"),
                        columnas.TextoNombre(lector), null),
                    CatalogoPanel.Clientes => Registro(columnas.Texto(lector, "id"), columnas.Texto(lector, "id"),
                        columnas.TextoNombre(lector), null,
                        extra: w =>
                        {
                            w.WriteString("telefono", columnas.Texto(lector, "telefono"));
                            w.WriteString("correo", columnas.Texto(lector, "correo"));
                            w.WriteString("rfc", columnas.Texto(lector, "rfc"));
                        }),
                    CatalogoPanel.GruposInsumo or CatalogoPanel.Almacenes => Registro(columnas.Texto(lector, "id"),
                        columnas.Texto(lector, "id"), columnas.TextoNombre(lector), null),
                    CatalogoPanel.Proveedores => Registro(columnas.Texto(lector, "id"), columnas.Texto(lector, "id"),
                        columnas.TextoNombre(lector), EstadoUnoCero(columnas.Valor(lector, "estatus"), "estatus", avisos)),
                    _ => throw new ArgumentOutOfRangeException(nameof(catalogo), catalogo, null),
                });
            }
        }

        return new CatalogoLeido(catalogo, registros, filas, avisos);
    }

    /// <summary>
    /// SHA-256 (hex) del catálogo: los registros ordenados por <c>origenSrId</c> (ordinal) con su
    /// JSON en orden fijo. Mismo contenido en otro orden = mismo hash.
    /// </summary>
    public static string Hash(IEnumerable<RegistroCatalogo> registros)
    {
        var texto = string.Join('\n', registros
            .OrderBy(r => r.OrigenSrId, StringComparer.Ordinal)
            .ThenBy(r => r.Json, StringComparer.Ordinal)
            .Select(r => r.Json));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(texto))).ToLowerInvariant();
    }

    /// <summary>
    /// Una fila por (producto, fila de <c>productosdetalle</c>), ordenada por producto: se juntan
    /// las de un mismo producto. El precio va SIEMPRE, también nulo: omitirlo lo guarda nulo en
    /// el panel y una lectura que lo omitiera borraría precios (nota de F2-145).
    /// </summary>
    private static List<RegistroCatalogo> MapearProductos(
        IDataReader lector, Columnas columnas, List<string> avisos, ref int filas)
    {
        var registros = new List<RegistroCatalogo>();
        var porId = new Dictionary<string, int>(StringComparer.Ordinal);
        var detalles = new List<List<(decimal? Precio, bool? Bloqueado)>>();
        var bases = new List<(string? Id, string? Nombre, string? Grupo)>();

        while (lector.Read())
        {
            filas++;
            var id = columnas.Texto(lector, "id");
            var detalle = (Dinero(columnas.Valor(lector, "precio")), Bandera(columnas.Valor(lector, "bloqueado"), "bloqueado", avisos));
            if (id is not null && porId.TryGetValue(id, out var i))
            {
                detalles[i].Add(detalle);
                continue;
            }

            if (id is not null)
            {
                porId[id] = bases.Count;
            }

            bases.Add((id, columnas.TextoNombre(lector), columnas.Texto(lector, "grupo")));
            detalles.Add([detalle]);
        }

        for (var i = 0; i < bases.Count; i++)
        {
            var (id, nombre, grupo) = bases[i];
            var distintos = detalles[i].Distinct().ToList();
            decimal? precio = null;
            bool? bloqueado = null;
            if (distintos.Count == 1)
            {
                (precio, bloqueado) = distintos[0];
            }
            else
            {
                // DECISION PROVISIONAL (nocturno): productosdetalle tiene una fila por empresa del
                // POS (FK a dbo.empresas). Si un producto trae varias con precio o estado
                // distintos, no se elige una empresa al azar: precio y estado viajan nulos
                // ("el POS no lo reporta"). docs/esquema-sr.md §6, decisión abierta para Ricardo.
                avisos.Add(
                    $"El producto {id} tiene {detalles[i].Count} filas en productosdetalle con precio o estado " +
                    "distintos (varias empresas en la base de SoftRestaurant): se manda sin precio ni estado.");
            }

            registros.Add(Registro(id, id, nombre, bloqueado is null ? null : !bloqueado.Value, w =>
            {
                w.WriteString("grupoOrigenSrId", grupo);
                if (precio is { } p)
                {
                    w.WriteString("precio", p.ToString(CultureInfo.InvariantCulture));
                }
                else
                {
                    w.WriteNull("precio");
                }
            }));
        }

        return registros;
    }

    /// <summary>
    /// La clave de una unidad: la MISMA función para el <c>origenSrId</c> del catálogo
    /// <c>unidades</c> y para el <c>unidadOrigenSrId</c> del insumo, o no cruzarían.
    /// DECISION PROVISIONAL (nocturno): SR 10 no tiene tabla de unidades (docs/esquema-sr.md §9) y
    /// <c>insumos.unidad</c> es texto libre con collation <c>Modern_Spanish_CI_AS</c>: para el POS
    /// "kg", "KG" y "kg  " son la misma. Clave = sin espacios a la derecha y en mayúsculas
    /// (invariante; los acentos se respetan, como en la collation); vacía = sin unidad (nulo).
    /// </summary>
    public static string? ClaveUnidad(string? unidad)
    {
        var texto = unidad?.TrimEnd(' ');
        return string.IsNullOrEmpty(texto) ? null : texto.ToUpperInvariant();
    }

    /// <summary>
    /// Una fila por cada texto distinto de <c>insumos.unidad</c> (la consulta usa una collation
    /// binaria: aquí llegan "kg" y "KG" por separado). Se juntan por <see cref="ClaveUnidad"/>; el
    /// nombre es la variante ordinal-menor sin espacios a la derecha, para que el hash no dependa
    /// del orden en que SQL Server las devuelva. Sin estado: el POS no lo reporta.
    /// </summary>
    private static List<RegistroCatalogo> MapearUnidades(IDataReader lector, Columnas columnas, ref int filas)
    {
        var nombres = new SortedDictionary<string, string>(StringComparer.Ordinal);
        while (lector.Read())
        {
            filas++;
            var texto = columnas.Texto(lector, "id");
            if (ClaveUnidad(texto) is not { } clave)
            {
                continue;
            }

            if (!nombres.TryGetValue(clave, out var nombre) || string.CompareOrdinal(texto, nombre) < 0)
            {
                nombres[clave] = texto!;
            }
        }

        return nombres.Select(par => Registro(par.Key, par.Key, par.Value, null)).ToList();
    }

    /// <summary>
    /// Una fila por (insumo, fila de <c>insumosdetalle</c>), ordenada por insumo: se juntan las de un
    /// mismo insumo. El grupo y la unidad van SIEMPRE, también nulos: omitirlos los guarda nulos en el
    /// panel (nota de F2-120). Sin costo: el contrato del catálogo lo rechaza (va con las existencias).
    /// </summary>
    private static List<RegistroCatalogo> MapearInsumos(
        IDataReader lector, Columnas columnas, List<string> avisos, ref int filas)
    {
        var registros = new List<RegistroCatalogo>();
        var porId = new Dictionary<string, int>(StringComparer.Ordinal);
        var estados = new List<List<bool?>>();
        var bases = new List<(string? Id, string? Nombre, string? Grupo, string? Unidad)>();

        while (lector.Read())
        {
            filas++;
            var id = columnas.Texto(lector, "id");
            var estado = EstadoUnoCero(columnas.Valor(lector, "estatus"), "estatus", avisos);
            if (id is not null && porId.TryGetValue(id, out var i))
            {
                estados[i].Add(estado);
                continue;
            }

            if (id is not null)
            {
                porId[id] = bases.Count;
            }

            bases.Add((id, columnas.TextoNombre(lector), columnas.Texto(lector, "grupo"),
                ClaveUnidad(columnas.Texto(lector, "unidad"))));
            estados.Add([estado]);
        }

        for (var i = 0; i < bases.Count; i++)
        {
            var (id, nombre, grupo, unidad) = bases[i];
            var distintos = estados[i].Distinct().ToList();
            bool? activo = null;
            if (distintos.Count == 1)
            {
                activo = distintos[0];
            }
            else
            {
                // DECISION PROVISIONAL (nocturno): insumosdetalle tiene una fila por empresa (sin PK),
                // como productosdetalle. Estados distintos = no se elige uno: viaja sin estado.
                avisos.Add(
                    $"El insumo {id} tiene {estados[i].Count} filas en insumosdetalle con estado distinto " +
                    "(varias empresas en la base de SoftRestaurant): se manda sin estado.");
            }

            registros.Add(Registro(id, id, nombre, activo, w =>
            {
                w.WriteString("grupoOrigenSrId", grupo);
                w.WriteString("unidadOrigenSrId", unidad);
            }));
        }

        return registros;
    }

    /// <summary>
    /// Una fila por forma de <c>dbo.formasdepago</c> (PAG-01): <c>{ origenSrId, nombre, tipo }</c>.
    /// <c>nombre</c> es EXACTAMENTE el texto con que la ingesta de cheques guarda <c>forma_raw</c>
    /// (<c>MapeoCheques</c>: la descripción sin espacios a los lados, o el
    /// <c>idformadepago</c> si viene vacía): el panel clasifica por match exacto de ese texto, y otro
    /// recorte dejaría sin clasificar los pagos. <c>tipo</c> va SIEMPRE: entero 1–4, o nulo si la
    /// instalación no trae la columna o trae otro valor (con aviso). El mapeo a nuestro ENUM lo hace
    /// el API. Una forma sin descripción ni clave no se manda (con aviso): no hay texto que cruzar.
    /// </summary>
    private static List<RegistroCatalogo> MapearFormasPago(
        IDataReader lector, Columnas columnas, List<string> avisos, ref int filas)
    {
        var registros = new List<RegistroCatalogo>();
        while (lector.Read())
        {
            filas++;
            var id = TextoForma(columnas.Texto(lector, "id"));
            var nombre = TextoForma(columnas.Texto(lector, "nombre")) ?? id;
            if (id is null || nombre is null)
            {
                const string sinTexto = "Una forma de pago sin idformadepago ni descripción no se manda: no hay texto que clasificar.";
                if (!avisos.Contains(sinTexto))
                {
                    avisos.Add(sinTexto);
                }

                continue;
            }

            var tipo = TipoForma(columnas.Valor(lector, "tipo"), id, avisos);
            using var memoria = new MemoryStream();
            using (var w = new Utf8JsonWriter(memoria, OpcionesEscritura))
            {
                w.WriteStartObject();
                w.WriteString("origenSrId", id);
                w.WriteString("nombre", nombre);
                if (tipo is { } t)
                {
                    w.WriteNumber("tipo", t);
                }
                else
                {
                    w.WriteNull("tipo");
                }

                w.WriteEndObject();
            }

            registros.Add(new RegistroCatalogo(id, Encoding.UTF8.GetString(memoria.ToArray())));
        }

        return registros;
    }

    /// <summary>El mismo recorte que <c>MapeoCheques.Limpio</c> para <c>forma_raw</c>: espacios a los dos lados; vacío = nulo.</summary>
    private static string? TextoForma(string? texto) =>
        string.IsNullOrWhiteSpace(texto) ? null : texto.Trim();

    /// <summary><c>formasdepago.tipo</c>: 1 efectivo, 2 tarjeta, 3 vales, 4 otros (§4). Otro valor = nulo, con aviso.</summary>
    private static int? TipoForma(object? valor, string id, List<string> avisos)
    {
        if (valor is null)
        {
            return null;
        }

        var numero = valor is bool b ? (b ? 1m : 0m) : Convert.ToDecimal(valor, CultureInfo.InvariantCulture);
        if (numero >= 1m && numero <= 4m && numero == decimal.Truncate(numero))
        {
            return (int)numero;
        }

        avisos.Add(
            $"La forma de pago {id} trae un tipo que no es 1, 2, 3 ni 4: se manda sin tipo y el panel no la clasifica.");
        return null;
    }

    private static RegistroCatalogo Registro(
        string? origenSrId, string? clave, string? nombre, bool? activoPos, Action<Utf8JsonWriter>? extra = null)
    {
        using var memoria = new MemoryStream();
        using (var w = new Utf8JsonWriter(memoria, OpcionesEscritura))
        {
            w.WriteStartObject();
            w.WriteString("origenSrId", origenSrId);
            w.WriteString("clave", clave);
            w.WriteString("nombre", nombre);
            if (activoPos is { } activo)
            {
                w.WriteBoolean("activoPos", activo);
            }
            else
            {
                w.WriteNull("activoPos");
            }

            extra?.Invoke(w);
            w.WriteEndObject();
        }

        return new RegistroCatalogo(origenSrId, Encoding.UTF8.GetString(memoria.ToArray()));
    }

    /// <summary>
    /// DECISION PROVISIONAL (nocturno): 1 = vigente, 0 = baja (meseros.visible y
    /// areasrestaurant.Estatus; en la base vista todas las filas valen 1; proveedores.estatus e
    /// insumosdetalle.estatus, sin filas que ver). NULL u otro valor = "el POS no lo reporta", con
    /// aviso. docs/esquema-sr.md §7, §8 y §9.
    /// </summary>
    private static bool? EstadoUnoCero(object? valor, string columna, List<string> avisos) =>
        Bandera(valor, columna, avisos);

    private static bool? Bandera(object? valor, string columna, List<string> avisos)
    {
        if (valor is null)
        {
            return null;
        }

        var numero = valor is bool b ? (b ? 1m : 0m) : Convert.ToDecimal(valor, CultureInfo.InvariantCulture);
        if (numero == 1m)
        {
            return true;
        }

        if (numero == 0m)
        {
            return false;
        }

        var aviso = $"La columna {columna} trae un valor que no es 0 ni 1: esas filas viajan sin estado.";
        if (!avisos.Contains(aviso))
        {
            avisos.Add(aviso);
        }

        return null;
    }

    private static decimal? Dinero(object? valor) =>
        valor is null ? null : Convert.ToDecimal(valor, CultureInfo.InvariantCulture);

    /// <summary>Índices de columna por nombre, sin distinguir mayúsculas.</summary>
    private sealed class Columnas
    {
        private readonly Dictionary<string, int> _indices = new(StringComparer.OrdinalIgnoreCase);

        public Columnas(IDataRecord registro)
        {
            for (var i = 0; i < registro.FieldCount; i++)
            {
                _indices.TryAdd(registro.GetName(i), i);
            }
        }

        public object? Valor(IDataRecord r, string columna)
        {
            if (!_indices.TryGetValue(columna, out var i))
            {
                throw new InvalidDataException($"La consulta no trae la columna '{columna}'.");
            }

            return r.IsDBNull(i) ? null : r.GetValue(i);
        }

        /// <summary>Texto sin espacios a la derecha; vacío = nulo.</summary>
        public string? Texto(IDataRecord r, string columna)
        {
            var texto = TextoCrudo(r, columna)?.TrimEnd(' ');
            return string.IsNullOrEmpty(texto) ? null : texto;
        }

        /// <summary>El nombre sin espacios a la derecha, pero vacío se queda vacío: lo rechaza el API.</summary>
        public string? TextoNombre(IDataRecord r) => TextoCrudo(r, "nombre")?.TrimEnd(' ');

        private string? TextoCrudo(IDataRecord r, string columna) => Valor(r, columna) switch
        {
            null => null,
            string s => s,
            var otro => Convert.ToString(otro, CultureInfo.InvariantCulture),
        };
    }
}
