using System.Data;
using System.Text.Json;
using ArkonAgente.Catalogos;
using ArkonAgente.Inventario;

namespace ArkonAgente.Tests;

/// <summary>
/// Fixture con la forma EXACTA de <c>sr_existencias.sql</c> (mismos alias; tipos .NET de SR 10:
/// <c>acumuladoinsumos.id</c> int, <c>existencia</c> numeric(14,4) y <c>costopromedio</c> money →
/// decimal). Datos sintéticos.
/// </summary>
internal static class FixturesExistencias
{
    public static DataTable Tabla(
        params (string Almacen, int Huerfano, int? Fila, string? Insumo, decimal? Existencia, decimal? Costo)[] filas)
    {
        var tabla = new DataTable();
        tabla.Columns.Add("almacen", typeof(string));
        tabla.Columns.Add("huerfano", typeof(int));
        tabla.Columns.Add("fila", typeof(int));
        tabla.Columns.Add("insumo", typeof(string));
        tabla.Columns.Add("existencia", typeof(decimal));
        tabla.Columns.Add("costo", typeof(decimal));
        foreach (var f in filas)
        {
            tabla.Rows.Add(
                f.Almacen, f.Huerfano, (object?)f.Fila ?? DBNull.Value, (object?)f.Insumo ?? DBNull.Value,
                (object?)f.Existencia ?? DBNull.Value, (object?)f.Costo ?? DBNull.Value);
        }

        return tabla;
    }
}

/// <summary>Los cinco catálogos de inventario (F2-241) y el mapeo de existencias.</summary>
public class MapeoInventarioTests
{
    private static CatalogoLeido Mapear(CatalogoPanel catalogo, DataTable tabla) =>
        MapeoCatalogos.Mapear(catalogo, tabla.CreateDataReader());

    private static ExistenciasLeidas Existencias(DataTable tabla) => MapeoExistencias.Mapear(tabla.CreateDataReader());

    private static JsonElement Json(RegistroCatalogo r) => JsonDocument.Parse(r.Json).RootElement.Clone();

    private static string[] Campos(RegistroCatalogo r) => Json(r).EnumerateObject().Select(p => p.Name).ToArray();

    // ---------- Catálogos ----------

    [Fact]
    public void Unidades_se_juntan_sin_distinguir_mayusculas_ni_relleno_y_el_nombre_no_depende_del_orden()
    {
        var a = Mapear(CatalogoPanel.Unidades, FixturesSr.Unidades("kg", "KG  ", "Pza", "", "   ", "lt"));
        var b = Mapear(CatalogoPanel.Unidades, FixturesSr.Unidades("lt", "   ", "KG  ", "Pza", "kg", ""));

        Assert.Equal(6, a.FilasSql);
        Assert.Equal(["KG", "LT", "PZA"], a.Registros.Select(r => r.OrigenSrId));
        var kg = Json(a.Registros[0]);
        Assert.Equal(["origenSrId", "clave", "nombre", "activoPos"], Campos(a.Registros[0]));
        Assert.Equal("KG", kg.GetProperty("clave").GetString());
        Assert.Equal("KG", kg.GetProperty("nombre").GetString()); // "KG" < "kg" en ordinal
        Assert.Equal(JsonValueKind.Null, kg.GetProperty("activoPos").ValueKind);
        Assert.Equal("Pza", Json(a.Registros[2]).GetProperty("nombre").GetString());
        Assert.Equal(MapeoCatalogos.Hash(a.Registros), MapeoCatalogos.Hash(b.Registros));
    }

    [Theory]
    [InlineData("kg", "KG")]
    [InlineData("KG  ", "KG")]
    [InlineData("Pza", "PZA")]
    [InlineData("ración", "RACIÓN")]
    [InlineData("", null)]
    [InlineData("   ", null)]
    [InlineData(null, null)]
    public void La_clave_de_unidad_es_la_misma_funcion_para_el_catalogo_y_el_insumo(string? unidad, string? clave)
    {
        Assert.Equal(clave, MapeoCatalogos.ClaveUnidad(unidad));
    }

    [Fact]
    public void Dos_insumos_con_kg_y_KG_apuntan_a_la_misma_unidad_del_catalogo()
    {
        var insumos = Mapear(CatalogoPanel.Insumos, FixturesSr.Insumos(
            ("I1", "Leche", "G1", "kg", 1), ("I2", "Queso", "G1", "KG  ", 1)));
        var unidades = Mapear(CatalogoPanel.Unidades, FixturesSr.Unidades("kg", "KG  "));

        var clave = Assert.Single(unidades.Registros).OrigenSrId;
        Assert.All(insumos.Registros, r => Assert.Equal(clave, Json(r).GetProperty("unidadOrigenSrId").GetString()));
    }

    [Fact]
    public void Insumos_llevan_grupo_y_unidad_SIEMPRE_sin_costo_con_acentos_comillas_y_NULL()
    {
        var leido = Mapear(CatalogoPanel.Insumos, FixturesSr.Insumos(
            ("I001  ", "Chile \"guajillo\" seco", "GI1  ", "kg", 1),
            ("I002", "Piña miel", null, null, 0),
            ("I003", null, "GI2", "", null)));

        Assert.Equal(3, leido.Total);
        Assert.Empty(leido.Avisos);
        Assert.Equal(
            ["origenSrId", "clave", "nombre", "activoPos", "grupoOrigenSrId", "unidadOrigenSrId"], Campos(leido.Registros[0]));
        var i1 = Json(leido.Registros[0]);
        Assert.Equal("I001", i1.GetProperty("origenSrId").GetString());
        Assert.Equal("Chile \"guajillo\" seco", i1.GetProperty("nombre").GetString());
        Assert.Equal("GI1", i1.GetProperty("grupoOrigenSrId").GetString());
        Assert.Equal("KG", i1.GetProperty("unidadOrigenSrId").GetString());
        Assert.True(i1.GetProperty("activoPos").GetBoolean());

        // Nulos presentes (omitirlos los guarda nulos en el panel, también en una incremental).
        var i2 = Json(leido.Registros[1]);
        Assert.Equal(JsonValueKind.Null, i2.GetProperty("grupoOrigenSrId").ValueKind);
        Assert.Equal(JsonValueKind.Null, i2.GetProperty("unidadOrigenSrId").ValueKind);
        Assert.False(i2.GetProperty("activoPos").GetBoolean());
        var i3 = Json(leido.Registros[2]);
        Assert.Equal(JsonValueKind.Null, i3.GetProperty("nombre").ValueKind);
        Assert.Equal(JsonValueKind.Null, i3.GetProperty("unidadOrigenSrId").ValueKind); // vacía = sin unidad
        Assert.Equal(JsonValueKind.Null, i3.GetProperty("activoPos").ValueKind); // sin detalle: el POS no lo reporta
        Assert.All(leido.Registros, r => Assert.DoesNotContain("costo", r.Json, StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Insumo_con_varias_filas_de_detalle_es_UN_registro_y_con_estados_distintos_viaja_sin_estado()
    {
        var iguales = Mapear(CatalogoPanel.Insumos, FixturesSr.Insumos(("I1", "Leche", "G", "lt", 1), ("I1", "Leche", "G", "lt", 1)));
        Assert.Equal(2, iguales.FilasSql);
        Assert.True(Json(Assert.Single(iguales.Registros)).GetProperty("activoPos").GetBoolean());
        Assert.Empty(iguales.Avisos);

        var distintos = Mapear(CatalogoPanel.Insumos, FixturesSr.Insumos(("I1", "Leche", "G", "lt", 1), ("I1", "Leche", "G", "lt", 0)));
        Assert.Equal(JsonValueKind.Null, Json(Assert.Single(distintos.Registros)).GetProperty("activoPos").ValueKind);
        Assert.Contains(distintos.Avisos, a => a.Contains("I1") && a.Contains("varias empresas"));
    }

    [Fact]
    public void Grupos_de_insumo_y_almacenes_sin_estado_y_con_relleno_recortado()
    {
        var grupos = Mapear(CatalogoPanel.GruposInsumo, FixturesSr.GruposInsumo(("GI1  ", "Lácteos y \"frescos\""), ("GI2", null)));
        var almacenes = Mapear(CatalogoPanel.Almacenes, FixturesSr.Almacenes(("1", "Almacén general"), ("2    ", "Barra")));

        Assert.Equal("GI1", Json(grupos.Registros[0]).GetProperty("origenSrId").GetString());
        Assert.Equal("Lácteos y \"frescos\"", Json(grupos.Registros[0]).GetProperty("nombre").GetString());
        Assert.Equal(JsonValueKind.Null, Json(grupos.Registros[1]).GetProperty("nombre").ValueKind);
        Assert.Equal("2", Json(almacenes.Registros[1]).GetProperty("origenSrId").GetString());
        Assert.All(grupos.Registros.Concat(almacenes.Registros), r =>
        {
            Assert.Equal(["origenSrId", "clave", "nombre", "activoPos"], Campos(r));
            Assert.Equal(JsonValueKind.Null, Json(r).GetProperty("activoPos").ValueKind);
        });
    }

    [Fact]
    public void Proveedores_leen_estatus_numeric_1_como_decimal()
    {
        var leido = Mapear(CatalogoPanel.Proveedores, FixturesSr.Proveedores(
            ("P1", "Lácteos \"El Ñandú\"", 1m), ("P2", "Abarrotes", 0m), ("P3", null, null), ("P4", "Otro", 3m)));

        Assert.Equal(["origenSrId", "clave", "nombre", "activoPos"], Campos(leido.Registros[0]));
        Assert.True(Json(leido.Registros[0]).GetProperty("activoPos").GetBoolean());
        Assert.False(Json(leido.Registros[1]).GetProperty("activoPos").GetBoolean());
        Assert.Equal(JsonValueKind.Null, Json(leido.Registros[2]).GetProperty("activoPos").ValueKind);
        Assert.Equal(JsonValueKind.Null, Json(leido.Registros[3]).GetProperty("activoPos").ValueKind);
        Assert.Single(leido.Avisos); // el 3 no se interpreta
    }

    // ---------- Existencias ----------

    [Fact]
    public void Existencias_mandan_negativas_y_en_cero_con_costo_en_texto()
    {
        var leidas = Existencias(FixturesExistencias.Tabla(
            ("1", 0, 10, "I001", 12.5000m, 85.4000m),
            ("1", 0, 11, "I002", 0.0000m, 20m),
            ("1", 0, 12, "I003", -3.2500m, 15.1234m)));

        var foto = Assert.Single(leidas.Fotos);
        Assert.Equal("1", foto.Almacen);
        Assert.Equal(
            [("I001", "12.500", "85.4000"), ("I002", "0", "20"), ("I003", "-3.250", "15.1234")],
            foto.Registros.Select(r => (r.Insumo, r.Cantidad, r.Costo)));
        Assert.Empty(leidas.Avisos);
        Assert.Empty(leidas.Excedidas);
    }

    [Theory]
    [InlineData("0.0004", "0")]
    [InlineData("0.0005", "0.001")]
    [InlineData("-0.0005", "-0.001")]
    [InlineData("-0.0004", "0")] // un cero negativo viaja como cero
    [InlineData("2.4445", "2.445")]
    [InlineData("-2.4445", "-2.445")]
    public void La_cantidad_se_redondea_a_3_mitad_lejos_de_cero_y_lo_avisa(string sr, string contrato)
    {
        var leidas = Existencias(FixturesExistencias.Tabla(("1", 0, 1, "I1", decimal.Parse(sr, System.Globalization.CultureInfo.InvariantCulture), 1m)));

        Assert.Equal(contrato, Assert.Single(Assert.Single(leidas.Fotos).Registros).Cantidad);
        Assert.Contains(leidas.Avisos, a => a.Contains("1 existencia(s) con 4 decimales se redondearon a 3"));
    }

    [Fact]
    public void Sin_costo_o_con_costos_distintos_viaja_null_y_lo_avisa()
    {
        var leidas = Existencias(FixturesExistencias.Tabla(
            ("1", 0, 1, "I1", 5m, null),     // sin fila de insumosdetalle para la empresa del almacén
            ("1", 0, 2, "I2", 5m, 10m),      // dos filas de detalle con costos distintos (sin PK)
            ("1", 0, 2, "I2", 5m, 11m),
            ("1", 0, 3, "I3", 5m, 7m),       // dos filas de detalle IGUALES: una sola, con su costo
            ("1", 0, 3, "I3", 5m, 7m)));

        var registros = Assert.Single(leidas.Fotos).Registros;
        Assert.Equal(3, registros.Count); // una por fila de acumuladoinsumos, no por fila SQL
        Assert.Null(registros[0].Costo);
        Assert.Null(registros[1].Costo);
        Assert.Equal("7", registros[2].Costo);
        Assert.Equal(5, leidas.FilasSql);
        Assert.Contains(leidas.Avisos, a => a.Contains("1 insumo(s) sin costo promedio"));
        Assert.Contains(leidas.Avisos, a => a.Contains("1 insumo(s) con varias filas en insumosdetalle"));

        // En el cuerpo, el costo nulo viaja como null explícito: el API rechaza ESE registro y conserva su fila.
        var cuerpo = JsonDocument.Parse(MapeoExistencias.Payload(leidas.Fotos[0], DateTimeOffset.UnixEpoch)).RootElement;
        Assert.Equal(JsonValueKind.Null, cuerpo.GetProperty("registros")[0].GetProperty("costoPromedio").ValueKind);
    }

    [Fact]
    public void Un_almacen_sin_existencias_manda_su_foto_vacia_y_un_huerfano_se_manda_con_aviso()
    {
        var leidas = Existencias(FixturesExistencias.Tabla(
            ("1", 0, null, null, null, null),
            ("2", 0, 5, "I1", 1m, 2m),
            ("9", 1, 7, "I1", 4m, null)));

        Assert.Equal(["1", "2", "9"], leidas.Fotos.Select(f => f.Almacen));
        Assert.Empty(leidas.Fotos[0].Registros);
        Assert.False(leidas.Fotos[0].Huerfano);
        Assert.True(leidas.Fotos[2].Huerfano);
        Assert.Single(leidas.Fotos[2].Registros);
        Assert.Contains(leidas.Avisos, a => a.Contains("almacén 9") && a.Contains("no está en dbo.almacen"));
    }

    [Fact]
    public void Un_insumo_repetido_en_un_almacen_viaja_tal_cual_sin_sumar_y_lo_avisa()
    {
        var leidas = Existencias(FixturesExistencias.Tabla(("1", 0, 1, "I1", 2m, 1m), ("1", 0, 2, "I1", 3m, 1m)));

        Assert.Equal(["2", "3"], Assert.Single(leidas.Fotos).Registros.Select(r => r.Cantidad));
        Assert.Contains(leidas.Avisos, a => a.Contains("aparecen más de una vez"));
    }

    [Fact]
    public void Una_cantidad_o_un_costo_que_no_cabe_viaja_sin_truncar_y_lo_avisa()
    {
        var leidas = Existencias(FixturesExistencias.Tabla(
            ("1", 0, 1, "I1", 1234567890.1234m, 1m),  // 10 enteros: CANTIDAD admite 9
            ("1", 0, 2, "I2", 1m, 12345678901.5m)));  // 11 enteros: DINERO admite 10

        var registros = Assert.Single(leidas.Fotos).Registros;
        Assert.Equal("1234567890.123", registros[0].Cantidad);
        Assert.Equal("12345678901.5", registros[1].Costo);
        Assert.Contains(leidas.Avisos, a => a.Contains("2 registro(s) con una cantidad o un costo que no cabe"));
    }

    [Fact]
    public void Un_almacen_con_mas_de_5000_registros_no_se_manda()
    {
        var filas = Enumerable.Range(1, MapeoExistencias.MaxRegistrosPorFoto + 1)
            .Select(i => ("2", 0, (int?)i, (string?)$"I{i}", (decimal?)1m, (decimal?)1m))
            .Prepend(("1", 0, (int?)0, (string?)"I0", (decimal?)1m, (decimal?)1m))
            .ToArray();

        var leidas = Existencias(FixturesExistencias.Tabla(filas));

        Assert.Equal("1", Assert.Single(leidas.Fotos).Almacen);
        Assert.Equal(("2", 5001), Assert.Single(leidas.Excedidas));
    }

    [Fact]
    public void Sin_ningun_almacen_no_hay_fotos()
    {
        var leidas = Existencias(FixturesExistencias.Tabla());

        Assert.Empty(leidas.Fotos);
        Assert.Equal(0, leidas.FilasSql);
    }

    [Fact]
    public void Una_columna_que_falta_hace_fallar_la_lectura_en_vez_de_mandar_algo()
    {
        var tabla = FixturesExistencias.Tabla(("1", 0, 1, "I1", 1m, 1m));
        tabla.Columns.Remove("existencia");

        Assert.Throws<InvalidDataException>(() => Existencias(tabla));
    }

    [Fact]
    public void El_cuerpo_tiene_la_forma_exacta_del_contrato()
    {
        var foto = new FotoAlmacen("ALM 1", [new RegistroExistencia("I\"1", "-1.5", "10.25")], false);

        var json = MapeoExistencias.Payload(foto, new DateTimeOffset(2026, 9, 23, 8, 30, 0, TimeSpan.FromHours(-6)));

        Assert.Equal(
            "{\"almacenOrigenSrId\":\"ALM 1\",\"capturadoAt\":\"2026-09-23T14:30:00.000Z\"," +
            "\"registros\":[{\"insumoOrigenSrId\":\"I\\u00221\",\"cantidad\":\"-1.5\",\"costoPromedio\":\"10.25\"}]}",
            json);
    }
}
