using System.Data;
using System.Text.Json;
using ArkonAgente.Catalogos;

namespace ArkonAgente.Tests;

/// <summary>
/// Fixtures con la forma EXACTA de lo que devuelven las consultas <c>sr_catalogo_*.sql</c> (mismos
/// alias, tipos .NET de las columnas de SR 10). Datos sintéticos: nada es de un cliente real.
/// </summary>
internal static class FixturesSr
{
    public static DataTable Grupos(params (string? Id, string? Nombre)[] filas) =>
        Tabla([("id", typeof(string)), ("nombre", typeof(string))], filas.Select(f => new object?[] { f.Id, f.Nombre }));

    public static DataTable Productos(params (string? Id, string? Nombre, string? Grupo, decimal? Precio, bool? Bloqueado)[] filas) =>
        Tabla(
            [("id", typeof(string)), ("nombre", typeof(string)), ("grupo", typeof(string)), ("precio", typeof(decimal)),
             ("bloqueado", typeof(bool))],
            filas.Select(f => new object?[] { f.Id, f.Nombre, f.Grupo, f.Precio, f.Bloqueado }));

    public static DataTable Meseros(params (string? Id, string? Clave, string? Nombre, decimal? Visible)[] filas) =>
        Tabla(
            [("id", typeof(string)), ("clave", typeof(string)), ("nombre", typeof(string)), ("visible", typeof(decimal))],
            filas.Select(f => new object?[] { f.Id, f.Clave, f.Nombre, f.Visible }));

    /// <summary>Con el nombre de columna TAL COMO lo trae SR (<c>Estatus</c>): el mapeo no distingue mayúsculas.</summary>
    public static DataTable Areas(params (string? Id, string? Nombre, bool? Estatus)[] filas) =>
        Tabla(
            [("ID", typeof(string)), ("Nombre", typeof(string)), ("Estatus", typeof(bool))],
            filas.Select(f => new object?[] { f.Id, f.Nombre, f.Estatus }));

    public static DataTable Canales(params (string? Id, string? Nombre)[] filas) =>
        Tabla([("id", typeof(string)), ("nombre", typeof(string))], filas.Select(f => new object?[] { f.Id, f.Nombre }));

    public static DataTable Clientes(params (string? Id, string? Nombre, string? Telefono, string? Correo, string? Rfc)[] filas) =>
        Tabla(
            [("id", typeof(string)), ("nombre", typeof(string)), ("telefono", typeof(string)), ("correo", typeof(string)),
             ("rfc", typeof(string))],
            filas.Select(f => new object?[] { f.Id, f.Nombre, f.Telefono, f.Correo, f.Rfc }));

    /// <summary><c>insumos.unidad</c> crudo (varchar(10), collation CI de SR): el recorte y la unión son del mapeo.</summary>
    public static DataTable Unidades(params string?[] unidades) =>
        Tabla([("id", typeof(string))], unidades.Select(u => new object?[] { u }));

    public static DataTable GruposInsumo(params (string? Id, string? Nombre)[] filas) =>
        Tabla([("id", typeof(string)), ("nombre", typeof(string))], filas.Select(f => new object?[] { f.Id, f.Nombre }));

    /// <summary><c>insumosdetalle.estatus</c> es <c>int</c> en SR 10.</summary>
    public static DataTable Insumos(params (string? Id, string? Nombre, string? Grupo, string? Unidad, int? Estatus)[] filas) =>
        Tabla(
            [("id", typeof(string)), ("nombre", typeof(string)), ("grupo", typeof(string)), ("unidad", typeof(string)),
             ("estatus", typeof(int))],
            filas.Select(f => new object?[] { f.Id, f.Nombre, f.Grupo, f.Unidad, f.Estatus }));

    public static DataTable Almacenes(params (string? Id, string? Nombre)[] filas) =>
        Tabla([("id", typeof(string)), ("nombre", typeof(string))], filas.Select(f => new object?[] { f.Id, f.Nombre }));

    /// <summary><c>proveedores.estatus</c> es <c>numeric(1)</c>: llega como <c>decimal</c>.</summary>
    public static DataTable Proveedores(params (string? Id, string? Nombre, decimal? Estatus)[] filas) =>
        Tabla(
            [("id", typeof(string)), ("nombre", typeof(string)), ("estatus", typeof(decimal))],
            filas.Select(f => new object?[] { f.Id, f.Nombre, f.Estatus }));

    public static DataTable Vacia(CatalogoPanel catalogo) => catalogo switch
    {
        CatalogoPanel.Grupos => Grupos(),
        CatalogoPanel.Productos => Productos(),
        CatalogoPanel.Meseros => Meseros(),
        CatalogoPanel.Areas => Areas(),
        CatalogoPanel.Canales => Canales(),
        CatalogoPanel.Clientes => Clientes(),
        CatalogoPanel.Unidades => Unidades(),
        CatalogoPanel.GruposInsumo => GruposInsumo(),
        CatalogoPanel.Insumos => Insumos(),
        CatalogoPanel.Almacenes => Almacenes(),
        CatalogoPanel.Proveedores => Proveedores(),
        _ => throw new ArgumentOutOfRangeException(nameof(catalogo)),
    };

    private static DataTable Tabla(IEnumerable<(string Nombre, Type Tipo)> columnas, IEnumerable<object?[]> filas)
    {
        var tabla = new DataTable();
        foreach (var (nombre, tipo) in columnas)
        {
            tabla.Columns.Add(nombre, tipo);
        }

        foreach (var fila in filas)
        {
            tabla.Rows.Add(fila.Select(v => v ?? DBNull.Value).ToArray());
        }

        return tabla;
    }
}

public class MapeoCatalogosTests
{
    private static CatalogoLeido Mapear(CatalogoPanel catalogo, DataTable tabla) =>
        MapeoCatalogos.Mapear(catalogo, tabla.CreateDataReader());

    private static JsonElement Json(RegistroCatalogo r) => JsonDocument.Parse(r.Json).RootElement.Clone();

    private static string[] Campos(RegistroCatalogo r) => Json(r).EnumerateObject().Select(p => p.Name).ToArray();

    [Theory]
    [InlineData("grupos")]
    [InlineData("productos")]
    [InlineData("meseros")]
    [InlineData("areas")]
    [InlineData("canales")]
    [InlineData("clientes")]
    [InlineData("unidades")]
    [InlineData("grupos_insumo")]
    [InlineData("insumos")]
    [InlineData("almacenes")]
    [InlineData("proveedores")]
    public void Catalogo_vacio_da_cero_registros_sin_avisos(string texto)
    {
        var catalogo = CatalogosPanel.Parsear(texto);
        var leido = Mapear(catalogo, FixturesSr.Vacia(catalogo));

        Assert.Equal(catalogo, leido.Catalogo);
        Assert.Empty(leido.Registros);
        Assert.Equal(0, leido.Total);
        Assert.Equal(0, leido.FilasSql);
        Assert.Empty(leido.Avisos);
    }

    [Fact]
    public void Grupos_con_acentos_comillas_y_NULL()
    {
        var leido = Mapear(CatalogoPanel.Grupos, FixturesSr.Grupos(
            ("G01", "Bebidas \"frías\" y café"), ("G02", null), ("G03  ", "Postres de Ñoño   ")));

        Assert.Equal(3, leido.Total);
        var g1 = Json(leido.Registros[0]);
        Assert.Equal("G01", g1.GetProperty("origenSrId").GetString());
        Assert.Equal("G01", g1.GetProperty("clave").GetString());
        Assert.Equal("Bebidas \"frías\" y café", g1.GetProperty("nombre").GetString());
        Assert.Equal(JsonValueKind.Null, g1.GetProperty("activoPos").ValueKind);
        Assert.Equal(["origenSrId", "clave", "nombre", "activoPos"], Campos(leido.Registros[0]));

        // Nombre NULL viaja nulo: lo rechaza el API, el agente no inventa uno.
        Assert.Equal(JsonValueKind.Null, Json(leido.Registros[1]).GetProperty("nombre").ValueKind);
        // El relleno de la derecha se va (SR compara varchar ignorándolo).
        Assert.Equal("G03", Json(leido.Registros[2]).GetProperty("origenSrId").GetString());
        Assert.Equal("Postres de Ñoño", Json(leido.Registros[2]).GetProperty("nombre").GetString());
    }

    [Fact]
    public void Productos_llevan_grupo_precio_en_texto_y_estado_por_bloqueado()
    {
        var leido = Mapear(CatalogoPanel.Productos, FixturesSr.Productos(
            ("P001", "Chilaquiles \"verdes\"", "G01", 89.5000m, false),
            ("P002", "Café de olla", "G02", 0.0000m, true),
            ("P003", "Descuento", null, -10.1234m, null),
            ("P004", "Sin detalle", "G01", null, null)));

        Assert.Equal(4, leido.Total);
        var p1 = Json(leido.Registros[0]);
        Assert.Equal(["origenSrId", "clave", "nombre", "activoPos", "grupoOrigenSrId", "precio"], Campos(leido.Registros[0]));
        Assert.Equal("89.5000", p1.GetProperty("precio").GetString());
        Assert.True(p1.GetProperty("activoPos").GetBoolean());
        Assert.Equal("G01", p1.GetProperty("grupoOrigenSrId").GetString());

        Assert.False(Json(leido.Registros[1]).GetProperty("activoPos").GetBoolean()); // bloqueado = 1
        Assert.Equal("-10.1234", Json(leido.Registros[2]).GetProperty("precio").GetString());
        Assert.Equal(JsonValueKind.Null, Json(leido.Registros[2]).GetProperty("grupoOrigenSrId").ValueKind);

        // El precio va SIEMPRE, también nulo (omitirlo lo guarda nulo en el panel: F2-145).
        var p4 = Json(leido.Registros[3]);
        Assert.True(p4.TryGetProperty("precio", out var precio));
        Assert.Equal(JsonValueKind.Null, precio.ValueKind);
        Assert.Equal(JsonValueKind.Null, p4.GetProperty("activoPos").ValueKind);
    }

    [Fact]
    public void Producto_con_varias_filas_de_detalle_iguales_es_UN_registro_con_su_precio()
    {
        var leido = Mapear(CatalogoPanel.Productos, FixturesSr.Productos(
            ("P001", "Tacos", "G01", 55m, false),
            ("P001", "Tacos", "G01", 55m, false),
            ("P002", "Agua", "G02", 20m, false)));

        Assert.Equal(3, leido.FilasSql);
        Assert.Equal(2, leido.Total); // el total del cierre: registros, no filas
        Assert.Equal("55", Json(leido.Registros[0]).GetProperty("precio").GetString());
        Assert.Empty(leido.Avisos);
    }

    [Fact]
    public void Producto_con_detalles_distintos_viaja_sin_precio_ni_estado_y_avisa()
    {
        var leido = Mapear(CatalogoPanel.Productos, FixturesSr.Productos(
            ("P001", "Tacos", "G01", 55m, false),
            ("P001", "Tacos", "G01", 60m, false)));

        var p = Json(Assert.Single(leido.Registros));
        Assert.Equal(JsonValueKind.Null, p.GetProperty("precio").ValueKind);
        Assert.Equal(JsonValueKind.Null, p.GetProperty("activoPos").ValueKind);
        Assert.Contains(leido.Avisos, a => a.Contains("P001") && a.Contains("varias empresas"));
    }

    [Fact]
    public void Meseros_usan_el_id_interno_la_clave_visible_y_visible_como_estado()
    {
        var leido = Mapear(CatalogoPanel.Meseros, FixturesSr.Meseros(
            ("1", "01", "José Pérez O'Brien", 1m), ("2", "02  ", null, 0m), ("3", "03", "Ana", null), ("4", "04", "Luis", 2m)));

        var m1 = Json(leido.Registros[0]);
        Assert.Equal(["origenSrId", "clave", "nombre", "activoPos"], Campos(leido.Registros[0]));
        Assert.Equal("1", m1.GetProperty("origenSrId").GetString());
        Assert.Equal("01", m1.GetProperty("clave").GetString());
        Assert.Equal("José Pérez O'Brien", m1.GetProperty("nombre").GetString());
        Assert.True(m1.GetProperty("activoPos").GetBoolean());
        Assert.Equal("02", Json(leido.Registros[1]).GetProperty("clave").GetString());
        Assert.False(Json(leido.Registros[1]).GetProperty("activoPos").GetBoolean());
        Assert.Equal(JsonValueKind.Null, Json(leido.Registros[2]).GetProperty("activoPos").ValueKind);
        // Un valor que no es 0 ni 1 no se interpreta: sin estado, y lo dice.
        Assert.Equal(JsonValueKind.Null, Json(leido.Registros[3]).GetProperty("activoPos").ValueKind);
        Assert.Single(leido.Avisos);
    }

    [Fact]
    public void Areas_leen_Estatus_sin_importar_mayusculas()
    {
        var leido = Mapear(CatalogoPanel.Areas, FixturesSr.Areas(("01", "Terraza", true), ("02", "Salón \"B\"", false)));

        Assert.True(Json(leido.Registros[0]).GetProperty("activoPos").GetBoolean());
        Assert.False(Json(leido.Registros[1]).GetProperty("activoPos").GetBoolean());
        Assert.Equal("Salón \"B\"", Json(leido.Registros[1]).GetProperty("nombre").GetString());
    }

    [Fact]
    public void Canales_recortan_el_relleno_del_nchar()
    {
        var leido = Mapear(CatalogoPanel.Canales, FixturesSr.Canales(("1                   ", "Comedor")));

        Assert.Equal("1", Json(Assert.Single(leido.Registros)).GetProperty("origenSrId").GetString());
    }

    [Fact]
    public void Clientes_llevan_contacto_sin_recortar_y_sin_estado()
    {
        var largo = new string('x', 250);
        var leido = Mapear(CatalogoPanel.Clientes, FixturesSr.Clientes(
            ("C1", "María Núñez \"La Güera\"", "55 1234 5678", largo, "NUÑ800101AB1  "),
            ("C2", null, null, "", null)));

        var c1 = Json(leido.Registros[0]);
        Assert.Equal(["origenSrId", "clave", "nombre", "activoPos", "telefono", "correo", "rfc"], Campos(leido.Registros[0]));
        Assert.Equal(largo, c1.GetProperty("correo").GetString()); // no se recorta: el API decide
        Assert.Equal("NUÑ800101AB1", c1.GetProperty("rfc").GetString());
        Assert.Equal(JsonValueKind.Null, c1.GetProperty("activoPos").ValueKind);
        var c2 = Json(leido.Registros[1]);
        Assert.Equal(JsonValueKind.Null, c2.GetProperty("correo").ValueKind); // vacío = nulo
        Assert.Equal(JsonValueKind.Null, c2.GetProperty("nombre").ValueKind);
    }

    [Fact]
    public void Una_columna_que_falta_hace_fallar_el_catalogo_en_vez_de_mandar_algo()
    {
        var tabla = FixturesSr.Grupos(("G01", "Bebidas"));
        tabla.Columns.Remove("nombre");

        Assert.Throws<InvalidDataException>(() => Mapear(CatalogoPanel.Grupos, tabla));
    }

    [Fact]
    public void Un_tipo_que_no_convierte_hace_fallar_el_catalogo()
    {
        var tabla = new DataTable();
        tabla.Columns.Add("id", typeof(string));
        tabla.Columns.Add("nombre", typeof(string));
        tabla.Columns.Add("estatus", typeof(string));
        tabla.Rows.Add("01", "Terraza", "activa");

        Assert.ThrowsAny<FormatException>(() => Mapear(CatalogoPanel.Areas, tabla));
    }

    [Fact]
    public void El_hash_no_depende_del_orden_y_si_del_contenido()
    {
        var a = Mapear(CatalogoPanel.Productos, FixturesSr.Productos(("P1", "A", "G", 1m, false), ("P2", "B", "G", 2m, false)));
        var b = Mapear(CatalogoPanel.Productos, FixturesSr.Productos(("P2", "B", "G", 2m, false), ("P1", "A", "G", 1m, false)));
        var precio = Mapear(CatalogoPanel.Productos, FixturesSr.Productos(("P1", "A", "G", 1.5m, false), ("P2", "B", "G", 2m, false)));
        var estado = Mapear(CatalogoPanel.Productos, FixturesSr.Productos(("P1", "A", "G", 1m, true), ("P2", "B", "G", 2m, false)));
        var nombre = Mapear(CatalogoPanel.Productos, FixturesSr.Productos(("P1", "a", "G", 1m, false), ("P2", "B", "G", 2m, false)));

        var h = MapeoCatalogos.Hash(a.Registros);
        Assert.Matches("^[0-9a-f]{64}$", h);
        Assert.Equal(h, MapeoCatalogos.Hash(b.Registros));
        Assert.NotEqual(h, MapeoCatalogos.Hash(precio.Registros));
        Assert.NotEqual(h, MapeoCatalogos.Hash(estado.Registros));
        Assert.NotEqual(h, MapeoCatalogos.Hash(nombre.Registros));
    }

    [Fact]
    public void Texto_de_los_catalogos_es_el_enum_del_contrato()
    {
        // Los once del enum CatalogoSr del contrato (F2-230 + F2-120), en orden de lectura.
        Assert.Equal(
            ["grupos", "productos", "meseros", "areas", "canales", "clientes",
             "unidades", "grupos_insumo", "insumos", "almacenes", "proveedores"],
            CatalogosPanel.Todos.Select(c => c.Texto()));
        Assert.Equal(Enum.GetValues<CatalogoPanel>().Length, CatalogosPanel.Todos.Count);
        Assert.All(CatalogosPanel.Todos, c => Assert.Equal(c, CatalogosPanel.Parsear(c.Texto())));
        Assert.Throws<InvalidDataException>(() => CatalogosPanel.Parsear("recetas"));
    }
}
