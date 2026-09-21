using System.Net;
using System.Security.Authentication;
using ArkonAgente.Diagnostico;

namespace ArkonAgente.Tests;

public class VerificacionApiTests
{
    // Forma exacta de AgenteYoDto (api/src/agentes/dto/agentes.dto.ts).
    private const string CuerpoYo =
        "{\"sucursalId\":\"6f1c2b9e-0000-4000-8000-000000000001\",\"nombre\":\"Centro\",\"zonaHoraria\":\"America/Mexico_City\"}";

    [Fact]
    public async Task Ok_manda_la_key_en_el_header_y_muestra_la_sucursal()
    {
        var handler = HandlerFalso.Con(HttpStatusCode.OK, CuerpoYo);

        var r = await new VerificacionApi(Datos.Config(), handler).VerificarAsync(CancellationToken.None);

        Assert.True(r.Ok, r.Detalle);
        Assert.Contains("Centro", r.Detalle);
        Assert.Contains("America/Mexico_City", r.Detalle);
        Assert.DoesNotContain(Datos.ApiKey, r.Detalle);
        Assert.Equal(HttpMethod.Get, handler.Ultima!.Method);
        Assert.Equal(new Uri("https://monitor.ejemplo.test/agente/yo"), handler.Ultima.RequestUri);
        Assert.Equal(Datos.ApiKey, Assert.Single(handler.Ultima.Headers.GetValues("X-Api-Key")));
    }

    [Theory]
    [InlineData("https://m.test", "https://m.test/agente/yo")]
    [InlineData("https://m.test/", "https://m.test/agente/yo")]
    [InlineData("https://m.test/api", "https://m.test/api/agente/yo")]
    [InlineData("https://m.test/api/", "https://m.test/api/agente/yo")]
    [InlineData("http://localhost:3000", "http://localhost:3000/agente/yo")]
    public void Url_de_yo_respeta_prefijo_y_barra_final(string apiUrl, string esperada)
    {
        Assert.Equal(new Uri(esperada), VerificacionApi.UrlYo(new Uri(apiUrl)));
    }

    [Fact]
    public async Task Key_rechazada_401_no_intenta_adivinar_la_causa()
    {
        var r = await Verificar(HandlerFalso.Con(HttpStatusCode.Unauthorized, "{\"message\":\"Unauthorized\"}"));

        Assert.False(r.Ok);
        Assert.Contains("rechazó la API key (401)", r.Detalle);
        Assert.Contains("rotada", r.Sugerencia);
        Assert.Contains("inactivas", r.Sugerencia);
    }

    [Fact]
    public async Task Ruta_inexistente_404_apunta_a_apiUrl()
    {
        var r = await Verificar(HandlerFalso.Con(HttpStatusCode.NotFound));

        Assert.False(r.Ok);
        Assert.Contains("404", r.Detalle);
        Assert.Contains("'apiUrl'", r.Detalle);
    }

    [Fact]
    public async Task Error_del_servidor_5xx()
    {
        var r = await Verificar(HandlerFalso.Con(HttpStatusCode.BadGateway));

        Assert.False(r.Ok);
        Assert.Contains("502", r.Detalle);
    }

    [Fact]
    public async Task Respuesta_200_que_no_es_del_monitor()
    {
        var r = await Verificar(HandlerFalso.Con(HttpStatusCode.OK, "<html>hola</html>"));

        Assert.False(r.Ok);
        Assert.Contains("no parece ser el API del monitor", r.Detalle);
    }

    [Fact]
    public async Task Sin_red()
    {
        var handler = new HandlerFalso((_, _) =>
            throw new HttpRequestException(HttpRequestError.ConnectionError, "Connection refused"));

        var r = await Verificar(handler);

        Assert.False(r.Ok);
        Assert.Contains("No se pudo conectar", r.Detalle);
    }

    [Fact]
    public async Task Dns_que_no_resuelve()
    {
        var handler = new HandlerFalso((_, _) =>
            throw new HttpRequestException(HttpRequestError.NameResolutionError, "No such host"));

        var r = await Verificar(handler);

        Assert.False(r.Ok);
        Assert.Contains("DNS", r.Detalle);
    }

    [Fact]
    public async Task Falla_de_tls()
    {
        var handler = new HandlerFalso((_, _) =>
            throw new HttpRequestException("ssl", new AuthenticationException("bad cert")));

        var r = await Verificar(handler);

        Assert.False(r.Ok);
        Assert.Contains("TLS", r.Detalle);
    }

    [Fact]
    public async Task Timeout_se_reporta_como_tal_y_no_se_cuelga()
    {
        var handler = new HandlerFalso(async (_, ct) =>
        {
            await Task.Delay(Timeout.Infinite, ct);
            return new HttpResponseMessage(HttpStatusCode.OK);
        });

        var r = await new VerificacionApi(Datos.Config(), handler, TimeSpan.FromMilliseconds(200))
            .VerificarAsync(CancellationToken.None);

        Assert.False(r.Ok);
        Assert.Contains("no respondió en", r.Detalle);
    }

    [Fact]
    public async Task Cancelacion_del_servicio_no_se_disfraza_de_timeout()
    {
        var handler = new HandlerFalso(async (_, ct) =>
        {
            await Task.Delay(Timeout.Infinite, ct);
            return new HttpResponseMessage(HttpStatusCode.OK);
        });
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            new VerificacionApi(Datos.Config(), handler).VerificarAsync(cts.Token));
    }

    private static Task<ResultadoVerificacion> Verificar(HandlerFalso handler) =>
        new VerificacionApi(Datos.Config(), handler).VerificarAsync(CancellationToken.None);
}
