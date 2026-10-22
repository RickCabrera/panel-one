using System.Text.Json;
using ArkonAgente.Cola;
using ArkonAgente.Catalogos;
using ArkonAgente.Configuracion;
using ArkonAgente.SoftRestaurant;
using ArkonAgente.Ventas;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Tests;

/// <summary>
/// Fixtures SINTÉTICAS de cuentas cerradas con la forma de <c>sr_cheques.sql</c> (F1-022). Los
/// importes y nombres son inventados; sólo la FORMA sigue lo visto en SR 10 (esquema-sr §2–§4).
/// </summary>
internal static class FixturesCheques
{
    /// <summary>Una zona fija de UTC−6, como la de la PC del POS.</summary>
    public static readonly TimeZoneInfo ZonaMenos6 =
        TimeZoneInfo.CreateCustomTimeZone("Prueba-6", TimeSpan.FromHours(-6), "Prueba -6", "Prueba -6");

    public static FilaCuenta Cuenta(
        long folio,
        long? numCheque,
        decimal total,
        OrigenCuenta origen = OrigenCuenta.Definitiva,
        decimal? subtotal = null,
        decimal? descuentoImporte = 0m,
        decimal? impuestos = 0m,
        decimal? totalDescuentos = 0m,
        decimal? totalCortesias = 0m,
        decimal? propina = 0m,
        bool cancelado = false,
        string? mesa = "7",
        string? mesero = "MESERO A",
        string? serie = "",
        string? cliente = "",
        string? area = "A1",
        int? comensales = 3,
        DateTime? fecha = null,
        DateTime? cierre = null) =>
        new(origen, folio, numCheque, serie, fecha ?? new DateTime(2026, 3, 10, 13, 0, 0),
            cierre ?? new DateTime(2026, 3, 10, 13, 45, 30), mesa, comensales, mesero, area, cliente,
            subtotal ?? total, descuentoImporte, impuestos, totalDescuentos, totalCortesias, propina, total, cancelado);

    public static FilaPartida Partida(
        long folio, int movimiento, string producto, decimal precio, decimal cantidad = 1m, decimal descuento = 0m,
        OrigenCuenta origen = OrigenCuenta.Definitiva, bool modificador = false, string? categoria = "GRUPO X") =>
        new(origen, folio, movimiento, cantidad, "P" + movimiento, producto, categoria, precio, descuento, modificador);

    public static FilaPago Pago(long folio, string forma, decimal importe, OrigenCuenta origen = OrigenCuenta.Definitiva) =>
        new(origen, folio, forma[..2], forma, importe);
}

public class MapeoChequesTests
{
    private static ChequesMapeados Mapear(
        IReadOnlyList<FilaCuenta> cuentas, IReadOnlyList<FilaPartida> partidas, IReadOnlyList<FilaPago> pagos) =>
        MapeoCheques.Mapear(cuentas, partidas, pagos, FixturesCheques.ZonaMenos6);

    private static JsonElement Unico(ChequesMapeados mapeo) =>
        JsonDocument.Parse(Assert.Single(mapeo.Cheques).Payload).RootElement;

    [Fact]
    public void Una_cuenta_cobrada_sale_con_la_forma_exacta_del_contrato()
    {
        var mapeo = Mapear(
            [FixturesCheques.Cuenta(4, 105, 150m, subtotal: 129.3103m, impuestos: 20.6897m, mesa: " 7 ", mesero: "MESERO A   ",
                cliente: "   ", area: "A1  ")],
            [FixturesCheques.Partida(4, 1, "CALDO", 100m), FixturesCheques.Partida(4, 2, "REFRESCO", 25m, cantidad: 2m)],
            [FixturesCheques.Pago(4, "EFECTIVO", 150m)]);

        var c = Unico(mapeo);
        Assert.Equal(
            ["folioSr", "folio", "abiertoAt", "cerradoAt", "mesa", "mesero", "comensales", "clienteOrigenSrId",
             "areaOrigenSrId", "subtotal", "impuestos", "descuentos", "propina", "total", "cancelado", "partidas", "pagos"],
            c.EnumerateObject().Select(p => p.Name));
        Assert.Equal("105", c.GetProperty("folioSr").GetString());
        Assert.Equal("105", c.GetProperty("folio").GetString());
        Assert.Equal("2026-03-10T13:00:00.000-06:00", c.GetProperty("abiertoAt").GetString());
        Assert.Equal("2026-03-10T13:45:30.000-06:00", c.GetProperty("cerradoAt").GetString());
        Assert.Equal("7", c.GetProperty("mesa").GetString());
        Assert.Equal("MESERO A", c.GetProperty("mesero").GetString());
        Assert.Equal(3, c.GetProperty("comensales").GetInt32());
        Assert.Equal(JsonValueKind.Null, c.GetProperty("clienteOrigenSrId").ValueKind);
        Assert.Equal("A1", c.GetProperty("areaOrigenSrId").GetString());
        Assert.Equal("129.3103", c.GetProperty("subtotal").GetString());
        Assert.Equal("20.6897", c.GetProperty("impuestos").GetString());
        Assert.Equal("0", c.GetProperty("descuentos").GetString());
        Assert.Equal("150", c.GetProperty("total").GetString());
        Assert.False(c.GetProperty("cancelado").GetBoolean());
        var partidas = c.GetProperty("partidas");
        Assert.Equal(["producto", "categoria", "cantidad", "precioUnit", "total"],
            partidas[0].EnumerateObject().Select(p => p.Name));
        Assert.Equal(("REFRESCO", "2", "25", "50"),
            (partidas[1].GetProperty("producto").GetString(), partidas[1].GetProperty("cantidad").GetString(),
             partidas[1].GetProperty("precioUnit").GetString(), partidas[1].GetProperty("total").GetString()));
        Assert.Equal(["formaRaw", "monto"], c.GetProperty("pagos")[0].EnumerateObject().Select(p => p.Name));
        Assert.Equal("EFECTIVO", c.GetProperty("pagos")[0].GetProperty("formaRaw").GetString());
        Assert.Empty(mapeo.Avisos);
        Assert.Empty(mapeo.Errores);
        Assert.Empty(mapeo.Releer);
    }

    [Fact]
    public void El_descuento_general_se_resta_del_subtotal_porque_SR_lo_guarda_antes_del_descuento()
    {
        // subtotal 250 sin IVA, 20 % general = 50, IVA sobre lo neto 32, total 232.
        var c = Unico(Mapear(
            [FixturesCheques.Cuenta(1, 10, 232m, subtotal: 250m, descuentoImporte: 50m, impuestos: 32m, totalDescuentos: 50m)],
            [FixturesCheques.Partida(1, 1, "PLATO", 290m)],
            [FixturesCheques.Pago(1, "EFECTIVO", 232m)]));

        Assert.Equal("200", c.GetProperty("subtotal").GetString());
        Assert.Equal("50", c.GetProperty("descuentos").GetString());
        Assert.Equal("232", c.GetProperty("total").GetString());
    }

    [Fact]
    public void El_descuento_de_una_partida_va_en_su_importe_y_no_se_resta_otra_vez_del_subtotal()
    {
        // La partida de 60 con 25 % vale 45; SR ya trae el subtotal neto de ese descuento.
        var c = Unico(Mapear(
            [FixturesCheques.Cuenta(1, 11, 75m, subtotal: 64.6552m, impuestos: 10.3448m, totalDescuentos: 12.931m)],
            [FixturesCheques.Partida(1, 1, "POSTRE", 60m, descuento: 25m), FixturesCheques.Partida(1, 2, "CAFE", 30m)],
            [FixturesCheques.Pago(1, "EFECTIVO", 75m)]));

        Assert.Equal("64.6552", c.GetProperty("subtotal").GetString());
        Assert.Equal("45", c.GetProperty("partidas")[0].GetProperty("total").GetString());
        Assert.Equal("60", c.GetProperty("partidas")[0].GetProperty("precioUnit").GetString());
        Assert.Equal("12.931", c.GetProperty("descuentos").GetString());
    }

    [Fact]
    public void Una_cortesia_total_es_un_descuento_del_100_y_sale_en_cero_con_su_pago_en_cero()
    {
        var c = Unico(Mapear(
            [FixturesCheques.Cuenta(1, 12, 0m, subtotal: 43.1034m, descuentoImporte: 43.1m, totalCortesias: 43.1034m)],
            [FixturesCheques.Partida(1, 1, "JUGO", 50m)],
            [FixturesCheques.Pago(1, "EFECTIVO", 0m)]));

        Assert.Equal("0.0034", c.GetProperty("subtotal").GetString()); // el residuo de SR viaja; el API redondea
        Assert.Equal("43.1034", c.GetProperty("descuentos").GetString()); // la cortesía va en descuentos
        Assert.Equal("0", c.GetProperty("total").GetString());
        Assert.Equal("0", c.GetProperty("pagos")[0].GetProperty("monto").GetString());
    }

    [Fact]
    public void La_cortesia_de_una_partida_la_deja_en_cero_y_suma_a_descuentos()
    {
        var c = Unico(Mapear(
            [FixturesCheques.Cuenta(1, 13, 30m, subtotal: 30m, totalCortesias: 51.7241m)],
            [FixturesCheques.Partida(1, 1, "JARRA", 60m, descuento: 100m), FixturesCheques.Partida(1, 2, "AGUA", 30m)],
            [FixturesCheques.Pago(1, "EFECTIVO", 30m)]));

        Assert.Equal("0", c.GetProperty("partidas")[0].GetProperty("total").GetString());
        Assert.Equal("51.7241", c.GetProperty("descuentos").GetString());
    }

    [Fact]
    public void La_propina_va_aparte_y_el_total_y_los_pagos_no_la_incluyen()
    {
        var c = Unico(Mapear(
            [FixturesCheques.Cuenta(1, 14, 180m, propina: 25m)],
            [FixturesCheques.Partida(1, 1, "MENU", 180m)],
            [FixturesCheques.Pago(1, "VISA", 180m)]));

        Assert.Equal("25", c.GetProperty("propina").GetString());
        Assert.Equal("180", c.GetProperty("total").GetString());
        Assert.Equal("180", c.GetProperty("pagos")[0].GetProperty("monto").GetString());
    }

    [Fact]
    public void Un_pago_mixto_manda_una_forma_por_fila_en_su_orden()
    {
        var c = Unico(Mapear(
            [FixturesCheques.Cuenta(1, 15, 310m)],
            [FixturesCheques.Partida(1, 1, "MENU", 310m)],
            [FixturesCheques.Pago(1, "EFECTIVO", 110m), FixturesCheques.Pago(1, "VISA", 200m)]));

        var pagos = c.GetProperty("pagos");
        Assert.Equal(["EFECTIVO", "VISA"], pagos.EnumerateArray().Select(p => p.GetProperty("formaRaw").GetString()));
        Assert.Equal(["110", "200"], pagos.EnumerateArray().Select(p => p.GetProperty("monto").GetString()));
    }

    [Fact]
    public void Sin_texto_de_forma_de_pago_viaja_la_clave_de_SR()
    {
        var c = Unico(Mapear(
            [FixturesCheques.Cuenta(1, 16, 10m)],
            [FixturesCheques.Partida(1, 1, "X", 10m)],
            [new FilaPago(OrigenCuenta.Definitiva, 1, "ZZ ", null, 10m)]));

        Assert.Equal("ZZ", c.GetProperty("pagos")[0].GetProperty("formaRaw").GetString());
    }

    [Fact]
    public void Una_venta_rapida_sin_mesa_ni_mesero_ni_cliente_sale_con_nulos_no_con_textos_vacios()
    {
        var c = Unico(Mapear(
            [FixturesCheques.Cuenta(1, 17, 90m, mesa: "", mesero: null, cliente: "      ", area: "A3")],
            [FixturesCheques.Partida(1, 1, "AGUA", 90m)],
            [FixturesCheques.Pago(1, "EFECTIVO", 90m)]));

        Assert.Equal(JsonValueKind.Null, c.GetProperty("mesa").ValueKind);
        Assert.Equal(JsonValueKind.Null, c.GetProperty("mesero").ValueKind);
        Assert.Equal(JsonValueKind.Null, c.GetProperty("clienteOrigenSrId").ValueKind);
        Assert.Equal("A3", c.GetProperty("areaOrigenSrId").GetString());
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0L)]
    public void Una_cuenta_cerrada_sin_numcheque_no_se_manda_y_no_se_inventa_llave(long? numCheque)
    {
        var mapeo = Mapear(
            [FixturesCheques.Cuenta(9, numCheque, 10m)],
            [FixturesCheques.Partida(9, 1, "X", 10m)],
            [FixturesCheques.Pago(9, "EFECTIVO", 10m)]);

        Assert.Empty(mapeo.Cheques);
        Assert.Contains(mapeo.Avisos, a => a.Contains("cheques.folio 9") && a.Contains("no trae numcheque"));
        Assert.Empty(mapeo.Releer); // releerla no le da llave
    }

    [Fact]
    public void La_serie_si_la_hay_va_delante_del_numcheque()
    {
        var c = Unico(Mapear(
            [FixturesCheques.Cuenta(1, 33, 10m, serie: " B ")],
            [FixturesCheques.Partida(1, 1, "X", 10m)],
            [FixturesCheques.Pago(1, "EFECTIVO", 10m)]));

        Assert.Equal("B-33", c.GetProperty("folioSr").GetString());
    }

    [Fact]
    public void Si_la_misma_cuenta_se_ve_en_tempcheques_y_en_cheques_a_medio_corte_manda_la_de_cheques()
    {
        var mapeo = Mapear(
            [
                FixturesCheques.Cuenta(1, 40, 10m, origen: OrigenCuenta.Temporal),
                FixturesCheques.Cuenta(7, 40, 10m),
            ],
            [
                FixturesCheques.Partida(1, 1, "X", 10m, origen: OrigenCuenta.Temporal),
                FixturesCheques.Partida(7, 1, "X", 10m),
            ],
            [FixturesCheques.Pago(1, "EFECTIVO", 10m, OrigenCuenta.Temporal), FixturesCheques.Pago(7, "EFECTIVO", 10m)]);

        var cheque = Assert.Single(mapeo.Cheques);
        Assert.Equal((OrigenCuenta.Definitiva, 7L), (cheque.Origen, cheque.FolioInterno));
    }

    [Fact]
    public void Si_tempcheques_y_cheques_traen_el_mismo_numcheque_con_otra_apertura_no_son_la_misma_cuenta()
    {
        var mapeo = Mapear(
            [
                FixturesCheques.Cuenta(1, 41, 10m, origen: OrigenCuenta.Temporal, fecha: new DateTime(2026, 3, 11, 9, 0, 0)),
                FixturesCheques.Cuenta(7, 41, 10m),
            ],
            [
                FixturesCheques.Partida(1, 1, "X", 10m, origen: OrigenCuenta.Temporal),
                FixturesCheques.Partida(7, 1, "X", 10m),
            ],
            [FixturesCheques.Pago(1, "EFECTIVO", 10m, OrigenCuenta.Temporal), FixturesCheques.Pago(7, "EFECTIVO", 10m)]);

        Assert.Empty(mapeo.Cheques);
        Assert.Contains(mapeo.Errores, e => e.Contains("El folio 41 aparece en tempcheques y en cheques"));
    }

    [Fact]
    public void Dos_cuentas_distintas_con_el_mismo_numcheque_no_se_mandan_porque_una_pisaria_a_la_otra()
    {
        var mapeo = Mapear(
            [FixturesCheques.Cuenta(1, 50, 10m), FixturesCheques.Cuenta(2, 50, 20m), FixturesCheques.Cuenta(3, 51, 30m)],
            [
                FixturesCheques.Partida(1, 1, "X", 10m), FixturesCheques.Partida(2, 1, "Y", 20m),
                FixturesCheques.Partida(3, 1, "Z", 30m),
            ],
            [
                FixturesCheques.Pago(1, "EFECTIVO", 10m), FixturesCheques.Pago(2, "EFECTIVO", 20m),
                FixturesCheques.Pago(3, "EFECTIVO", 30m),
            ]);

        Assert.Equal(["51"], mapeo.Cheques.Select(c => c.FolioSr));
        Assert.Contains(mapeo.Errores, e => e.Contains("El folio 50 aparece en 2 cuentas"));
    }

    [Fact]
    public void Una_cuenta_cobrada_cuyos_pagos_no_suman_el_total_o_sin_partidas_se_relee_y_detiene_el_cursor()
    {
        var mapeo = Mapear(
            [FixturesCheques.Cuenta(5, 60, 100m), FixturesCheques.Cuenta(6, 61, 100m)],
            [FixturesCheques.Partida(5, 1, "X", 100m)],
            [FixturesCheques.Pago(5, "EFECTIVO", 60m), FixturesCheques.Pago(6, "EFECTIVO", 100m)]);

        Assert.Empty(mapeo.Cheques);
        Assert.Equal([(OrigenCuenta.Definitiva, 5L), (OrigenCuenta.Definitiva, 6L)], mapeo.Releer);
        Assert.Equal(2, mapeo.Avisos.Count(a => a.Contains("llegó incompleta")));
    }

    [Fact]
    public void Una_cancelada_viaja_aunque_sus_pagos_no_sumen_porque_eso_no_se_ha_visto_en_SR()
    {
        var c = Unico(Mapear(
            [FixturesCheques.Cuenta(1, 70, 45m, cancelado: true)],
            [FixturesCheques.Partida(1, 1, "X", 45m)],
            []));

        Assert.True(c.GetProperty("cancelado").GetBoolean());
        Assert.Equal(0, c.GetProperty("pagos").GetArrayLength());
    }

    [Fact]
    public void Un_modificador_se_cuelga_de_la_partida_anterior_con_su_precio()
    {
        var c = Unico(Mapear(
            [FixturesCheques.Cuenta(1, 80, 130m)],
            [
                FixturesCheques.Partida(1, 1, "MICHELADA", 100m),
                FixturesCheques.Partida(1, 2, "CERVEZA CLARA", 30m, modificador: true),
            ],
            [FixturesCheques.Pago(1, "EFECTIVO", 130m)]));

        var partida = Assert.Single(c.GetProperty("partidas").EnumerateArray());
        var mod = Assert.Single(partida.GetProperty("modificadores").EnumerateArray());
        Assert.Equal(("CERVEZA CLARA", "30"), (mod.GetProperty("nombre").GetString(), mod.GetProperty("precio").GetString()));
    }

    [Fact]
    public void Una_cuenta_que_excede_el_tope_de_partidas_del_contrato_no_se_manda_ni_detiene_el_cursor()
    {
        var partidas = Enumerable.Range(1, MapeoCheques.MaxPartidas + 1)
            .Select(i => FixturesCheques.Partida(1, i, "X", 1m)).ToList();
        var mapeo = Mapear(
            [FixturesCheques.Cuenta(1, 90, MapeoCheques.MaxPartidas + 1)], partidas,
            [FixturesCheques.Pago(1, "EFECTIVO", MapeoCheques.MaxPartidas + 1)]);

        Assert.Empty(mapeo.Cheques);
        Assert.Contains(mapeo.Errores, e => e.Contains("excede el contrato"));
        Assert.Empty(mapeo.Releer);
    }

    [Fact]
    public void Un_dato_obligatorio_nulo_no_se_inventa_y_tampoco_detiene_el_cursor()
    {
        var mapeo = Mapear(
            [FixturesCheques.Cuenta(1, 91, 10m) with { Total = null }],
            [FixturesCheques.Partida(1, 1, "X", 10m)],
            [FixturesCheques.Pago(1, "EFECTIVO", 10m)]);

        Assert.Empty(mapeo.Cheques);
        Assert.Empty(mapeo.Releer);
        Assert.Contains(mapeo.Avisos, a => a.Contains("no trae fecha, subtotal o total"));
    }

    [Fact]
    public void Una_fecha_local_de_SR_lleva_el_offset_de_su_zona_EN_ESE_instante()
    {
        // Zona sintética con horario de verano (abril–octubre, UTC−7 → UTC−6).
        var regla = TimeZoneInfo.AdjustmentRule.CreateAdjustmentRule(
            DateTime.MinValue.Date, DateTime.MaxValue.Date, TimeSpan.FromHours(1),
            TimeZoneInfo.TransitionTime.CreateFixedDateRule(new DateTime(1, 1, 1, 2, 0, 0), 4, 1),
            TimeZoneInfo.TransitionTime.CreateFixedDateRule(new DateTime(1, 1, 1, 2, 0, 0), 10, 1));
        var zona = TimeZoneInfo.CreateCustomTimeZone("Prueba-7", TimeSpan.FromHours(-7), "P", "P", "P", [regla]);

        Assert.Equal("2026-01-15T10:00:00.000-07:00", MapeoCheques.ConZona(new DateTime(2026, 1, 15, 10, 0, 0), zona));
        Assert.Equal("2026-07-15T10:00:00.000-06:00", MapeoCheques.ConZona(new DateTime(2026, 7, 15, 10, 0, 0), zona));
    }

    [Fact]
    public void La_misma_cuenta_da_la_misma_huella_y_un_cambio_da_otra()
    {
        ChequeMapeado Uno(bool cancelado) => Assert.Single(Mapear(
            [FixturesCheques.Cuenta(1, 95, 10m, cancelado: cancelado)],
            [FixturesCheques.Partida(1, 1, "X", 10m)],
            [FixturesCheques.Pago(1, "EFECTIVO", 10m)]).Cheques);

        Assert.Equal(Uno(false).Huella, Uno(false).Huella);
        Assert.NotEqual(Uno(false).Huella, Uno(true).Huella);
    }
}

public class ColaChequesTests : IDisposable
{
    private readonly CarpetaTemporal _carpeta = new();
    private readonly RelojFalso _reloj = new();

    public void Dispose() => _carpeta.Dispose();

    [Fact]
    public void El_cursor_empieza_en_menos_uno_y_sobrevive_a_reabrir_el_archivo()
    {
        var cola = ColaCheques.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        Assert.Equal(-1, cola.UltimoFolio());
        cola.GuardarUltimoFolio(42);

        Assert.Equal(42, ColaCheques.Abrir(_carpeta.Rutas.ArchivoCola, _reloj).UltimoFolio());
    }

    [Fact]
    public void Olvida_la_huella_de_un_cheque_que_no_se_ve_en_90_dias_y_conserva_la_de_los_que_siguen_apareciendo()
    {
        var cola = ColaCheques.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        cola.GuardarVisto("1", new ChequeVisto("a", "h1"));
        cola.GuardarVisto("2", new ChequeVisto("b", "h2"));
        _reloj.Avanzar(TimeSpan.FromDays(80));
        cola.Tocar(["2"]);
        _reloj.Avanzar(TimeSpan.FromDays(11));

        Assert.Equal(1, cola.Purgar());
        Assert.Null(cola.Visto("1"));
        Assert.Equal(new ChequeVisto("b", "h2"), cola.Visto("2"));
    }

    [Fact]
    public void Convive_con_la_cola_de_eventos_y_las_marcas_de_existencias_en_el_mismo_cola_db()
    {
        var eventos = ColaLocal.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        var existencias = ColaExistencias.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        existencias.GuardarMarca("existencias.ultima_lectura", "x");
        var cola = ColaCheques.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        cola.GuardarUltimoFolio(7);

        Assert.Equal("7", existencias.Marca(ColaCheques.MarcaUltimoFolio));
        Assert.Equal(0, eventos.ContarPendientes());
    }
}

/// <summary>Lector de cheques falso: devuelve lo que el test le pone y anota las ventanas que le pidieron.</summary>
internal sealed class LectorChequesFalso : ILectorCheques
{
    public List<FilaCuenta> Cuentas { get; } = [];

    public List<FilaPartida> Partidas { get; } = [];

    public List<FilaPago> Pagos { get; } = [];

    public long? MaxFolio { get; set; }

    public Func<Exception>? Falla { get; set; }

    public PermisosLectura Permisos { get; set; } = new(true, null);

    public int RevisionesPermisos { get; private set; }

    public List<VentanaCheques> Ventanas { get; } = [];

    public Task<PermisosLectura> RevisarPermisosAsync(CancellationToken cancelacion)
    {
        RevisionesPermisos++;
        return Task.FromResult(Permisos);
    }

    public Task<LecturaCheques> LeerAsync(VentanaCheques ventana, CancellationToken cancelacion)
    {
        Ventanas.Add(ventana);
        if (Falla is not null)
        {
            throw Falla();
        }

        var maximo = MaxFolio ?? (Cuentas.Where(c => c.Origen == OrigenCuenta.Definitiva).Select(c => (long?)c.Folio).Max());
        return Task.FromResult(new LecturaCheques(maximo, Cuentas.ToList(), Partidas.ToList(), Pagos.ToList(), 12));
    }

    /// <summary>Una cuenta completa y cuadrada (una partida y un pago por el total).</summary>
    public void Agregar(FilaCuenta cuenta)
    {
        Cuentas.Add(cuenta);
        Partidas.Add(FixturesCheques.Partida(cuenta.Folio, 1, "PRODUCTO", cuenta.Total!.Value, origen: cuenta.Origen));
        Pagos.Add(FixturesCheques.Pago(cuenta.Folio, "EFECTIVO", cuenta.Total!.Value, cuenta.Origen));
    }

    public void Quitar(OrigenCuenta origen, long folio)
    {
        Cuentas.RemoveAll(c => c.Origen == origen && c.Folio == folio);
        Partidas.RemoveAll(p => p.Origen == origen && p.Folio == folio);
        Pagos.RemoveAll(p => p.Origen == origen && p.Folio == folio);
    }
}

public class SincronizadorChequesTests : IDisposable
{
    private static readonly ISoftRestaurantReader Reader = new SrV11Reader(new VersionSr("10.021800", 10));

    private readonly CarpetaTemporal _carpeta = new();
    private readonly RelojFalso _reloj = new(); // 2026-09-21 12:00 UTC = 06:00 en UTC−6
    private readonly LogSimple _log = new();
    private readonly LectorChequesFalso _lector = new();
    private readonly ColaLocal _cola;
    private readonly ColaCheques _estado;
    private SincronizadorCheques _sinc;

    public SincronizadorChequesTests()
    {
        _cola = ColaLocal.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        _estado = ColaCheques.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        _sinc = Nuevo();
    }

    private SincronizadorCheques Nuevo() =>
        new(_estado, _ => _lector, Datos.Config(), _reloj, FixturesCheques.ZonaMenos6, _log);

    public void Dispose() => _carpeta.Dispose();

    private async Task<ResultadoSondeo> Ciclo()
    {
        var resultado = await _sinc.CicloAsync(Reader, _cola, CancellationToken.None);
        _reloj.Avanzar(TimeSpan.FromSeconds(30));
        return resultado;
    }

    private List<JsonElement> Encolados() =>
        _cola.TomarPendientes(1000).Where(e => e.Tipo == TipoEvento.Cheque)
            .Select(e => JsonDocument.Parse(e.Payload).RootElement.Clone()).ToList();

    [Fact]
    public async Task Encola_cada_cuenta_cerrada_una_vez_y_no_la_reenvia_si_no_cambio()
    {
        _lector.Agregar(FixturesCheques.Cuenta(1, 100, 50m, origen: OrigenCuenta.Temporal));
        _lector.Agregar(FixturesCheques.Cuenta(3, 98, 70m));

        var resultado = await Ciclo();
        await Ciclo();
        _sinc = Nuevo(); // un reinicio del servicio tampoco reenvía: la huella vive en el SQLite
        await Ciclo();

        Assert.Equal([98, 100], Encolados().Select(c => int.Parse(c.GetProperty("folioSr").GetString()!)).Order());
        Assert.True(resultado.Ok);
        Assert.Equal(12, resultado.LatenciaMs);
        Assert.Equal(new DateTimeOffset(2026, 9, 21, 12, 0, 0, TimeSpan.Zero), resultado.Instante);
        Assert.Single(_log.De(LogLevel.Information), m => m.Contains("encoladas 2, sin cambios 0"));
    }

    [Fact]
    public async Task Tras_el_corte_la_misma_cuenta_aparece_en_cheques_con_otro_folio_y_no_se_reenvia()
    {
        var temporal = FixturesCheques.Cuenta(2, 120, 80m, origen: OrigenCuenta.Temporal);
        _lector.Agregar(temporal);
        await Ciclo();

        _lector.Quitar(OrigenCuenta.Temporal, 2);
        _lector.Agregar(temporal with { Origen = OrigenCuenta.Definitiva, Folio = 0 });
        await Ciclo();

        Assert.Single(Encolados());
        Assert.Equal(0, _estado.UltimoFolio()); // el cursor sí avanza sobre cheques
    }

    [Fact]
    public async Task Una_cuenta_que_cambia_se_vuelve_a_encolar_y_en_la_cola_sólo_queda_su_ultima_version()
    {
        var cuenta = FixturesCheques.Cuenta(4, 130, 60m);
        _lector.Agregar(cuenta);
        await Ciclo();

        _lector.Cuentas[0] = cuenta with { Cancelado = true };
        await Ciclo();

        var unico = Assert.Single(Encolados()); // la cola colapsa por folioSr
        Assert.True(unico.GetProperty("cancelado").GetBoolean());
    }

    [Fact]
    public async Task Un_folio_que_reaparece_en_una_cuenta_con_otra_apertura_no_se_manda_y_va_al_log_como_error()
    {
        _lector.Agregar(FixturesCheques.Cuenta(1, 140, 10m));
        await Ciclo();
        _cola.MarcarEnviados(_cola.TomarPendientes(100).Select(e => e.Id));

        _lector.Quitar(OrigenCuenta.Definitiva, 1);
        _lector.Agregar(FixturesCheques.Cuenta(9, 140, 99m, fecha: new DateTime(2027, 1, 2, 9, 0, 0)));
        await Ciclo();
        await Ciclo();

        Assert.Empty(Encolados());
        Assert.Single(_log.De(LogLevel.Error), m => m.Contains("El folio 140 ya se mandó para una cuenta abierta el 2026-03-10"));
    }

    [Fact]
    public async Task El_cursor_empieza_en_menos_uno_con_las_ventanas_en_hora_local_y_avanza_al_mayor_folio_leido()
    {
        _lector.Agregar(FixturesCheques.Cuenta(5, 150, 10m));
        _lector.Agregar(FixturesCheques.Cuenta(8, 151, 10m));
        await Ciclo();
        await Ciclo();

        var primera = _lector.Ventanas[0];
        Assert.Equal(-1, primera.UltimoFolio);
        Assert.Equal(new DateTime(2026, 9, 14, 6, 0, 0), primera.Piso); // 7 días antes, hora de la PC (UTC−6)
        Assert.Equal(new DateTime(2026, 9, 21, 4, 0, 0), primera.Desde); // 2 h antes
        Assert.Equal(8, _lector.Ventanas[1].UltimoFolio);
    }

    [Fact]
    public async Task El_cursor_no_pasa_de_una_cuenta_que_llego_incompleta()
    {
        _lector.Agregar(FixturesCheques.Cuenta(5, 160, 10m));
        _lector.Agregar(FixturesCheques.Cuenta(6, 161, 10m));
        _lector.Agregar(FixturesCheques.Cuenta(7, 162, 10m));
        _lector.Pagos.RemoveAll(p => p.Folio == 6); // a medio escribir

        await Ciclo();

        Assert.Equal(5, _estado.UltimoFolio());
        Assert.Equal(["160", "162"], Encolados().Select(c => c.GetProperty("folioSr").GetString()));
        Assert.Single(_log.De(LogLevel.Warning), m => m.Contains("llegó incompleta"));
    }

    [Fact]
    public async Task Una_cuenta_que_nunca_cuadra_deja_de_detener_el_cursor_tras_el_tope_y_va_al_log_como_error()
    {
        _lector.Agregar(FixturesCheques.Cuenta(5, 160, 10m));
        _lector.Agregar(FixturesCheques.Cuenta(6, 161, 10m));
        _lector.Pagos.RemoveAll(p => p.Folio == 6); // nunca cuadra

        for (var i = 1; i < SincronizadorCheques.MaxCiclosIncompleta; i++)
        {
            await Ciclo();
        }

        Assert.Equal(5, _estado.UltimoFolio());
        Assert.Empty(_log.De(LogLevel.Error));

        await Ciclo();
        await Ciclo();

        Assert.Equal(6, _estado.UltimoFolio());
        Assert.Single(_log.De(LogLevel.Error), m => m.Contains("cheques.folio 6 lleva 20 lecturas seguidas incompleta"));
        Assert.DoesNotContain(Encolados(), c => c.GetProperty("folioSr").GetString() == "161");
    }

    [Fact]
    public async Task Si_cheques_folio_vuelve_a_empezar_el_cursor_se_pierde_y_se_relee_con_el_piso()
    {
        _estado.GuardarUltimoFolio(500);
        _lector.MaxFolio = 3;

        await Ciclo();
        await Ciclo();

        Assert.Equal(-1, _estado.UltimoFolio());
        Assert.Equal(-1, _lector.Ventanas[1].UltimoFolio);
        Assert.Contains(_log.De(LogLevel.Warning), m => m.Contains("cheques.folio volvió a empezar"));
    }

    [Fact]
    public async Task Con_un_usuario_que_puede_escribir_no_lee_ventas_y_lo_dice_en_la_sonda_y_una_vez_en_el_log()
    {
        _lector.Permisos = new PermisosLectura(false, "El usuario SQL puede escribir en SoftRestaurant: dbo.cheques: INSERT.");
        _lector.Agregar(FixturesCheques.Cuenta(1, 170, 10m));

        var resultado = await Ciclo();
        await Ciclo();

        Assert.Empty(_lector.Ventanas);
        Assert.False(resultado.Ok);
        Assert.Contains("No se leen las ventas", resultado.Error);
        Assert.Single(_log.De(LogLevel.Error), m => m.Contains("SOLO LECTURA confirmado"));
        Assert.Equal(1, _lector.RevisionesPermisos); // se vuelve a revisar a los 15 min, no cada ciclo
        Assert.Empty(Encolados());
    }

    [Fact]
    public async Task Si_la_revision_de_permisos_misma_falla_no_bloquea_15_min_y_reintenta_al_siguiente_ciclo()
    {
        _lector.Permisos = new PermisosLectura(false, "No se pudieron revisar los permisos del usuario SQL (timeout).", NoSeSupo: true);
        _lector.Agregar(FixturesCheques.Cuenta(1, 175, 10m));

        Assert.False((await Ciclo()).Ok);
        Assert.Empty(_lector.Ventanas);

        _lector.Permisos = new PermisosLectura(true, null);
        Assert.True((await Ciclo()).Ok);

        Assert.Equal(2, _lector.RevisionesPermisos);
        Assert.Single(Encolados());
    }

    [Fact]
    public async Task Una_lectura_que_falla_no_encola_nada_no_mueve_el_cursor_y_se_registra_una_vez()
    {
        _lector.Agregar(FixturesCheques.Cuenta(1, 180, 10m));
        _lector.Falla = () => new TimeoutException("el comando excedió su CommandTimeout (simulado)");

        var resultado = await Ciclo();
        await Ciclo();

        Assert.False(resultado.Ok);
        Assert.Contains("No se pudieron leer las ventas", resultado.Error);
        Assert.Empty(Encolados());
        Assert.Equal(-1, _estado.UltimoFolio());
        Assert.Single(_log.De(LogLevel.Error), m => m.Contains("Cheques: no se pudieron leer"));

        _lector.Falla = null;
        Assert.True((await Ciclo()).Ok);
        Assert.Single(Encolados());
    }

    [Fact]
    public async Task Un_aviso_que_se_repite_cada_ciclo_va_al_log_una_sola_vez()
    {
        _lector.Agregar(FixturesCheques.Cuenta(1, 0, 10m));

        await Ciclo();
        await Ciclo();
        await Ciclo();

        Assert.Single(_log.De(LogLevel.Warning), m => m.Contains("no trae numcheque"));
    }
}

/// <summary>El worker y los cheques (F1-022).</summary>
public partial class WorkerTests
{
    private sealed class ChequesFalsos(EnvioFalso envio, ResultadoSondeo resultado) : ISincronizadorCheques
    {
        private readonly List<int> _enviosAlCorrer = [];

        public IReadOnlyList<int> EnviosAlCorrer
        {
            get { lock (_enviosAlCorrer) { return _enviosAlCorrer.ToList(); } }
        }

        public Task<ResultadoSondeo> CicloAsync(ISoftRestaurantReader reader, ColaLocal cola, CancellationToken cancelacion)
        {
            lock (_enviosAlCorrer)
            {
                _enviosAlCorrer.Add(envio.Ciclos);
            }

            return Task.FromResult(resultado);
        }
    }

    private DependenciasWorker ConCheques(CarpetaTemporal carpeta, EnvioFalso envio, ChequesFalsos cheques) =>
        new(
            carpeta.Rutas,
            _ => new ResultadoConfiguracion(Datos.Config() with { IntervaloSegundos = ConfiguracionAgente.IntervaloMinimo }, [], []),
            _ => [],
            DetectaSr10,
            SondeoOk,
            new EstadoSoftRestaurant(),
            (_, _) => envio,
            TimeProvider.System,
            VersionDePrueba,
            Reintento,
            NoTermina,
            CrearCheques: (_, _) => cheques);

    [Fact]
    public async Task Los_cheques_se_leen_antes_del_heartbeat_y_su_lectura_es_la_ultima_lectura_que_reporta()
    {
        using var carpeta = new CarpetaTemporal();
        var envio = new EnvioFalso();
        var lectura = ResultadoSondeo.Exito(new DateTimeOffset(2026, 9, 21, 12, 5, 0, TimeSpan.Zero), 41);
        var cheques = new ChequesFalsos(envio, lectura);
        var worker = new Worker(new LogEnMemoria(), ConCheques(carpeta, envio, cheques));

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => envio.Heartbeats.Count >= 1);
        await worker.StopAsync(CancellationToken.None);

        Assert.Equal(0, cheques.EnviosAlCorrer[0]); // antes de vaciar la cola del primer ciclo
        var hb = envio.Heartbeats[0];
        Assert.Equal("2026-09-21T12:05:00.000Z", hb.GetProperty("ultimaLecturaAt").GetString());
        Assert.Equal(41, hb.GetProperty("latenciaQueryMs").GetInt32());
    }

    [Fact]
    public async Task Si_no_se_pueden_leer_las_ventas_el_heartbeat_lo_dice_aunque_la_sonda_responda()
    {
        using var carpeta = new CarpetaTemporal();
        var envio = new EnvioFalso();
        var cheques = new ChequesFalsos(envio, ResultadoSondeo.Falla(DateTimeOffset.UtcNow, "No se leen las ventas (sintético)."));
        var worker = new Worker(new LogEnMemoria(), ConCheques(carpeta, envio, cheques));

        await worker.StartAsync(CancellationToken.None);
        await Esperar(() => envio.Heartbeats.Count >= 1);
        await worker.StopAsync(CancellationToken.None);

        Assert.Equal("No se leen las ventas (sintético).", envio.Heartbeats[0].GetProperty("ultimoError").GetString());
    }
}
