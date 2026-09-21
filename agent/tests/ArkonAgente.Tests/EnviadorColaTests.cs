using System.Net;
using ArkonAgente.Cola;
using Microsoft.Extensions.Logging;
using static ArkonAgente.Tests.ColaLocalTests;

namespace ArkonAgente.Tests;

public class EnviadorColaTests : IDisposable
{
    private static readonly TimeSpan Ciclo = TimeSpan.FromSeconds(30);

    private readonly CarpetaTemporal _carpeta = new();
    private readonly RelojFalso _reloj = new();
    private readonly ApiFalso _api = new();
    private readonly LogSimple _log = new();
    private ColaLocal _cola;
    private EnviadorCola _envio;

    public EnviadorColaTests()
    {
        _cola = ColaLocal.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
        _envio = NuevoEnvio();
    }

    public void Dispose()
    {
        _envio.Dispose();
        _carpeta.Dispose();
    }

    [Fact]
    public async Task Manda_el_lote_en_gzip_con_la_api_key_a_ingesta_eventos()
    {
        var cheque = _cola.Encolar(TipoEvento.Cheque, Cheque("A"));
        var snapshot = _cola.Encolar(TipoEvento.Snapshot, Snapshot);

        await _envio.CicloAsync(CancellationToken.None);

        var peticion = Assert.Single(_api.Peticiones);
        Assert.Equal(new Uri("https://monitor.ejemplo.test/ingesta/eventos"), peticion.Url);
        Assert.Equal(Datos.ApiKey, peticion.ApiKey);
        Assert.Equal(["gzip"], peticion.ContentEncoding);
        Assert.Equal("application/json", peticion.ContentType);
        Assert.Equal([cheque.ToString(), snapshot.ToString()], peticion.Eventos.Select(e => e.Id));
        Assert.Equal(["cheque", "snapshot"], peticion.Eventos.Select(e => e.Tipo));
        Assert.Equal("A", peticion.Eventos[0].Folio);
        Assert.Equal(0, _cola.ContarPendientes());
    }

    [Theory]
    [InlineData("https://x.test", "https://x.test/ingesta/eventos")]
    [InlineData("https://x.test/api", "https://x.test/api/ingesta/eventos")]
    [InlineData("https://x.test/api/", "https://x.test/api/ingesta/eventos")]
    public void La_url_respeta_el_prefijo_de_apiUrl(string apiUrl, string esperada) =>
        Assert.Equal(new Uri(esperada), EnviadorCola.UrlIngesta(new Uri(apiUrl)));

    [Fact]
    public async Task Parte_en_lotes_de_100_en_orden_FIFO()
    {
        var folios = Enumerable.Range(0, 250).Select(i => $"F{i:000}").ToList();
        folios.ForEach(f => _cola.Encolar(TipoEvento.Cheque, Cheque(f)));

        await _envio.CicloAsync(CancellationToken.None);

        Assert.Equal([100, 100, 50], _api.Peticiones.Select(p => p.Eventos.Count));
        Assert.Equal(folios, _api.Guardados.Select(e => e.Folio));
        Assert.Equal(0, _cola.ContarPendientes());
    }

    [Fact]
    public async Task Un_rechazo_no_reintentable_sale_de_la_cola_y_no_se_vuelve_a_mandar()
    {
        _cola.Encolar(TipoEvento.Cheque, Cheque("A"));
        var malo = _cola.Encolar(TipoEvento.Cheque, Cheque("B"));
        _cola.Encolar(TipoEvento.Cheque, Cheque("C"));
        _api.Responder = eventos => ApiFalso.Resultado(
            eventos.Where(e => e.Folio != "B").Select(e => e.Id),
            new { id = malo.ToString(), indice = 1, motivo = "datos.total debe ser un importe", reintentable = false });

        await _envio.CicloAsync(CancellationToken.None);
        _reloj.Avanzar(TimeSpan.FromHours(1));
        await _envio.CicloAsync(CancellationToken.None);

        Assert.Single(_api.Peticiones);
        Assert.Equal(0, _cola.ContarPendientes());
        Assert.Equal(1, ContarFilas(_cola, $"id = {malo} AND rechazado_at IS NOT NULL"));
        Assert.Equal(DateTimeOffset.MinValue, _envio.ProximoIntento);
        Assert.Contains(_log.De(LogLevel.Error), m => m.Contains("datos.total debe ser un importe"));
    }

    [Fact]
    public async Task Un_rechazo_reintentable_se_queda_y_se_reintenta_tras_el_backoff()
    {
        var id = _cola.Encolar(TipoEvento.Cheque, Cheque("A"));
        _api.Responder = _ => ApiFalso.Resultado([], new { id = id.ToString(), indice = 0, motivo = "base caída", reintentable = true });

        await _envio.CicloAsync(CancellationToken.None);
        Assert.Equal(1, _cola.ContarPendientes());
        Assert.Equal(_reloj.Ahora + Ciclo, _envio.ProximoIntento);

        _api.Responder = null;
        await _envio.CicloAsync(CancellationToken.None); // todavía en backoff
        Assert.Single(_api.Peticiones);

        _reloj.Avanzar(Ciclo);
        await _envio.CicloAsync(CancellationToken.None);
        Assert.Equal(2, _api.Peticiones.Count);
        Assert.Equal(0, _cola.ContarPendientes());
        Assert.Equal(1, ContarFilas(_cola, $"id = {id} AND intentos = 1"));
    }

    [Fact]
    public async Task Un_evento_que_no_viene_en_ninguna_lista_sigue_pendiente()
    {
        _cola.Encolar(TipoEvento.Cheque, Cheque("A"));
        _cola.Encolar(TipoEvento.Cheque, Cheque("B"));
        _api.Responder = eventos => ApiFalso.Resultado([eventos[0].Id]);

        await _envio.CicloAsync(CancellationToken.None);

        Assert.Equal(["B"], _cola.TomarPendientes(10).Select(p => FolioDe(p.Payload)));
        Assert.NotEqual(DateTimeOffset.MinValue, _envio.ProximoIntento);
    }

    [Fact]
    public async Task Una_version_vieja_rechazada_como_reintentable_nunca_pisa_a_la_nueva()
    {
        var v1 = _cola.Encolar(TipoEvento.Cheque, Cheque("A", "1"));
        _api.Responder = _ => ApiFalso.Resultado([], new { id = v1.ToString(), indice = 0, motivo = "timeout", reintentable = true });
        await _envio.CicloAsync(CancellationToken.None);

        _api.Responder = null;
        _cola.Encolar(TipoEvento.Cheque, Cheque("A", "2")); // SR reabrió el cheque
        _reloj.Avanzar(Ciclo);
        await _envio.CicloAsync(CancellationToken.None);
        _reloj.Avanzar(TimeSpan.FromHours(1));
        await _envio.CicloAsync(CancellationToken.None);

        var guardado = Assert.Single(_api.Guardados);
        Assert.Equal("2", guardado.Version);
    }

    [Fact]
    public async Task Con_413_parte_el_lote_hasta_que_cabe_sin_perder_ni_desordenar()
    {
        var folios = Enumerable.Range(0, 100).Select(i => $"F{i:000}").ToList();
        folios.ForEach(f => _cola.Encolar(TipoEvento.Cheque, Cheque(f)));
        _api.Responder = eventos => eventos.Count > 25 ? new HttpResponseMessage(HttpStatusCode.RequestEntityTooLarge) : null;

        await _envio.CicloAsync(CancellationToken.None);

        Assert.Equal(folios, _api.Guardados.Select(e => e.Folio));
        Assert.Equal(0, _cola.ContarPendientes());
        Assert.Equal(DateTimeOffset.MinValue, _envio.ProximoIntento);
    }

    [Fact]
    public async Task Un_evento_que_da_413_solo_se_rechaza_y_los_demas_pasan()
    {
        _cola.Encolar(TipoEvento.Cheque, Cheque("A"));
        var gordo = _cola.Encolar(TipoEvento.Cheque, Cheque("GORDO"));
        _cola.Encolar(TipoEvento.Cheque, Cheque("C"));
        _api.Responder = eventos =>
            eventos.Any(e => e.Folio == "GORDO") ? new HttpResponseMessage(HttpStatusCode.RequestEntityTooLarge) : null;

        await _envio.CicloAsync(CancellationToken.None);

        Assert.Equal(["A", "C"], _api.Guardados.Select(e => e.Folio));
        Assert.Equal(0, _cola.ContarPendientes());
        Assert.Equal(1, ContarFilas(_cola, $"id = {gordo} AND rechazado_at IS NOT NULL AND motivo_rechazo LIKE '%413%'"));
    }

    public static TheoryData<string> Fallas => ["500", "503", "401", "429", "400", "404", "200-ilegible", "sin-red"];

    [Theory]
    [MemberData(nameof(Fallas))]
    public async Task Ante_una_falla_no_se_pierde_nada_y_el_backoff_va_de_30_s_a_10_min(string falla)
    {
        _cola.Encolar(TipoEvento.Cheque, Cheque("A"));
        _cola.Encolar(TipoEvento.Snapshot, Snapshot);
        ConfigurarFalla(falla);

        var esperas = new List<double>();
        for (var i = 0; i < 7; i++)
        {
            await _envio.CicloAsync(CancellationToken.None);
            esperas.Add((_envio.ProximoIntento - _reloj.Ahora).TotalSeconds);
            _reloj.Avanzar(_envio.ProximoIntento - _reloj.Ahora);
        }

        Assert.Equal([30, 60, 120, 240, 480, 600, 600], esperas);
        Assert.Equal(7, _api.Intentos);
        Assert.Equal(2, _cola.ContarPendientes());
        Assert.Equal(1, ContarFilas(_cola, "intentos = 7 AND tipo = 'cheque'"));
        Assert.Single(_log.De(LogLevel.Error)); // la misma falla se registra una vez

        _api.Caido = false;
        _api.Responder = null;
        await _envio.CicloAsync(CancellationToken.None);

        Assert.Equal(0, _cola.ContarPendientes());
        Assert.Equal(DateTimeOffset.MinValue, _envio.ProximoIntento);
        Assert.Contains(_log.De(LogLevel.Information), m => m.Contains("se restableció"));
    }

    [Fact]
    public async Task Un_API_que_no_responde_cuenta_como_falla_y_no_como_parada()
    {
        _envio.Dispose();
        var colgado = new HandlerFalso(async (_, ct) =>
        {
            await Task.Delay(Timeout.Infinite, ct);
            return new HttpResponseMessage(HttpStatusCode.OK);
        });
        _envio = new EnviadorCola(_cola, Datos.Config(), _log, _reloj, colgado, TimeSpan.FromMilliseconds(100));
        _cola.Encolar(TipoEvento.Cheque, Cheque("A"));

        await _envio.CicloAsync(CancellationToken.None);

        Assert.Equal(1, _cola.ContarPendientes());
        Assert.Contains(_log.De(LogLevel.Error), m => m.Contains("no respondió"));
    }

    [Fact]
    public async Task Si_el_servicio_se_detiene_a_media_peticion_se_propaga_la_cancelacion()
    {
        _envio.Dispose();
        var colgado = new HandlerFalso(async (_, ct) =>
        {
            await Task.Delay(Timeout.Infinite, ct);
            return new HttpResponseMessage(HttpStatusCode.OK);
        });
        _envio = new EnviadorCola(_cola, Datos.Config(), _log, _reloj, colgado, TimeSpan.FromMinutes(5));
        _cola.Encolar(TipoEvento.Cheque, Cheque("A"));
        using var parada = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => _envio.CicloAsync(parada.Token));
        Assert.Equal(1, _cola.ContarPendientes());
    }

    [Fact]
    public async Task Respuesta_perdida_se_reenvia_y_no_se_pierde_nada_al_menos_una_vez()
    {
        var folios = Enumerable.Range(0, 10).Select(i => $"F{i}").ToList();
        folios.ForEach(f => _cola.Encolar(TipoEvento.Cheque, Cheque(f)));
        _api.PerderRespuesta = true;

        await _envio.CicloAsync(CancellationToken.None);
        Assert.Equal(10, _cola.ContarPendientes()); // sin confirmación no sale nada

        _api.PerderRespuesta = false;
        _reloj.Avanzar(Ciclo);
        await _envio.CicloAsync(CancellationToken.None);

        Assert.Equal(0, _cola.ContarPendientes());
        // Al menos una vez: el API recibió el lote dos veces (su upsert por folio lo
        // deja igual), en el mismo orden las dos.
        Assert.Equal(folios.Concat(folios), _api.Guardados.Select(e => e.Folio));
    }

    [Fact]
    public async Task No_manda_mas_de_20_lotes_por_ciclo()
    {
        for (var i = 0; i < 2_050; i++)
        {
            _cola.Encolar(TipoEvento.Cheque, Cheque($"F{i}"));
        }

        await _envio.CicloAsync(CancellationToken.None);
        Assert.Equal(EnviadorCola.MaxLotesPorCiclo, _api.Peticiones.Count);
        Assert.Equal(50, _cola.ContarPendientes());

        await _envio.CicloAsync(CancellationToken.None);
        Assert.Equal(0, _cola.ContarPendientes());
    }

    [Theory]
    [InlineData(5, 5)]
    [InlineData(10, 10)]
    [InlineData(30, 20)]
    [InlineData(3600, 20)]
    public void Los_lotes_por_ciclo_nunca_pasan_de_60_peticiones_por_minuto(int intervalo, int lotes)
    {
        Assert.Equal(lotes, EnviadorCola.LotesPorCiclo(intervalo));
        Assert.True(lotes * (60.0 / intervalo) <= 60);
    }

    [Fact]
    public async Task Con_intervalo_de_5_s_manda_a_lo_mas_5_lotes_por_ciclo()
    {
        _envio.Dispose();
        _envio = new EnviadorCola(_cola, Datos.Config() with { IntervaloSegundos = 5 }, _log, _reloj, _api);
        for (var i = 0; i < 700; i++)
        {
            _cola.Encolar(TipoEvento.Cheque, Cheque($"F{i}"));
        }

        await _envio.CicloAsync(CancellationToken.None);

        Assert.Equal(5, _api.Peticiones.Count);
        Assert.Equal(200, _cola.ContarPendientes());
    }

    [Fact]
    public async Task Cada_ciclo_purga_lo_enviado_hace_mas_de_7_dias()
    {
        _cola.Encolar(TipoEvento.Cheque, Cheque("A"));
        await _envio.CicloAsync(CancellationToken.None);
        Assert.Equal(1, ContarFilas(_cola, "1 = 1"));

        _reloj.Avanzar(TimeSpan.FromDays(7) + TimeSpan.FromSeconds(1));
        await _envio.CicloAsync(CancellationToken.None);
        Assert.Equal(0, ContarFilas(_cola, "1 = 1"));
    }

    [Fact]
    public async Task El_log_no_trae_la_api_key_ni_el_payload()
    {
        _cola.Encolar(TipoEvento.Cheque, Cheque("FOLIO-SECRETO"));
        foreach (var falla in new[] { "401", "sin-red", "500" })
        {
            ConfigurarFalla(falla);
            await _envio.CicloAsync(CancellationToken.None);
            _reloj.Avanzar(TimeSpan.FromMinutes(10));
        }

        Assert.NotEmpty(_log.Todo);
        Assert.DoesNotContain(Datos.ApiKey, _log.Todo);
        Assert.DoesNotContain("FOLIO-SECRETO", _log.Todo);
    }

    /// <summary>
    /// El AC de F1-024: una hora sin internet (simulada en el cliente HTTP, como pide el
    /// backlog) con ciclos de 30 s que siguen encolando, un reinicio del servicio a la
    /// mitad, y la reconexión. Todos los cheques llegan, en orden, en su última versión;
    /// la cola no crece por snapshots ni heartbeats.
    /// </summary>
    [Fact]
    public async Task AC_una_hora_sin_internet_y_al_reconectar_llegan_todos_los_cheques_en_orden()
    {
        _api.Caido = true;
        var orden = new List<string>(); // el orden esperado: el de la última vez que se encoló cada folio
        var version = new Dictionary<string, int>();

        void EncolarCheque(string folio)
        {
            version[folio] = version.GetValueOrDefault(folio) + 1;
            orden.Remove(folio);
            orden.Add(folio);
            _cola.Encolar(TipoEvento.Cheque, Cheque(folio, version[folio].ToString()));
        }

        for (var i = 0; i < 120; i++) // 120 ciclos de 30 s = 1 hora
        {
            EncolarCheque($"C{i:000}");
            if (i % 4 == 3)
            {
                EncolarCheque($"C{i - 2:000}"); // SR reprocesa un cheque (reapertura)
            }

            if (i == 45)
            {
                for (var j = 0; j < 30; j++)
                {
                    EncolarCheque($"X{j:00}"); // una ráfaga
                }
            }

            _cola.Encolar(TipoEvento.Snapshot, Snapshot);
            _cola.Encolar(TipoEvento.Heartbeat, Heartbeat);

            if (i == 60)
            {
                // Reinicio del servicio a media caída: misma cola.db, proceso nuevo.
                _envio.Dispose();
                _cola = ColaLocal.Abrir(_carpeta.Rutas.ArchivoCola, _reloj);
                _envio = NuevoEnvio();
            }

            await _envio.CicloAsync(CancellationToken.None);

            // Nunca crece por snapshots ni heartbeats: sólo un pendiente de cada uno.
            Assert.Equal(orden.Count + 2, _cola.ContarPendientes());
            _reloj.Avanzar(Ciclo);
        }

        Assert.Equal(150, orden.Count);
        // El backoff acota los intentos: sin él serían 120.
        Assert.InRange(_api.Intentos, 5, 20);
        Assert.Empty(_api.Guardados);

        _api.Caido = false;
        _reloj.Avanzar(EnviadorCola.BackoffMaximo);
        await _envio.CicloAsync(CancellationToken.None);

        Assert.Equal(0, _cola.ContarPendientes());
        var cheques = _api.Guardados.Where(e => e.Tipo == "cheque").ToList();
        Assert.Equal(orden, cheques.Select(e => e.Folio));
        Assert.All(cheques, e => Assert.Equal(version[e.Folio!].ToString(), e.Version));
        Assert.Single(_api.Guardados, e => e.Tipo == "snapshot");
        Assert.Single(_api.Guardados, e => e.Tipo == "heartbeat");
    }

    private EnviadorCola NuevoEnvio() => new(_cola, Datos.Config(), _log, _reloj, _api);

    private void ConfigurarFalla(string falla)
    {
        _api.Caido = falla == "sin-red";
        _api.Responder = falla switch
        {
            "sin-red" => null,
            "200-ilegible" => _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("<html>hola</html>") },
            _ => _ => new HttpResponseMessage((HttpStatusCode)int.Parse(falla)),
        };
    }

    private static string FolioDe(string payload) =>
        System.Text.Json.JsonDocument.Parse(payload).RootElement.GetProperty("folioSr").GetString()!;
}

/// <summary>Logger en memoria (no genérico).</summary>
internal sealed class LogSimple : ILogger
{
    private readonly List<(LogLevel Nivel, string Mensaje)> _entradas = [];

    public string Todo
    {
        get { lock (_entradas) { return string.Join("\n", _entradas.Select(e => e.Mensaje)); } }
    }

    public IReadOnlyList<string> De(LogLevel nivel)
    {
        lock (_entradas)
        {
            return _entradas.Where(e => e.Nivel == nivel).Select(e => e.Mensaje).ToList();
        }
    }

    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
        lock (_entradas)
        {
            _entradas.Add((logLevel, formatter(state, exception)));
        }
    }
}
