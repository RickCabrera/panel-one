using System.Net;
using ArkonAgente.Catalogos;
using ArkonAgente.Cola;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Tests;

public class EnviadorCatalogosTests : IDisposable
{
    private readonly CarpetaTemporal _carpeta = new();
    private readonly RelojFalso _reloj = new();
    private readonly ApiCatalogosFalso _api = new();
    private readonly LogSimple _log = new();
    private readonly ColaCatalogos _cola;
    private readonly EnviadorCatalogos _envio;

    public EnviadorCatalogosTests()
    {
        _cola = ColaCatalogos.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        _envio = new EnviadorCatalogos(_cola, Datos.Config(), _log, _reloj, _api, TimeSpan.FromSeconds(5));
    }

    public void Dispose()
    {
        _envio.Dispose();
        _carpeta.Dispose();
    }

    internal static SincronizacionArmada Grupos(int n, DateTimeOffset? capturado = null)
    {
        var tabla = FixturesSr.Grupos(Enumerable.Range(0, n).Select(i => ((string?)$"G{i:0000}", (string?)$"Grupo {i}")).ToArray());
        var leido = MapeoCatalogos.Mapear(CatalogoPanel.Grupos, tabla.CreateDataReader());
        return SincronizadorCatalogos.Armar(
            leido, capturado ?? new DateTimeOffset(2026, 9, 21, 12, 0, 0, TimeSpan.Zero), MapeoCatalogos.Hash(leido.Registros));
    }

    private async Task Vaciar(int ciclos = 10)
    {
        for (var i = 0; i < ciclos; i++)
        {
            await _envio.CicloAsync(CancellationToken.None);
        }
    }

    [Fact]
    public async Task Manda_paginas_de_500_y_luego_el_cierre_en_gzip_con_la_api_key()
    {
        var sinc = Grupos(1200);
        _cola.EncolarSincronizacion(sinc);

        await Vaciar();

        var envios = _api.Envios;
        Assert.Equal(4, envios.Count);
        Assert.All(envios, p =>
        {
            Assert.Equal(Datos.ApiKey, p.ApiKey);
            Assert.Equal(["gzip"], p.ContentEncoding);
            Assert.Equal("grupos", p.Catalogo);
            Assert.Equal(sinc.SincronizacionId, p.Cuerpo!.Value.GetProperty("sincronizacionId").GetString());
            Assert.Equal("2026-09-21T12:00:00.000Z", p.Cuerpo!.Value.GetProperty("capturadoAt").GetString());
        });
        Assert.Equal("/ingesta/catalogos", envios[0].Ruta);
        Assert.Equal([500, 500, 200], envios.Take(3).Select(p => p.Cuerpo!.Value.GetProperty("registros").GetArrayLength()));
        Assert.Equal("/ingesta/catalogos/cierre", envios[3].Ruta);
        Assert.Equal(1200, envios[3].Cuerpo!.Value.GetProperty("total").GetInt32());
        Assert.Equal(0, envios[3].Cuerpo!.Value.GetProperty("rechazados").GetInt32());
        Assert.Equal(0, _cola.ContarPendientes());
        Assert.Contains(_log.De(LogLevel.Information), m => m.Contains("'grupos' sincronizado en el panel: 1200 activos"));
    }

    [Fact]
    public async Task El_cierre_lleva_la_suma_de_rechazadosSinFila_de_sus_paginas_y_el_log_no_repite_valores()
    {
        _cola.EncolarSincronizacion(Grupos(700));
        var paginas = 0;
        _api.Responder = p => p.EsPagina
            ? ApiCatalogosFalso.Pagina(1, rechazadosSinFila: ++paginas == 1 ? 2 : 1, obsoletos: 0,
                new { indice = 3, origenSrId = "G0003", motivo = "registros.3.nombre: muy largo", reintentable = false })
            : null;

        await Vaciar();

        var cierre = _api.Envios.Single(p => p.EsCierre);
        Assert.Equal(3, cierre.Cuerpo!.Value.GetProperty("rechazados").GetInt32());
        Assert.Contains(_log.De(LogLevel.Warning), m => m.Contains("G0003") && m.Contains("registros.3.nombre: muy largo"));
        Assert.DoesNotContain(_log.Todo, "Grupo 3"); // nunca el contenido del registro
    }

    [Fact]
    public async Task Obsoletos_y_cierre_no_aplicado_van_como_warning()
    {
        _cola.EncolarSincronizacion(Grupos(1));
        _api.Responder = p => p.EsPagina ? ApiCatalogosFalso.Pagina(1, obsoletos: 1) : ApiCatalogosFalso.Cierre(aplicado: false);

        await Vaciar();

        Assert.Contains(_log.De(LogLevel.Warning), m => m.Contains("reloj de esta PC"));
        Assert.Contains(_log.De(LogLevel.Warning), m => m.Contains("ignoró el cierre"));
        Assert.Equal(0, _cola.ContarPendientes());
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    [InlineData(HttpStatusCode.BadGateway)]
    public async Task Fallas_transitorias_no_sacan_nada_de_la_cola_y_aplican_backoff(HttpStatusCode codigo)
    {
        _cola.EncolarSincronizacion(Grupos(1));
        _api.Responder = _ => ApiCatalogosFalso.Json(codigo, new { message = "x" });

        await _envio.CicloAsync(CancellationToken.None);
        await _envio.CicloAsync(CancellationToken.None); // en backoff: no pide

        Assert.Single(_api.Envios);
        Assert.Equal(2, _cola.ContarPendientes());
        Assert.Equal(_reloj.Ahora + EnviadorCatalogos.BackoffInicial, _envio.ProximoIntento);
        Assert.NotNull(_cola.Hash(CatalogoPanel.Grupos));

        _api.Responder = null;
        _reloj.Avanzar(EnviadorCatalogos.BackoffInicial);
        await Vaciar();
        Assert.Equal(0, _cola.ContarPendientes());
        Assert.Equal(DateTimeOffset.MinValue, _envio.ProximoIntento);
    }

    [Fact]
    public async Task Red_caida_no_saca_nada_de_la_cola()
    {
        _cola.EncolarSincronizacion(Grupos(1));
        _api.Caido = true;

        await _envio.CicloAsync(CancellationToken.None);

        Assert.Equal(2, _cola.ContarPendientes());
        Assert.Single(_log.De(LogLevel.Error));
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest, false)]
    [InlineData(HttpStatusCode.RequestEntityTooLarge, false)]
    [InlineData(HttpStatusCode.InternalServerError, false)]
    [InlineData(HttpStatusCode.Conflict, true)]
    public async Task Un_rechazo_definitivo_abandona_la_sincronizacion_borra_el_hash_y_programa_el_reintento(
        HttpStatusCode codigo, bool enElCierre)
    {
        var sinc = Grupos(600);
        _cola.EncolarSincronizacion(sinc);
        _api.Responder = p => p.EsCierre == enElCierre ? ApiCatalogosFalso.Json(codigo, new { message = "x" }) : null;

        await Vaciar();

        Assert.Equal(0, _cola.ContarPendientes());
        Assert.False(_cola.HayPendiente(CatalogoPanel.Grupos));
        Assert.Null(_cola.Hash(CatalogoPanel.Grupos));
        Assert.Equal(_reloj.Ahora + EnviadorCatalogos.EsperaTrasAbandono, _cola.ReintentarDesde(CatalogoPanel.Grupos));
        Assert.Equal(enElCierre ? 3 : 1, _api.Envios.Count); // al abandonar no se manda nada más de ella
        Assert.Contains(_log.De(LogLevel.Error), m => m.Contains(((int)codigo).ToString()) && m.Contains("15 min"));
        Assert.Equal(DateTimeOffset.MinValue, _envio.ProximoIntento); // no bloquea el carril
    }

    [Fact]
    public async Task Un_2xx_ilegible_tambien_abandona()
    {
        _cola.EncolarSincronizacion(Grupos(1));
        _api.Responder = _ => ApiCatalogosFalso.Json(HttpStatusCode.OK, new { hola = 1 });

        await Vaciar();

        Assert.Equal(0, _cola.ContarPendientes());
        Assert.Null(_cola.Hash(CatalogoPanel.Grupos));
    }

    [Fact]
    public async Task Respeta_el_tope_de_peticiones_por_ciclo()
    {
        _cola.EncolarSincronizacion(Grupos(4000)); // 8 páginas + cierre

        await _envio.CicloAsync(CancellationToken.None);

        Assert.Equal(EnviadorCatalogos.PeticionesPorCiclo(30), _api.Envios.Count);
        Assert.Equal(5, EnviadorCatalogos.PeticionesPorCiclo(30));
        Assert.Equal(1, EnviadorCatalogos.PeticionesPorCiclo(5));
        Assert.Equal(5, EnviadorCatalogos.PeticionesPorCiclo(3600));
    }

    [Fact]
    public async Task Consulta_la_solicitud_con_la_api_key()
    {
        _api.Solicitud = ("2026-09-21T11:00:00.000Z", true);

        var s = await _envio.ConsultarSolicitudAsync(CancellationToken.None);

        Assert.Equal(new SolicitudCatalogos("2026-09-21T11:00:00.000Z", true), s);
        var p = Assert.Single(_api.Peticiones);
        Assert.Equal("/ingesta/catalogos/solicitud", p.Ruta);
        Assert.Equal(Datos.ApiKey, p.ApiKey);

        _api.Responder = _ => ApiCatalogosFalso.Json(HttpStatusCode.ServiceUnavailable, new { });
        Assert.Null(await _envio.ConsultarSolicitudAsync(CancellationToken.None));
        _api.Caido = true;
        Assert.Null(await _envio.ConsultarSolicitudAsync(CancellationToken.None));
    }
}

public class ColaCatalogosTests
{
    [Fact]
    public void Un_cola_db_de_antes_se_abre_sin_perder_eventos_ni_tocar_su_version()
    {
        using var carpeta = new CarpetaTemporal();
        var reloj = new RelojFalso();
        var eventos = ColaLocal.Abrir(carpeta.Rutas.ArchivoCola, reloj);
        eventos.Encolar(TipoEvento.Cheque, ColaLocalTests.Cheque("A"));

        var catalogos = ColaCatalogos.Abrir(carpeta.Rutas.ArchivoCola, reloj);
        catalogos.EncolarSincronizacion(EnviadorCatalogosTests.Grupos(2));
        var reabierta = ColaLocal.Abrir(carpeta.Rutas.ArchivoCola, reloj);

        Assert.Equal(1, reabierta.ContarPendientes());
        Assert.Equal(2, catalogos.ContarPendientes());
        using var conexion = new SqliteConnection($"Data Source={carpeta.Rutas.ArchivoCola};Pooling=False");
        conexion.Open();
        using var comando = conexion.CreateCommand();
        comando.CommandText = "PRAGMA user_version;";
        Assert.Equal(1L, comando.ExecuteScalar());
    }

    [Fact]
    public void Encolar_una_sincronizacion_guarda_paginas_cierre_y_hash_juntos_y_quita_el_reintento()
    {
        using var carpeta = new CarpetaTemporal();
        var reloj = new RelojFalso();
        var cola = ColaCatalogos.Abrir(carpeta.Rutas.ArchivoCola, reloj);
        cola.ProgramarReintento(CatalogoPanel.Grupos, reloj.Ahora);
        var sinc = EnviadorCatalogosTests.Grupos(1001);

        cola.EncolarSincronizacion(sinc);

        Assert.Equal(4, cola.ContarPendientes()); // 3 páginas + cierre
        Assert.True(cola.HayPendiente(CatalogoPanel.Grupos));
        Assert.False(cola.HayPendiente(CatalogoPanel.Productos));
        Assert.Equal(sinc.Hash, cola.Hash(CatalogoPanel.Grupos));
        Assert.Null(cola.ReintentarDesde(CatalogoPanel.Grupos));
        var primero = cola.TomarSiguiente()!;
        Assert.False(primero.EsCierre);
        Assert.Equal(sinc.SincronizacionId, primero.SincronizacionId);
    }

    [Fact]
    public void Si_falla_a_la_mitad_no_queda_media_sincronizacion()
    {
        using var carpeta = new CarpetaTemporal();
        var cola = ColaCatalogos.Abrir(carpeta.Rutas.ArchivoCola, new RelojFalso());
        var sinc = EnviadorCatalogosTests.Grupos(2) with { Cierre = null! }; // el INSERT del cierre truena

        Assert.ThrowsAny<Exception>(() => cola.EncolarSincronizacion(sinc));

        Assert.Equal(0, cola.ContarPendientes());
        Assert.Null(cola.Hash(CatalogoPanel.Grupos));
    }

    [Fact]
    public void La_purga_borra_lo_viejo_enviado_y_nunca_un_pendiente()
    {
        using var carpeta = new CarpetaTemporal();
        var reloj = new RelojFalso();
        var cola = ColaCatalogos.Abrir(carpeta.Rutas.ArchivoCola, reloj);
        cola.EncolarSincronizacion(EnviadorCatalogosTests.Grupos(1));
        cola.MarcarEnviado(cola.TomarSiguiente()!.Id);

        reloj.Avanzar(TimeSpan.FromDays(8));

        Assert.Equal(1, cola.Purgar());
        Assert.Equal(1, cola.ContarPendientes()); // el cierre sigue
    }

    [Fact]
    public void Las_marcas_sobreviven_a_reabrir()
    {
        using var carpeta = new CarpetaTemporal();
        var reloj = new RelojFalso();
        ColaCatalogos.Abrir(carpeta.Rutas.ArchivoCola, reloj).GuardarMarca("x", "1");
        var cola = ColaCatalogos.Abrir(carpeta.Rutas.ArchivoCola, reloj);
        cola.GuardarMarca("x", "2");

        Assert.Equal("2", cola.Marca("x"));
        Assert.Null(cola.Marca("y"));
    }
}
