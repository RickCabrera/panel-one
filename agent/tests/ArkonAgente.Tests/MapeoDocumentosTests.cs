using System.Data;
using System.Text.Json;
using ArkonAgente.Inventario;

namespace ArkonAgente.Tests;

/// <summary>Una fila de <c>movsinv</c>/<c>movsinvcancelados</c> como la ve el agente (fixture sintética).</summary>
internal sealed record FilaMov(
    DateTime? Fecha, string? Concepto, string? Insumo, decimal? Cantidad, decimal? Costo, string? Almacen,
    bool Cancelado = false, decimal? Traspaso = null, decimal? Compra = null, decimal? Fisico = null,
    decimal? Cheque = null, decimal? Movto = null);

/// <summary>Un renglón de <c>compras</c> LEFT JOIN <c>comprasmovtos</c> (fixture sintética).</summary>
internal sealed record FilaCompra(
    long Compra, string? Folio, DateTime? Fecha, string? Proveedor, bool Cancelado, string? Insumo, decimal? Cantidad,
    decimal? Costo, string? Almacen, decimal? DescuentoCompra = 0m, decimal? DescuentoRenglon = 0m);

/// <summary>Fixtures de las tres consultas de F2-241b, con las mismas columnas que los <c>.sql</c>.</summary>
internal static class FixturesDocumentos
{
    /// <summary>Hora de SR de las pruebas: UTC−6 fijo, sin cambio de horario.</summary>
    public static readonly TimeZoneInfo Zona = TimeZoneInfo.CreateCustomTimeZone("Prueba-6", TimeSpan.FromHours(-6), "Prueba", "Prueba");

    /// <summary>La clave de documento con la misma regla del CASE de <c>sr_movimientos.sql</c>.</summary>
    public static string Documento(FilaMov f)
    {
        static string N(decimal v) => ((long)v).ToString(System.Globalization.CultureInfo.InvariantCulture);
        var clase =
            f.Traspaso is { } t && t != 0 ? "T" + N(t)
            : f.Compra is { } c && c != 0 ? "C" + N(c)
            : f.Fisico is { } i && i != 0 ? "F" + N(i)
            : f.Cheque is { } v && v != 0 ? "V" + N(v)
            : f.Movto is { } m && m != 0 ? "M" + N(m)
            : "S" + (f.Fecha?.ToString("yyyy-MM-dd HH:mm:ss.fff", System.Globalization.CultureInfo.InvariantCulture) ?? "");
        return clase + "|" + (f.Almacen?.TrimEnd() ?? "") + "|" + (f.Concepto?.TrimEnd() ?? "");
    }

    public static DataTable Movimientos(IEnumerable<FilaMov> filas)
    {
        var t = new DataTable();
        foreach (var (nombre, tipo) in new[]
                 {
                     ("cancelado", typeof(int)), ("fecha", typeof(DateTime)), ("foliocheque", typeof(decimal)),
                     ("movto", typeof(decimal)), ("idcompra", typeof(decimal)), ("traspaso", typeof(decimal)),
                     ("invfisico", typeof(decimal)), ("concepto", typeof(string)), ("insumo", typeof(string)),
                     ("costo", typeof(decimal)), ("cantidad", typeof(decimal)), ("almacen", typeof(string)),
                     ("documento", typeof(string)),
                 })
        {
            t.Columns.Add(nombre, tipo);
        }

        foreach (var f in filas)
        {
            t.Rows.Add(f.Cancelado ? 1 : 0, (object?)f.Fecha ?? DBNull.Value, (object?)f.Cheque ?? DBNull.Value,
                (object?)f.Movto ?? DBNull.Value, (object?)f.Compra ?? DBNull.Value, (object?)f.Traspaso ?? DBNull.Value,
                (object?)f.Fisico ?? DBNull.Value, (object?)f.Concepto ?? DBNull.Value, (object?)f.Insumo ?? DBNull.Value,
                (object?)f.Costo ?? DBNull.Value, (object?)f.Cantidad ?? DBNull.Value, (object?)f.Almacen ?? DBNull.Value,
                Documento(f));
        }

        return t;
    }

    public static DataTable Compras(IEnumerable<FilaCompra> filas)
    {
        var t = new DataTable();
        foreach (var (nombre, tipo) in new[]
                 {
                     ("compra", typeof(long)), ("folio", typeof(string)), ("fecha", typeof(DateTime)),
                     ("proveedor", typeof(string)), ("cancelado", typeof(bool)), ("descuento_compra", typeof(decimal)),
                     ("insumo", typeof(string)), ("cantidad", typeof(decimal)), ("costo", typeof(decimal)),
                     ("descuento_renglon", typeof(decimal)), ("almacen", typeof(string)),
                 })
        {
            t.Columns.Add(nombre, tipo);
        }

        foreach (var f in filas)
        {
            t.Rows.Add(f.Compra, (object?)f.Folio ?? DBNull.Value, (object?)f.Fecha ?? DBNull.Value,
                (object?)f.Proveedor ?? DBNull.Value, f.Cancelado, (object?)f.DescuentoCompra ?? DBNull.Value,
                (object?)f.Insumo ?? DBNull.Value, (object?)f.Cantidad ?? DBNull.Value, (object?)f.Costo ?? DBNull.Value,
                (object?)f.DescuentoRenglon ?? DBNull.Value, (object?)f.Almacen ?? DBNull.Value);
        }

        return t;
    }

    public static DataTable Recetas(IEnumerable<(string? Producto, string? Insumo, decimal? Cantidad, string? Empresa)> filas)
    {
        var t = new DataTable();
        t.Columns.Add("producto", typeof(string));
        t.Columns.Add("insumo", typeof(string));
        t.Columns.Add("cantidad", typeof(decimal));
        t.Columns.Add("empresa", typeof(string));
        foreach (var (p, i, c, e) in filas)
        {
            t.Rows.Add((object?)p ?? DBNull.Value, (object?)i ?? DBNull.Value, (object?)c ?? DBNull.Value, (object?)e ?? DBNull.Value);
        }

        return t;
    }

    public static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement.Clone();
}

public class MapeoMovimientosTests
{
    private static readonly DateTime T0 = new(2026, 9, 20, 10, 30, 0);

    private static DocumentosLeidos Mapear(params FilaMov[] filas) =>
        MapeoMovimientos.Mapear(FixturesDocumentos.Movimientos(filas).CreateDataReader(), FixturesDocumentos.Zona);

    private static JsonElement Poliza(DocumentosLeidos l, string clave) =>
        FixturesDocumentos.Json(l.Documentos.Single(d => d.Clave == clave).Json);

    [Fact]
    public void Un_traspaso_sale_en_DOS_polizas_una_por_almacen_con_la_misma_referencia_y_la_forma_del_contrato()
    {
        var l = Mapear(
            new FilaMov(T0, "STA", "I001", -2.5m, 85.4m, "A01", Traspaso: 45),
            new FilaMov(T0.AddMinutes(1), "ETA", "I001", 2.5m, 85.4m, "A02", Traspaso: 45));

        Assert.Equal(["T45|A01|STA", "T45|A02|ETA"], l.Documentos.Select(d => d.Clave));
        var salida = Poliza(l, "T45|A01|STA");
        Assert.Equal(
            ["origenSrId", "folio", "tipo", "tipoSr", "almacenOrigenSrId", "fecha", "referencia", "cancelada", "partidas"],
            salida.EnumerateObject().Select(p => p.Name));
        Assert.Equal(("45", "traspaso_salida", "STA", "A01", "Traspaso 45", false),
            (salida.GetProperty("folio").GetString(), salida.GetProperty("tipo").GetString(), salida.GetProperty("tipoSr").GetString(),
             salida.GetProperty("almacenOrigenSrId").GetString(), salida.GetProperty("referencia").GetString(),
             salida.GetProperty("cancelada").GetBoolean()));
        // Hora del POS (UTC−6) al instante UTC, con la hora real, no medianoche.
        Assert.Equal("2026-09-20T16:30:00.000Z", salida.GetProperty("fecha").GetString());
        var partida = salida.GetProperty("partidas")[0];
        Assert.Equal(["insumoOrigenSrId", "cantidad", "costoUnitario"], partida.EnumerateObject().Select(p => p.Name));
        Assert.Equal(("-2.5", "85.4"), (partida.GetProperty("cantidad").GetString(), partida.GetProperty("costoUnitario").GetString()));
        var entrada = Poliza(l, "T45|A02|ETA");
        Assert.Equal(("traspaso_entrada", "Traspaso 45", "2.5"),
            (entrada.GetProperty("tipo").GetString(), entrada.GetProperty("referencia").GetString(),
             entrada.GetProperty("partidas")[0].GetProperty("cantidad").GetString()));
    }

    [Fact]
    public void La_clase_del_documento_sigue_la_precedencia_y_un_cero_cuenta_como_vacio()
    {
        var l = Mapear(
            new FilaMov(T0, "EPC", "I1", 1m, 1m, "A01", Compra: 7, Cheque: 9, Traspaso: 0),
            new FilaMov(T0, "SPV", "I1", -1m, 1m, "A01", Cheque: 9, Movto: 3),
            new FilaMov(T0, "SPA", "I1", -1m, 1m, "A01", Fisico: 4, Cheque: 9),
            new FilaMov(T0, "EDA", "I1", 1m, 1m, "A01", Movto: 12),
            new FilaMov(T0, "SPM", "I1", -1m, 1m, "A01"));

        Assert.Equal(
            ["C7|A01|EPC", "F4|A01|SPA", "M12|A01|EDA", "S2026-09-20 10:30:00.000|A01|SPM", "V9|A01|SPV"],
            l.Documentos.Select(d => d.Clave));
        Assert.Equal("Compra 7", Poliza(l, "C7|A01|EPC").GetProperty("referencia").GetString());
        Assert.Equal("Cheque 9", Poliza(l, "V9|A01|SPV").GetProperty("referencia").GetString());
        Assert.Equal("Inventario físico 4", Poliza(l, "F4|A01|SPA").GetProperty("referencia").GetString());
        var sinDocumento = Poliza(l, "S2026-09-20 10:30:00.000|A01|SPM");
        Assert.Equal(JsonValueKind.Null, sinDocumento.GetProperty("referencia").ValueKind);
        Assert.Equal("2026-09-20 10:30:00.000", sinDocumento.GetProperty("folio").GetString());
    }

    [Theory]
    [InlineData("EPC", "compra")]
    [InlineData("SPV", "consumo")]
    [InlineData("CP", "consumo")]
    [InlineData("SPM", "merma")]
    [InlineData("SPD", "merma")]
    [InlineData("EPA", "ajuste")]
    [InlineData("SPA", "ajuste")]
    [InlineData("STA", "traspaso_salida")]
    [InlineData("ETA", "traspaso_entrada")]
    [InlineData("ECA", "otro")]
    [InlineData("EPL", "otro")]
    [InlineData("SPC", "otro")]
    [InlineData("EPD", "otro")]
    [InlineData("EDA", "otro")]
    [InlineData("SALM", "otro")]
    [InlineData("EPP", "otro")]
    [InlineData("SPP", "otro")]
    [InlineData("ZZZ", "otro")]
    [InlineData(null, "otro")]
    public void Los_17_conceptos_de_SR_y_uno_desconocido_se_traducen_al_enum_del_panel(string? concepto, string tipo)
    {
        Assert.Equal(tipo, MapeoMovimientos.TipoDe(concepto));
    }

    [Fact]
    public void Una_poliza_con_partidas_en_cero_viaja_con_ellas_y_las_partidas_van_ordenadas()
    {
        var l = Mapear(
            new FilaMov(T0, "EPA", "I2", 0m, 10m, "A01", Fisico: 3),
            new FilaMov(T0, "EPA", "I1", 0.0000m, 10m, "A01", Fisico: 3));

        var partidas = Poliza(l, "F3|A01|EPA").GetProperty("partidas");
        Assert.Equal(2, partidas.GetArrayLength());
        Assert.Equal(["I1", "I2"], partidas.EnumerateArray().Select(p => p.GetProperty("insumoOrigenSrId").GetString()));
        Assert.All(partidas.EnumerateArray(), p => Assert.Equal("0", p.GetProperty("cantidad").GetString()));
        Assert.Equal(2, l.Documentos.Single().Renglones);
    }

    [Fact]
    public void El_mismo_documento_leido_en_otro_orden_da_el_mismo_json()
    {
        var a = new FilaMov(T0, "SPV", "I1", -1m, 5m, "A01", Cheque: 9);
        var b = new FilaMov(T0.AddSeconds(3), "SPV", "I2", -2m, 6m, "A01", Cheque: 9);

        Assert.Equal(Mapear(a, b).Documentos.Single().Json, Mapear(b, a).Documentos.Single().Json);
    }

    [Fact]
    public void La_fecha_de_la_poliza_es_la_minima_y_la_de_la_ventana_la_maxima()
    {
        var l = Mapear(
            new FilaMov(T0.AddHours(5), "SPV", "I1", -1m, 5m, "A01", Cheque: 9),
            new FilaMov(T0, "SPV", "I2", -1m, 5m, "A01", Cheque: 9));

        var d = l.Documentos.Single();
        Assert.Equal(T0.AddHours(5), d.FechaVentana);
        Assert.Equal("2026-09-20T16:30:00.000Z", FixturesDocumentos.Json(d.Json).GetProperty("fecha").GetString());
        Assert.Equal(T0.AddHours(5), l.FechaMaxima);
    }

    [Fact]
    public void Toda_cancelada_viaja_cancelada_y_con_filas_vivas_viajan_las_vivas_con_aviso()
    {
        var l = Mapear(
            new FilaMov(T0, "SPM", "I1", -1m, 5m, "A01", Movto: 1, Cancelado: true),
            new FilaMov(T0, "SPM", "I1", -1m, 5m, "A01", Movto: 2),
            new FilaMov(T0, "SPM", "I2", -3m, 5m, "A01", Movto: 2, Cancelado: true));

        var cancelada = FixturesDocumentos.Json(l.Documentos.Single(d => d.Clave == "M1|A01|SPM").Json);
        Assert.True(cancelada.GetProperty("cancelada").GetBoolean());
        Assert.Equal(1, cancelada.GetProperty("partidas").GetArrayLength());
        var mezclada = FixturesDocumentos.Json(l.Documentos.Single(d => d.Clave == "M2|A01|SPM").Json);
        Assert.False(mezclada.GetProperty("cancelada").GetBoolean());
        Assert.Equal(["I1"], mezclada.GetProperty("partidas").EnumerateArray().Select(p => p.GetProperty("insumoOrigenSrId").GetString()));
        Assert.Contains(l.Avisos, a => a.Contains("movsinv Y en movsinvcancelados"));
        // La variante ausente es la misma póliza, cancelada, con sus partidas.
        var ausente = FixturesDocumentos.Json(l.Documentos.Single(d => d.Clave == "M2|A01|SPM").JsonAusente);
        Assert.True(ausente.GetProperty("cancelada").GetBoolean());
        Assert.Equal(1, ausente.GetProperty("partidas").GetArrayLength());
    }

    [Fact]
    public void Cantidades_de_4_decimales_se_redondean_a_3_y_costo_nulo_viaja_nulo_con_aviso()
    {
        var l = Mapear(
            new FilaMov(T0, "SPV", "I1", -0.0005m, null, "A01", Cheque: 1),
            new FilaMov(T0, "SPV", "I2", 1.2344m, 3.1416m, "A01", Cheque: 1));

        var p = Poliza(l, "V1|A01|SPV").GetProperty("partidas");
        Assert.Equal(("-0.001", JsonValueKind.Null), (p[0].GetProperty("cantidad").GetString(), p[0].GetProperty("costoUnitario").ValueKind));
        Assert.Equal(("1.234", "3.1416"), (p[1].GetProperty("cantidad").GetString(), p[1].GetProperty("costoUnitario").GetString()));
        Assert.Contains(l.Avisos, a => a.StartsWith("2 cantidad(es) con 4 decimales"));
        Assert.Contains(l.Avisos, a => a.StartsWith("1 partida(s) sin costo"));
        Assert.DoesNotContain(l.Avisos, a => a.Contains("3.1416") || a.Contains("1.2344"));
    }

    [Fact]
    public void Sin_almacen_no_hay_poliza_pero_cuenta_como_vista()
    {
        var l = Mapear(new FilaMov(T0, "SPV", "I1", -1m, 1m, null, Cheque: 1));

        Assert.Empty(l.Documentos);
        Assert.Equal(["V1||SPV"], l.Omitidos);
        Assert.Contains(l.Avisos, a => a.Contains("sin almacén"));
    }
}

public class MapeoComprasTests
{
    private static readonly DateTime T0 = new(2026, 9, 19, 9, 0, 0);

    private static DocumentosLeidos Mapear(params FilaCompra[] filas) =>
        MapeoCompras.Mapear(FixturesDocumentos.Compras(filas).CreateDataReader(), FixturesDocumentos.Zona);

    [Fact]
    public void Una_compra_viaja_completa_con_la_forma_del_contrato()
    {
        var l = Mapear(
            new FilaCompra(10, "F-10 ", T0, "PR01", false, "I2", 1.5m, 20m, "A01"),
            new FilaCompra(10, "F-10 ", T0, "PR01", false, "I1", 12.5m, 85.4m, "A01"));

        var c = FixturesDocumentos.Json(l.Documentos.Single().Json);
        Assert.Equal(
            ["origenSrId", "folio", "proveedorOrigenSrId", "almacenOrigenSrId", "fecha", "cancelada", "partidas"],
            c.EnumerateObject().Select(p => p.Name));
        Assert.Equal(("10", "F-10", "PR01", "A01", "2026-09-19T15:00:00.000Z", false),
            (c.GetProperty("origenSrId").GetString(), c.GetProperty("folio").GetString(),
             c.GetProperty("proveedorOrigenSrId").GetString(), c.GetProperty("almacenOrigenSrId").GetString(),
             c.GetProperty("fecha").GetString(), c.GetProperty("cancelada").GetBoolean()));
        Assert.Equal(["I1", "I2"], c.GetProperty("partidas").EnumerateArray().Select(p => p.GetProperty("insumoOrigenSrId").GetString()));
        Assert.Equal(("12.5", "85.4"), (c.GetProperty("partidas")[0].GetProperty("cantidad").GetString(),
            c.GetProperty("partidas")[0].GetProperty("costoUnitario").GetString()));
        Assert.Equal(T0, l.FechaMaxima);
    }

    [Fact]
    public void Una_compra_cancelada_viaja_cancelada_y_sin_renglones_viaja_con_partidas_vacias()
    {
        var l = Mapear(
            new FilaCompra(11, "F-11", T0, null, true, "I1", 1m, 1m, "A01"),
            new FilaCompra(12, null, T0, "  ", false, null, null, null, null));

        var cancelada = FixturesDocumentos.Json(l.Documentos.Single(d => d.Clave == "11").Json);
        Assert.True(cancelada.GetProperty("cancelada").GetBoolean());
        Assert.Equal(JsonValueKind.Null, cancelada.GetProperty("proveedorOrigenSrId").ValueKind);
        var vacia = FixturesDocumentos.Json(l.Documentos.Single(d => d.Clave == "12").Json);
        Assert.Equal(0, vacia.GetProperty("partidas").GetArrayLength());
        Assert.Equal("12", vacia.GetProperty("folio").GetString()); // sin folio: el idcompra
        Assert.Equal(JsonValueKind.Null, vacia.GetProperty("proveedorOrigenSrId").ValueKind);
    }

    [Fact]
    public void Renglones_de_varios_almacenes_viajan_sin_almacen_y_el_descuento_se_avisa()
    {
        var l = Mapear(
            new FilaCompra(13, "F", T0, null, false, "I1", 1m, 1m, "A01", DescuentoRenglon: 10m),
            new FilaCompra(13, "F", T0, null, false, "I2", 1m, 1m, "A02"));

        var c = FixturesDocumentos.Json(l.Documentos.Single().Json);
        Assert.Equal(JsonValueKind.Null, c.GetProperty("almacenOrigenSrId").ValueKind);
        Assert.Contains(l.Avisos, a => a.Contains("varios almacenes"));
        Assert.Contains(l.Avisos, a => a.Contains("SIN aplicar el descuento"));
    }

    [Fact]
    public void Sin_fecha_no_se_manda_pero_cuenta_como_vista_y_cantidad_no_positiva_se_avisa()
    {
        var l = Mapear(
            new FilaCompra(14, "F", null, null, false, "I1", 1m, 1m, "A01"),
            new FilaCompra(15, "F", T0, null, false, "I1", 0m, 1m, "A01"));

        Assert.Equal(["15"], l.Documentos.Select(d => d.Clave));
        Assert.Equal(["14"], l.Omitidos);
        Assert.Contains(l.Avisos, a => a.Contains("sin fechaaplicacion"));
        Assert.Contains(l.Avisos, a => a.Contains("cero o negativa"));
    }
}

public class MapeoRecetasTests
{
    private static DocumentosLeidos Mapear(params (string?, string?, decimal?, string?)[] filas) =>
        MapeoRecetas.Mapear(FixturesDocumentos.Recetas(filas).CreateDataReader());

    [Fact]
    public void Una_receta_viaja_completa_ordenada_con_4_decimales_y_su_ausente_es_vacia()
    {
        var l = Mapear(("P1", "I2", 0.1500m, "E1"), ("P1", "I1", 0.0005m, "E1"), ("P2", "I1", 1m, "E1"));

        Assert.Equal(["P1", "P2"], l.Documentos.Select(d => d.Clave));
        var r = FixturesDocumentos.Json(l.Documentos[0].Json);
        Assert.Equal(["productoOrigenSrId", "renglones"], r.EnumerateObject().Select(p => p.Name));
        Assert.Equal(["I1", "I2"], r.GetProperty("renglones").EnumerateArray().Select(x => x.GetProperty("insumoOrigenSrId").GetString()));
        Assert.Equal(["0.0005", "0.1500"], r.GetProperty("renglones").EnumerateArray().Select(x => x.GetProperty("cantidad").GetString()));
        Assert.Equal(["insumoOrigenSrId", "cantidad"], r.GetProperty("renglones")[0].EnumerateObject().Select(p => p.Name));
        var ausente = FixturesDocumentos.Json(l.Documentos[0].JsonAusente);
        Assert.Equal(("P1", 0), (ausente.GetProperty("productoOrigenSrId").GetString(), ausente.GetProperty("renglones").GetArrayLength()));
        Assert.Null(l.Documentos[0].FechaVentana);
    }

    [Fact]
    public void Un_insumo_sin_receta_no_genera_nada_y_un_producto_sin_receta_no_se_manda()
    {
        // I9 existe en el catálogo pero no está en costos; P9 tampoco: no hay filas, no hay nada que mandar.
        var l = Mapear(("P1", "I1", 1m, "E1"));

        Assert.Equal(["P1"], l.Documentos.Select(d => d.Clave));
        Assert.DoesNotContain("I9", l.Documentos.Single().Json);
    }

    [Fact]
    public void Varias_empresas_iguales_mandan_una_y_distintas_no_se_mandan_pero_cuentan_como_vistas()
    {
        var l = Mapear(
            ("P1", "I1", 1m, "E1"), ("P1", "I1", 1m, "E2"),
            ("P2", "I1", 1m, "E1"), ("P2", "I1", 2m, "E2"));

        Assert.Equal(["P1"], l.Documentos.Select(d => d.Clave));
        Assert.Equal(1, FixturesDocumentos.Json(l.Documentos[0].Json).GetProperty("renglones").GetArrayLength());
        Assert.Equal(["P2"], l.Omitidos);
        Assert.Contains(l.Avisos, a => a.Contains("varias empresas"));
    }
}
