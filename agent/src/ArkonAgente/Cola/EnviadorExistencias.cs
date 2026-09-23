using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ArkonAgente.Configuracion;
using ArkonAgente.Diagnostico;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Cola;

/// <summary>
/// Vacía el carril de existencias (<see cref="ColaExistencias"/>) hacia el contrato de F2-121:
/// <c>POST {apiUrl}/ingesta/existencias</c>, una foto de un almacén por petición, en gzip y con
/// <c>X-Api-Key</c>.
/// </summary>
/// <remarks>
/// <para>
/// Backoff PROPIO (30 s que se duplica hasta 10 min, como <see cref="EnviadorCola"/> y
/// <see cref="EnviadorCatalogos"/>): una falla aquí no frena otro carril, ni al revés. Tope de
/// <see cref="EnviadorCatalogos.PeticionesPorCiclo"/> por ciclo, el mismo presupuesto que catálogos.
/// </para>
/// <para>
/// Qué pasa con cada respuesta:
/// <list type="bullet">
/// <item>200: la foto sale de la cola. Cada rechazo va al log con su índice, su insumo y el motivo
/// del API (que nunca repite valores); <c>aplicado=false</c> (había una foto más nueva) va como Warning.</item>
/// <item>Red caída, timeout, 401, 429 y 5xx salvo 500: la foto se queda; backoff.</item>
/// <item>400, 413, 500, cualquier otro código o un 2xx ilegible: reenviar lo mismo va a fallar
/// igual, así que la foto se DESCARTA con un Error en el log. No hace falta más: una foto es estado,
/// y la siguiente lectura (a lo más en 30 min) manda otra completa. Nada se queda atorado.</item>
/// </list>
/// </para>
/// </remarks>
internal sealed class EnviadorExistencias : IDisposable
{
    /// <summary>Cuántos rechazos de una foto se escriben en el log (el resto, sólo la cuenta).</summary>
    private const int RechazosEnLog = 5;

    private static readonly JsonSerializerOptions OpcionesJson = new(JsonSerializerDefaults.Web);

    private readonly ColaExistencias _cola;
    private readonly ConfiguracionAgente _config;
    private readonly ILogger _logger;
    private readonly TimeProvider _reloj;
    private readonly HttpClient _cliente;
    private readonly TimeSpan _timeout;
    private readonly Uri _base;

    private int _fallasSeguidas;
    private DateTimeOffset _proximoIntento = DateTimeOffset.MinValue;
    private string? _ultimaFalla;

    public EnviadorExistencias(
        ColaExistencias cola,
        ConfiguracionAgente config,
        ILogger logger,
        TimeProvider reloj,
        HttpMessageHandler? handler = null,
        TimeSpan? timeout = null)
    {
        _cola = cola;
        _config = config;
        _logger = logger;
        _reloj = reloj;
        _timeout = timeout ?? EnviadorCola.TimeoutPorDefecto;
        _base = config.ApiUrl.AbsoluteUri.EndsWith('/') ? config.ApiUrl : new Uri(config.ApiUrl.AbsoluteUri + "/");
        _cliente = new HttpClient(handler ?? new SocketsHttpHandler(), disposeHandler: handler is null)
        {
            Timeout = Timeout.InfiniteTimeSpan,
        };
    }

    public ColaExistencias Cola => _cola;

    /// <summary>Cuándo se permite el siguiente envío (MinValue = ya).</summary>
    public DateTimeOffset ProximoIntento => _proximoIntento;

    public void Dispose() => _cliente.Dispose();

    /// <summary>Si no está en backoff, manda hasta <see cref="EnviadorCatalogos.PeticionesPorCiclo"/> fotos.</summary>
    public async Task CicloAsync(CancellationToken cancelacion)
    {
        if (_reloj.GetUtcNow() < _proximoIntento)
        {
            return;
        }

        for (var i = 0; i < EnviadorCatalogos.PeticionesPorCiclo(_config.IntervaloSegundos); i++)
        {
            var envio = _cola.TomarSiguiente();
            if (envio is null)
            {
                break;
            }

            if (!await EnviarAsync(envio, cancelacion))
            {
                AplicarBackoff();
                return;
            }

            Recuperado();
        }
    }

    /// <returns><c>false</c> si hay que esperar (falla reintentable).</returns>
    private async Task<bool> EnviarAsync(EnvioExistencias envio, CancellationToken cancelacion)
    {
        using var limite = CancellationTokenSource.CreateLinkedTokenSource(cancelacion);
        limite.CancelAfter(_timeout);
        using var peticion = new HttpRequestMessage(HttpMethod.Post, new Uri(_base, "ingesta/existencias"))
        {
            Content = EnviadorCatalogos.Gzip(envio.Payload),
        };
        peticion.Headers.Add(VerificacionApi.HeaderApiKey, _config.ApiKey);

        HttpResponseMessage respuesta;
        try
        {
            respuesta = await _cliente.SendAsync(peticion, limite.Token);
        }
        catch (OperationCanceledException) when (!cancelacion.IsCancellationRequested)
        {
            return Reintentable(envio, $"El API no respondió en {_timeout.TotalSeconds:0} s.");
        }
        catch (HttpRequestException ex)
        {
            return Reintentable(envio, $"No se pudo conectar con el API ({ex.HttpRequestError}).");
        }

        using (respuesta)
        {
            var codigo = (int)respuesta.StatusCode;
            if (respuesta.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.TooManyRequests
                || (codigo >= 500 && codigo != 500))
            {
                return Reintentable(envio, $"El API respondió {codigo} a la foto del almacén {envio.Almacen}.");
            }

            if (!respuesta.IsSuccessStatusCode)
            {
                Descartar(envio, $"El API respondió {codigo} a la foto del almacén {envio.Almacen}{Explicacion(respuesta.StatusCode)}");
                return true;
            }

            try
            {
                var resultado = await respuesta.Content.ReadFromJsonAsync<ResultadoDto>(OpcionesJson, limite.Token);
                if (resultado?.Aplicado is not { } aplicado || resultado.Rechazados is null)
                {
                    throw new JsonException("sin el resultado de la foto");
                }

                _cola.Quitar(envio);
                Registrar(envio, aplicado, resultado);
            }
            catch (Exception ex) when (ex is JsonException or NotSupportedException)
            {
                Descartar(envio, $"El API respondió {codigo} a la foto del almacén {envio.Almacen} sin el resultado " +
                                 "esperado: 'apiUrl' no parece ser el API del monitor.");
            }
            catch (OperationCanceledException) when (!cancelacion.IsCancellationRequested)
            {
                return Reintentable(envio, $"El API no terminó de responder en {_timeout.TotalSeconds:0} s.");
            }

            return true;
        }
    }

    private void Registrar(EnvioExistencias envio, bool aplicado, ResultadoDto r)
    {
        if (!aplicado)
        {
            _logger.LogWarning(
                "Existencias: el panel ignoró la foto del almacén {Almacen} (leída {CapturadoAt}) porque ya aplicó una más " +
                "nueva. Si se repite, revisa el reloj de esta PC.",
                envio.Almacen, envio.CapturadoAt);
            return;
        }

        _logger.LogInformation(
            "Existencias: foto del almacén {Almacen} aplicada en el panel: {Recibidos} registro(s), {Creados} nuevo(s), " +
            "{Actualizados} con cambios, {Borrados} borrado(s), {Rechazados} rechazado(s).",
            envio.Almacen, r.Recibidos, r.Creados, r.Actualizados, r.Borrados, r.Rechazados!.Count);

        foreach (var rechazo in r.Rechazados.Take(RechazosEnLog))
        {
            _logger.LogWarning(
                "Existencias: el panel rechazó el registro {Indice} ({Insumo}) del almacén {Almacen}: {Motivo}",
                rechazo.Indice, rechazo.InsumoOrigenSrId ?? "sin insumo válido", envio.Almacen, rechazo.Motivo);
        }

        if (r.Rechazados.Count > RechazosEnLog)
        {
            _logger.LogWarning(
                "Existencias: … y {Mas} rechazo(s) más en la foto del almacén {Almacen}.",
                r.Rechazados.Count - RechazosEnLog, envio.Almacen);
        }

        if (r.AusentesConservados is true)
        {
            _logger.LogWarning(
                "Existencias: el panel no borró los insumos que faltan en la foto del almacén {Almacen} porque algún " +
                "rechazo no traía insumo identificable.",
                envio.Almacen);
        }
    }

    private static string Explicacion(HttpStatusCode codigo) => codigo switch
    {
        HttpStatusCode.BadRequest => ": el sobre es inválido (¿reloj de la PC adelantado más de 5 min?).",
        HttpStatusCode.RequestEntityTooLarge => ": la foto no cabe en el límite del API.",
        HttpStatusCode.InternalServerError => ": falla determinista del API.",
        _ => ".",
    };

    private void Descartar(EnvioExistencias envio, string motivo)
    {
        _cola.Quitar(envio);
        _logger.LogError(
            "Existencias: {Motivo} Se descarta esa foto ({Registros} registro(s)); la siguiente lectura manda otra completa.",
            motivo, envio.Registros);
    }

    private bool Reintentable(EnvioExistencias envio, string mensaje)
    {
        _cola.SumarIntento(envio);
        if (mensaje != _ultimaFalla)
        {
            _ultimaFalla = mensaje;
            _logger.LogError(
                "Existencias: no se pudo enviar al API. {Mensaje} La foto se conserva y se reintenta con espera " +
                "creciente. Fotos pendientes: {Pendientes}.",
                mensaje, _cola.ContarPendientes());
        }

        return false;
    }

    private void AplicarBackoff()
    {
        _fallasSeguidas++;
        var espera = TimeSpan.FromTicks(Math.Min(
            EnviadorCola.BackoffMaximo.Ticks,
            EnviadorCola.BackoffInicial.Ticks * (1L << Math.Min(_fallasSeguidas - 1, 20))));
        _proximoIntento = _reloj.GetUtcNow() + espera;
    }

    private void Recuperado()
    {
        if (_ultimaFalla is not null)
        {
            _logger.LogInformation("Existencias: se restableció el envío al API.");
        }

        _fallasSeguidas = 0;
        _proximoIntento = DateTimeOffset.MinValue;
        _ultimaFalla = null;
    }

    /// <summary>Forma de <c>ResultadoExistenciasDto</c> (api/src/ingesta/dto/existencias.dto.ts).</summary>
    internal sealed record ResultadoDto(
        bool? Aplicado, int? Recibidos, int? Creados, int? Actualizados, int? Borrados, bool? AusentesConservados,
        List<RechazoDto>? Rechazados);

    internal sealed record RechazoDto(int Indice, string? InsumoOrigenSrId, string? Motivo);
}
