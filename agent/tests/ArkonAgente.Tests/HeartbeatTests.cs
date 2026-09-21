using System.Text.Json;
using System.Text.RegularExpressions;
using ArkonAgente.Cola;
using ArkonAgente.Configuracion;
using ArkonAgente.Salud;
using ArkonAgente.SoftRestaurant;
using ArkonAgente.Sql;
using static ArkonAgente.Tests.ColaLocalTests;

namespace ArkonAgente.Tests;

/// <summary>El armado del heartbeat (F1-025): puro, sin reloj, red ni SQL Server.</summary>
public partial class ArmadorHeartbeatTests
{
    private static readonly DateTimeOffset Ahora = new(2026, 9, 21, 12, 0, 0, TimeSpan.Zero);

    /// <summary>El mismo regex que <c>ISO_CON_ZONA</c> de api/src/ingesta/normalizar.ts.</summary>
    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})$")]
    private static partial Regex IsoConZona();

    private static EntradaHeartbeat Sano() => new(
        "1.0.0+abcdef0", "10.021800", null, Ahora.AddSeconds(-3), 12, 0, EstadoEnvio.Sano, ResumenRechazos.Ninguno, Ahora);

    private static JsonElement Armar(EntradaHeartbeat e) => JsonDocument.Parse(ArmadorHeartbeat.ArmarJson(e)).RootElement;

    [Fact]
    public void Version_soportada_y_todo_sano_manda_la_version_y_ningun_error()
    {
        var hb = Armar(Sano());

        Assert.Equal("1.0.0+abcdef0", hb.GetProperty("versionAgente").GetString());
        Assert.Equal("10.021800", hb.GetProperty("versionSr").GetString());
        Assert.Equal(JsonValueKind.Null, hb.GetProperty("ultimoError").ValueKind);
        Assert.Equal("2026-09-21T11:59:57.000Z", hb.GetProperty("ultimaLecturaAt").GetString());
        Assert.Equal(12, hb.GetProperty("latenciaQueryMs").GetInt32());
        Assert.Equal(0, hb.GetProperty("tamanoCola").GetInt32());
    }

    [Fact]
    public void La_fecha_la_acepta_el_regex_del_API_y_va_en_UTC()
    {
        var local = new DateTimeOffset(2026, 9, 21, 6, 0, 0, 123, TimeSpan.FromHours(-6));
        var texto = ArmadorHeartbeat.Fecha(local);

        Assert.Equal("2026-09-21T12:00:00.123Z", texto);
        Assert.Matches(IsoConZona(), texto);
    }

    [Fact]
    public void Version_no_soportada_manda_la_version_leida_y_el_error()
    {
        var e = Sano() with
        {
            VersionSr = "12.000000", ErrorSr = "SoftRestaurant versión 12.000000 no soportada.",
            UltimaLecturaAt = null, LatenciaQueryMs = null,
        };
        var hb = Armar(e);

        Assert.Equal("12.000000", hb.GetProperty("versionSr").GetString());
        Assert.Equal("SoftRestaurant versión 12.000000 no soportada.", hb.GetProperty("ultimoError").GetString());
        Assert.Equal(JsonValueKind.Null, hb.GetProperty("ultimaLecturaAt").ValueKind);
        Assert.Equal(JsonValueKind.Null, hb.GetProperty("latenciaQueryMs").ValueKind);
    }

    [Fact]
    public void Sin_conexion_manda_versionSr_null_y_el_error()
    {
        var hb = Armar(Sano() with { VersionSr = null, ErrorSr = "No se pudo detectar la versión.", UltimaLecturaAt = null });

        Assert.Equal(JsonValueKind.Null, hb.GetProperty("versionSr").ValueKind);
        Assert.Equal("No se pudo detectar la versión.", hb.GetProperty("ultimoError").GetString());
    }

    [Fact]
    public void Los_rechazos_definitivos_llegan_al_panel_con_folio_y_motivo()
    {
        var rechazo = new RechazoGuardado(TipoEvento.Cheque, "F-77", "datos.total debe ser un importe", Ahora.AddHours(-2));
        var error = ArmadorHeartbeat.UltimoError(Sano() with { Rechazos = new ResumenRechazos(3, 2, rechazo) });

        Assert.Equal(
            "El API rechazó 3 evento(s) en los últimos 7 días (2 cheque(s): son ventas que FALTAN en el panel). " +
            "Último: cheque folio F-77, 2026-09-21T10:00:00.000Z: datos.total debe ser un importe",
            error);
    }

    [Fact]
    public void Un_rechazo_que_no_es_cheque_lo_dice()
    {
        var rechazo = new RechazoGuardado(TipoEvento.Snapshot, null, "no cabe (413)", Ahora);
        var error = ArmadorHeartbeat.UltimoError(Sano() with { Rechazos = new ResumenRechazos(1, 0, rechazo) });

        Assert.Contains("(ningún cheque)", error);
        Assert.Contains("Último: snapshot,", error);
    }

    [Fact]
    public void La_falla_de_envio_vigente_dice_desde_cuando_y_cuantos_intentos()
    {
        var envio = new EstadoEnvio("El API tiene un problema de su lado (503).", Ahora.AddMinutes(-5), 4, null);
        var error = ArmadorHeartbeat.UltimoError(Sano() with { Envio = envio });

        Assert.Equal(
            "El envío al API falla desde 2026-09-21T11:55:00.000Z (4 intento(s)): El API tiene un problema de su lado (503).",
            error);
    }

    [Fact]
    public void La_caida_ya_resuelta_se_reporta_durante_una_hora_y_despues_ya_no()
    {
        var incidente = new IncidenteEnvio("No se pudo conectar con el API (ConnectionError).", Ahora.AddHours(-2), Ahora.AddMinutes(-59));
        var reciente = Sano() with { Envio = EstadoEnvio.Sano with { UltimoIncidente = incidente } };

        Assert.Equal(
            "El envío al API falló de 2026-09-21T10:00:00.000Z a 2026-09-21T11:01:00.000Z: " +
            "No se pudo conectar con el API (ConnectionError).",
            ArmadorHeartbeat.UltimoError(reciente));
        Assert.Null(ArmadorHeartbeat.UltimoError(reciente with { Ahora = Ahora.AddMinutes(1) }));
    }

    [Fact]
    public void La_falla_vigente_gana_sobre_el_incidente_viejo()
    {
        var envio = new EstadoEnvio("401", Ahora, 1, new IncidenteEnvio("viejo", Ahora.AddHours(-1), Ahora.AddMinutes(-1)));
        var error = ArmadorHeartbeat.UltimoError(Sano() with { Envio = envio });

        Assert.Contains("falla desde", error);
        Assert.DoesNotContain("viejo", error);
    }

    [Fact]
    public void Las_tres_partes_van_en_orden_rechazos_envio_SR()
    {
        var e = Sano() with
        {
            ErrorSr = "SR-ERR",
            Envio = new EstadoEnvio("ENVIO-ERR", Ahora, 1, null),
            Rechazos = new ResumenRechazos(1, 1, new RechazoGuardado(TipoEvento.Cheque, "A", "RECH-ERR", Ahora)),
        };
        var error = ArmadorHeartbeat.UltimoError(e)!;

        var partes = error.Split(ArmadorHeartbeat.Separador);
        Assert.Equal(3, partes.Length);
        Assert.EndsWith("RECH-ERR", partes[0]);
        Assert.EndsWith("ENVIO-ERR", partes[1]);
        Assert.Equal("SR-ERR", partes[2]);
    }

    [Fact]
    public void Con_las_tres_partes_enormes_caben_en_2000_y_ninguna_se_pierde()
    {
        var largo = new string('x', 5000);
        var e = Sano() with
        {
            ErrorSr = "SR:" + largo,
            Envio = new EstadoEnvio("ENVIO:" + largo, Ahora, 1, null),
            Rechazos = new ResumenRechazos(1, 1, new RechazoGuardado(TipoEvento.Cheque, "A", "RECH:" + largo, Ahora)),
        };
        var error = ArmadorHeartbeat.UltimoError(e)!;

        Assert.True(error.Length <= ArmadorHeartbeat.LargoMaximoError, $"mide {error.Length}");
        Assert.Contains("RECH:", error);
        Assert.Contains("ENVIO:", error);
        Assert.Contains("SR:", error);
        Assert.Equal(3, error.Split(ArmadorHeartbeat.Separador).Length);
        Assert.All(error.Split(ArmadorHeartbeat.Separador), p => Assert.True(p.Length <= ArmadorHeartbeat.LargoMaximoParte));
    }

    [Fact]
    public void El_recorte_no_parte_un_emoji_y_el_json_sigue_siendo_valido()
    {
        var texto = new string('a', ArmadorHeartbeat.LargoMaximoParte - 2) + "😀😀😀";
        var hb = Armar(Sano() with { ErrorSr = texto });

        var error = hb.GetProperty("ultimoError").GetString()!;
        Assert.EndsWith("…", error);
        Assert.False(char.IsHighSurrogate(error[^2]));
    }

    [Fact]
    public void Una_version_de_SR_larguisima_se_acota_a_50()
    {
        var hb = Armar(Sano() with { VersionSr = new string('9', 80) });

        Assert.Equal(ArmadorHeartbeat.LargoMaximoVersion, hb.GetProperty("versionSr").GetString()!.Length);
    }

    [Theory]
    [InlineData("1.0.0+c0908e618c18f43d480d7045b1308ed7971a2b3c", "1.0.0+c0908e6")]
    [InlineData("1.0.0", "1.0.0")]
    [InlineData("1.0.0+abc", "1.0.0+abc")]
    [InlineData(null, "desconocida")]
    public void La_version_del_agente_recorta_el_hash(string? informacional, string esperada) =>
        Assert.Equal(esperada, ArmadorHeartbeat.VersionAgente(informacional));

    [Fact]
    public void La_version_real_del_ensamblado_cabe_en_el_DTO()
    {
        var version = ArmadorHeartbeat.VersionAgente();

        Assert.InRange(version.Length, 1, ArmadorHeartbeat.LargoMaximoVersion);
        Assert.NotEqual("desconocida", version);
    }
}

public class ColaLocalHeartbeatTests : IDisposable
{
    private readonly CarpetaTemporal _carpeta = new();
    private readonly RelojFalso _reloj = new();
    private readonly ColaLocal _cola;

    public ColaLocalHeartbeatTests() => _cola = ColaLocal.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);

    public void Dispose() => _carpeta.Dispose();

    [Fact]
    public void El_tamano_de_cola_no_cuenta_el_heartbeat()
    {
        _cola.Encolar(TipoEvento.Heartbeat, Heartbeat);
        Assert.Equal(0, _cola.ContarPendientesSinHeartbeat());

        _cola.Encolar(TipoEvento.Cheque, Cheque("A"));
        _cola.Encolar(TipoEvento.Snapshot, Snapshot);
        Assert.Equal(2, _cola.ContarPendientesSinHeartbeat());
        Assert.Equal(3, _cola.ContarPendientes());
    }

    [Fact]
    public void Sin_rechazos_el_resumen_es_ninguno()
    {
        _cola.Encolar(TipoEvento.Cheque, Cheque("A"));

        Assert.Equal(ResumenRechazos.Ninguno, _cola.ResumenRechazados());
    }

    [Fact]
    public void El_resumen_cuenta_rechazos_y_cheques_y_trae_el_mas_reciente()
    {
        var a = _cola.Encolar(TipoEvento.Cheque, Cheque("A"));
        var s = _cola.Encolar(TipoEvento.Snapshot, Snapshot);
        var b = _cola.Encolar(TipoEvento.Cheque, Cheque("B"));
        _cola.MarcarRechazados([(a, "motivo A")]);
        _reloj.Avanzar(TimeSpan.FromMinutes(1));
        _cola.MarcarRechazados([(s, "motivo S")]);
        _reloj.Avanzar(TimeSpan.FromMinutes(1));
        _cola.MarcarRechazados([(b, "motivo B")]);

        var resumen = _cola.ResumenRechazados();

        Assert.Equal(3, resumen.Total);
        Assert.Equal(2, resumen.Cheques);
        Assert.Equal(new RechazoGuardado(TipoEvento.Cheque, "B", "motivo B", _reloj.Ahora), resumen.Ultimo);
    }

    [Fact]
    public void A_los_7_dias_la_purga_se_lleva_el_rechazo_y_el_resumen_queda_limpio()
    {
        var a = _cola.Encolar(TipoEvento.Cheque, Cheque("A"));
        _cola.MarcarRechazados([(a, "motivo")]);

        _reloj.Avanzar(ColaLocal.Retencion - TimeSpan.FromSeconds(1));
        _cola.Purgar();
        Assert.Equal(1, _cola.ResumenRechazados().Total);

        _reloj.Avanzar(TimeSpan.FromSeconds(2));
        _cola.Purgar();
        Assert.Equal(ResumenRechazos.Ninguno, _cola.ResumenRechazados());
    }
}

public class EstadoEnvioTests : IDisposable
{
    private static readonly TimeSpan Ciclo = TimeSpan.FromSeconds(30);

    private readonly CarpetaTemporal _carpeta = new();
    private readonly RelojFalso _reloj = new();
    private readonly ApiFalso _api = new();
    private readonly ColaLocal _cola;
    private readonly EnviadorCola _envio;

    public EstadoEnvioTests()
    {
        _cola = ColaLocal.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        _envio = new EnviadorCola(_cola, Datos.Config(), new LogSimple(), _reloj, _api);
    }

    public void Dispose()
    {
        _envio.Dispose();
        _carpeta.Dispose();
    }

    [Fact]
    public async Task Sano_al_empezar_y_tras_un_envio_bueno()
    {
        Assert.Equal(EstadoEnvio.Sano, _envio.Estado);

        _cola.Encolar(TipoEvento.Heartbeat, Heartbeat);
        await _envio.CicloAsync(CancellationToken.None);

        Assert.Equal(EstadoEnvio.Sano, _envio.Estado);
    }

    [Fact]
    public async Task La_falla_vigente_guarda_la_hora_de_la_PRIMERA_falla_y_cuenta_las_seguidas()
    {
        var inicio = _reloj.Ahora;
        _api.Caido = true;
        _cola.Encolar(TipoEvento.Heartbeat, Heartbeat);

        for (var i = 0; i < 4; i++)
        {
            await _envio.CicloAsync(CancellationToken.None);
            _reloj.Avanzar(TimeSpan.FromMinutes(10)); // más que cualquier backoff: cada ciclo intenta
        }

        var estado = _envio.Estado;
        Assert.Equal("No se pudo conectar con el API (ConnectionError).", estado.FallaVigente);
        Assert.Equal(inicio, estado.Desde);
        Assert.Equal(4, estado.FallasSeguidas);
        Assert.Null(estado.UltimoIncidente);
    }

    [Fact]
    public async Task Al_reconectar_la_racha_queda_como_incidente_cerrado_con_desde_y_hasta()
    {
        var inicio = _reloj.Ahora;
        _api.Caido = true;
        _cola.Encolar(TipoEvento.Heartbeat, Heartbeat);
        await _envio.CicloAsync(CancellationToken.None);
        _reloj.Avanzar(TimeSpan.FromMinutes(20));
        await _envio.CicloAsync(CancellationToken.None);

        _api.Caido = false;
        _reloj.Avanzar(TimeSpan.FromMinutes(20));
        var reconexion = _reloj.Ahora;
        await _envio.CicloAsync(CancellationToken.None);

        var estado = _envio.Estado;
        Assert.Null(estado.FallaVigente);
        Assert.Null(estado.Desde);
        Assert.Equal(0, estado.FallasSeguidas);
        Assert.Equal(new IncidenteEnvio("No se pudo conectar con el API (ConnectionError).", inicio, reconexion), estado.UltimoIncidente);
        Assert.Equal(0, _cola.ContarPendientes());
    }

    [Fact]
    public async Task Un_evento_siempre_reintentable_se_ve_como_falla_vigente()
    {
        _api.Responder = eventos => ApiFalso.Resultado(
            [], new { id = eventos[0].Id, indice = 0, motivo = "P2034 conflicto", reintentable = true });
        _cola.Encolar(TipoEvento.Cheque, Cheque("A"));

        await _envio.CicloAsync(CancellationToken.None);
        _reloj.Avanzar(Ciclo);

        Assert.Contains("P2034 conflicto", _envio.Estado.FallaVigente);
    }
}

public class SondeoSrTests
{
    [Fact]
    public async Task Un_servidor_que_no_existe_da_falla_sin_secretos_y_no_lanza()
    {
        // Puerto 1 de la propia máquina: nadie escucha, SqlClient falla rápido.
        var cadena = "Server=tcp:127.0.0.1,1;Database=softrestaurant;User ID=lector;Password=" + Datos.Password +
                     ";Connect Timeout=2;TrustServerCertificate=True";
        var reloj = new RelojFalso();
        var sondeo = new SondeoSr(new ConexionSoftRestaurant(cadena), reloj);

        var r = await sondeo.SondearAsync(CancellationToken.None);

        Assert.False(r.Ok);
        Assert.Null(r.LatenciaMs);
        Assert.Equal(reloj.Ahora, r.Instante);
        Assert.StartsWith("SoftRestaurant no respondió a la consulta del ciclo.", r.Error);
        Assert.DoesNotContain(Datos.Password, r.Error);
    }

    [Fact]
    public async Task La_parada_del_servicio_sale_como_cancelacion_no_como_falla()
    {
        var cadena = "Server=tcp:127.0.0.1,1;Database=softrestaurant;Integrated Security=True;Connect Timeout=2";
        var sondeo = new SondeoSr(new ConexionSoftRestaurant(cadena), new RelojFalso());
        using var parada = new CancellationTokenSource();
        parada.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => sondeo.SondearAsync(parada.Token));
    }

    [Fact]
    public void El_estado_no_retrocede_la_ultima_lectura_cuando_la_sonda_falla()
    {
        var estado = new EstadoSoftRestaurant();
        var t0 = new DateTimeOffset(2026, 9, 21, 12, 0, 0, TimeSpan.Zero);

        estado.RegistrarSondeo(ResultadoSondeo.Exito(t0, 15));
        Assert.Equal(t0, estado.UltimaLecturaAt);
        Assert.Equal(15, estado.LatenciaQueryMs);
        Assert.Null(estado.ErrorLectura);

        estado.RegistrarSondeo(ResultadoSondeo.Falla(t0.AddSeconds(30), "no responde"));
        Assert.Equal(t0, estado.UltimaLecturaAt);
        Assert.Null(estado.LatenciaQueryMs);
        Assert.Equal("no responde", estado.ErrorLectura);

        estado.RegistrarSondeo(ResultadoSondeo.Exito(t0.AddSeconds(60), 9));
        Assert.Equal(t0.AddSeconds(60), estado.UltimaLecturaAt);
        Assert.Null(estado.ErrorLectura);
    }

    [Fact]
    public void Un_error_enorme_de_la_sonda_se_acota_a_lo_que_acepta_el_DTO()
    {
        var r = ResultadoSondeo.Falla(DateTimeOffset.UnixEpoch, new string('x', 5000));

        Assert.Equal(ResultadoDeteccion.LargoMaximoError, r.Error!.Length);
    }
}

public class AvisoIntervaloTests
{
    [Theory]
    [InlineData("30", false)]
    [InlineData("5", false)]
    [InlineData("31", true)]
    [InlineData("60", true)]
    public void Un_intervalo_mayor_a_30_avisa_que_el_panel_lo_vera_desconectado(string intervalo, bool avisa)
    {
        var r = CargadorConfiguracion.Interpretar(Datos.Json(intervalo: intervalo), "config.json");

        Assert.True(r.Ok);
        Assert.Equal(avisa, r.Avisos.Any(a => a.Contains("desconectada en falso")));
    }
}
