using System.Text.Json;
using ArkonAgente.Actualizacion;
using Microsoft.Extensions.Logging;

namespace ArkonAgente.Tests;

/// <summary>
/// Auto-update del agente (F2-143), medido contra un canal de versiones LOCAL (<see cref="CanalFalso"/>)
/// y binarios de prueba. El swap corre sobre archivos reales en una carpeta temporal y un servicio
/// simulado (<see cref="ServicioFalso"/>); con el administrador de servicios de verdad, en una PC con
/// Windows y elevación, es diurno (F1-020b).
/// </summary>
public class ActualizacionTests
{
    private const string VersionVieja = "1.0.0";
    private const string VersionNueva = "1.1.0";

    // ------------------------------------------------------------------ piezas sueltas

    [Theory]
    [InlineData("1.0.0+c0908e6", "1.0.0")]
    [InlineData("12.3.4", "12.3.4")]
    [InlineData("desconocida", null)]
    [InlineData("1.0", null)]
    [InlineData("1.0.0-beta", null)]
    [InlineData(null, null)]
    public void SinCommit_quita_el_commit_y_rechaza_lo_que_no_es_XYZ(string? entrada, string? esperado) =>
        Assert.Equal(esperado, VersionCanal.SinCommit(entrada));

    [Theory]
    [InlineData(1, 1)]
    [InlineData(2, 2)]
    [InlineData(3, 4)]
    [InlineData(5, 16)]
    [InlineData(6, 24)]
    [InlineData(40, 24)]
    public void El_backoff_por_binario_se_duplica_desde_1_h_hasta_24_h(int fallas, int horas) =>
        Assert.Equal(TimeSpan.FromHours(horas), EstadoActualizacion.Espera(fallas));

    [Fact]
    public void El_estado_distingue_binarios_y_recuerda_los_aplicados()
    {
        using var carpeta = new CarpetaTemporal();
        var estado = EstadoActualizacion.Abrir(Path.Combine(carpeta.Ruta, "estado.db"));
        var t = new DateTimeOffset(2026, 9, 23, 12, 0, 0, TimeSpan.Zero);
        var sha = new string('a', 64);

        Assert.True(estado.Decidir("1.1.0", sha, t).PuedeIntentar);
        estado.RegistrarFalla("1.1.0", sha, t);
        Assert.False(estado.Decidir("1.1.0", sha, t.AddMinutes(59)).PuedeIntentar);
        Assert.True(estado.Decidir("1.1.0", sha, t.AddHours(1)).PuedeIntentar);
        // Otro SHA de la misma versión (republicado) empieza de cero.
        Assert.True(estado.Decidir("1.1.0", new string('b', 64), t).PuedeIntentar);

        estado.RegistrarAplicada("1.1.0", sha, t);
        var aplicada = estado.Decidir("1.1.0", sha, t.AddDays(3));
        Assert.True(aplicada.Aplicada);
        Assert.False(aplicada.PuedeIntentar);
        Assert.False(aplicada.VersionDistintaReportada);
        estado.MarcarVersionDistintaReportada("1.1.0", sha);
        Assert.True(estado.Decidir("1.1.0", sha, t).VersionDistintaReportada);

        // Sobrevive a reabrir el archivo (reinicio del servicio).
        var reabierto = EstadoActualizacion.Abrir(Path.Combine(carpeta.Ruta, "estado.db"));
        Assert.True(reabierto.Decidir("1.1.0", sha, t).Aplicada);
    }

    [Theory]
    [InlineData("https://monitor.test/api", "agente/binario/1.1.0?expira=1&firma=f", "https://monitor.test/api/agente/binario/1.1.0?expira=1&firma=f")]
    [InlineData("http://localhost:3000", "agente/binario/1.1.0?x=1", "http://localhost:3000/agente/binario/1.1.0?x=1")]
    [InlineData("https://monitor.test", "https://cdn.test/agente.exe", "https://cdn.test/agente.exe")]
    [InlineData("https://monitor.test", "http://cdn.test/agente.exe", null)]
    [InlineData("https://monitor.test", "ftp://cdn.test/agente.exe", null)]
    [InlineData("https://monitor.test", "https://usuario:clave@cdn.test/a.exe", null)]
    public void El_enlace_se_resuelve_contra_apiUrl_y_solo_se_acepta_https(string api, string enlace, string? esperado) =>
        Assert.Equal(esperado, ClienteCanal.ResolverEnlace(new Uri(api), enlace)?.AbsoluteUri);

    // ------------------------------------------------------------------ el revisor (servicio del agente)

    private sealed class Escenario : IDisposable
    {
        public Escenario(string versionAgente = VersionVieja)
        {
            Carpeta = new CarpetaTemporal();
            Intercambio = CarpetaActualizacion.De(Carpeta.Rutas);
            Canal = new CanalFalso();
            Cliente = new ClienteCanal(Datos.Config(), Canal);
            Estado = EstadoActualizacion.Abrir(Intercambio.Estado);
            Revisor = new RevisorActualizacion(Intercambio, Cliente, Estado, versionAgente, Reloj, Log);
        }

        public CarpetaTemporal Carpeta { get; }

        public CarpetaActualizacion Intercambio { get; }

        public CanalFalso Canal { get; }

        public ClienteCanal Cliente { get; }

        public EstadoActualizacion Estado { get; }

        public RelojFalso Reloj { get; } = new();

        public LogActualizacion Log { get; } = new();

        public RevisorActualizacion Revisor { get; set; }

        public Task Ciclo() => Revisor.CicloAsync(CancellationToken.None);

        public void Dispose()
        {
            Cliente.Dispose();
            Carpeta.Dispose();
        }
    }

    [Fact]
    public async Task Sin_bandera_o_con_la_misma_version_no_se_descarga_nada()
    {
        using var e = new Escenario("1.1.0+abc1234");
        await e.Ciclo();
        e.Canal.Version = "1.1.0";
        e.Canal.Binario = CanalFalso.BinarioDePrueba("1.1.0");
        await e.Ciclo();

        Assert.Empty(e.Canal.Descargas);
        Assert.False(File.Exists(e.Intercambio.Solicitud));
        Assert.Equal(2, e.Canal.Peticiones.Count(p => p.Url.AbsolutePath.EndsWith("/agente/version", StringComparison.Ordinal)));
    }

    [Fact]
    public async Task Con_una_version_distinta_la_baja_SIN_api_key_la_verifica_y_deja_la_solicitud()
    {
        using var e = new Escenario();
        e.Canal.Version = VersionNueva;
        e.Canal.Binario = CanalFalso.BinarioDePrueba(VersionNueva);

        await e.Ciclo();

        var descarga = Assert.Single(e.Canal.Descargas);
        Assert.Null(descarga.ApiKey);
        Assert.Equal("https://monitor.ejemplo.test/agente/binario/X?expira=1&firma=f", descarga.Url.AbsoluteUri);
        var consulta = e.Canal.Peticiones.First(p => p.Url.AbsolutePath.EndsWith("/agente/version", StringComparison.Ordinal));
        Assert.Equal(Datos.ApiKey, consulta.ApiKey);

        Assert.Equal(e.Canal.Binario, File.ReadAllBytes(e.Intercambio.Preparado));
        Assert.False(File.Exists(e.Intercambio.Descarga));
        var solicitud = ArchivoIntercambio.Leer<SolicitudActualizacion>(e.Intercambio.Solicitud)!;
        Assert.Equal(new SolicitudActualizacion(VersionNueva, CanalFalso.Sha(e.Canal.Binario), e.Canal.Binario.Length), solicitud);

        // Con la solicitud pendiente (el watchdog no ha pasado), no se vuelve ni a preguntar.
        var antes = e.Canal.Peticiones.Count;
        await e.Ciclo();
        Assert.Equal(antes, e.Canal.Peticiones.Count);
    }

    [Fact]
    public async Task Hash_invalido_aborta_reporta_y_espera_el_backoff()
    {
        using var e = new Escenario();
        e.Canal.Version = VersionNueva;
        e.Canal.Binario = CanalFalso.BinarioDePrueba(VersionNueva);
        e.Canal.ShaAnunciado = new string('0', 64);

        await e.Ciclo();

        Assert.False(File.Exists(e.Intercambio.Solicitud));
        Assert.False(File.Exists(e.Intercambio.Preparado));
        Assert.False(File.Exists(e.Intercambio.Descarga));
        var reporte = Assert.Single(e.Canal.Reportes);
        Assert.Equal("fallida", reporte.GetProperty("resultado").GetString());
        Assert.Equal("hash_invalido", reporte.GetProperty("motivo").GetString());
        Assert.Equal(VersionNueva, reporte.GetProperty("version").GetString());
        Assert.Contains(e.Log.De(LogLevel.Error), m => m.Contains("NO se instaló", StringComparison.Ordinal));

        // El mismo binario no se vuelve a bajar hasta que pase la espera (1 h).
        e.Reloj.Avanzar(TimeSpan.FromMinutes(30));
        await e.Ciclo();
        Assert.Single(e.Canal.Descargas);
        e.Reloj.Avanzar(TimeSpan.FromMinutes(31));
        await e.Ciclo();
        Assert.Equal(2, e.Canal.Descargas.Count);
    }

    [Fact]
    public async Task Un_binario_mas_grande_que_lo_anunciado_se_corta_y_es_falla_de_descarga()
    {
        using var e = new Escenario();
        e.Canal.Version = VersionNueva;
        e.Canal.Binario = CanalFalso.BinarioDePrueba(VersionNueva, 60_000);
        e.Canal.TamanoAnunciado = 10_000;

        await e.Ciclo();

        Assert.False(File.Exists(e.Intercambio.Solicitud));
        Assert.False(File.Exists(e.Intercambio.Descarga));
        Assert.Equal("descarga", Assert.Single(e.Canal.Reportes).GetProperty("motivo").GetString());
    }

    [Fact]
    public async Task Un_enlace_que_no_es_https_no_se_descarga()
    {
        using var e = new Escenario();
        e.Canal.Version = VersionNueva;
        e.Canal.Binario = CanalFalso.BinarioDePrueba(VersionNueva);
        e.Canal.Enlace = "http://otro-host.test/agente.exe";

        await e.Ciclo();

        Assert.Empty(e.Canal.Descargas);
        Assert.False(File.Exists(e.Intercambio.Solicitud));
        Assert.Contains(e.Log.De(LogLevel.Warning), m => m.Contains("no es https", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Aplicada_pero_el_agente_sigue_en_otra_version_se_reporta_una_vez_y_no_se_reintenta()
    {
        using var e = new Escenario();
        e.Canal.Version = VersionNueva;
        e.Canal.Binario = CanalFalso.BinarioDePrueba(VersionNueva);
        var sha = CanalFalso.Sha(e.Canal.Binario);
        ArchivoIntercambio.EscribirAtomico(
            e.Intercambio.Resultado, new ResultadoActualizacion("aplicada", VersionNueva, sha, null, null));

        await e.Ciclo();
        await e.Ciclo();
        await e.Ciclo();

        Assert.Empty(e.Canal.Descargas);
        Assert.False(File.Exists(e.Intercambio.Resultado));
        var reportes = e.Canal.Reportes;
        Assert.Equal(2, reportes.Count);
        Assert.Equal("aplicada", reportes[0].GetProperty("resultado").GetString());
        Assert.Equal("version_distinta", reportes[1].GetProperty("motivo").GetString());
    }

    [Fact]
    public async Task El_resultado_del_watchdog_no_se_borra_si_el_api_no_lo_guardo()
    {
        using var e = new Escenario();
        e.Canal.ReporteFalla = true;
        ArchivoIntercambio.EscribirAtomico(
            e.Intercambio.Resultado,
            new ResultadoActualizacion("fallida", VersionNueva, new string('c', 64), "arranque", "se cayó"));

        await e.Ciclo();
        Assert.True(File.Exists(e.Intercambio.Resultado));

        e.Canal.ReporteFalla = false;
        await e.Ciclo();
        Assert.False(File.Exists(e.Intercambio.Resultado));
    }

    // ------------------------------------------------------------------ el watchdog

    private sealed class Instalacion : IDisposable
    {
        public Instalacion(byte[]? binarioViejo = null)
        {
            Carpeta = new CarpetaTemporal();
            Intercambio = CarpetaActualizacion.De(Carpeta.Rutas);
            Intercambio.Crear();
            var programa = Path.Combine(Carpeta.Ruta, "Program Files", "ArkonAgente");
            Directory.CreateDirectory(programa);
            Exe = Path.Combine(programa, "agente.exe");
            File.WriteAllBytes(Exe, binarioViejo ?? CanalFalso.BinarioDePrueba(VersionVieja));
            Servicio = new ServicioFalso(Exe);
            Actualizador = new Actualizador(
                Intercambio, Exe, Servicio, Servicio,
                (espera, _) => { Reloj.Avanzar(espera); return Task.CompletedTask; },
                Reloj, Log);
        }

        public CarpetaTemporal Carpeta { get; }

        public CarpetaActualizacion Intercambio { get; }

        public string Exe { get; }

        public ServicioFalso Servicio { get; }

        public Actualizador Actualizador { get; }

        public RelojFalso Reloj { get; } = new();

        public LogActualizacion Log { get; } = new();

        public byte[] Preparar(string version, byte[]? binario = null, string? sha = null)
        {
            binario ??= CanalFalso.BinarioDePrueba(version);
            File.WriteAllBytes(Intercambio.Preparado, binario);
            ArchivoIntercambio.EscribirAtomico(
                Intercambio.Solicitud, new SolicitudActualizacion(version, sha ?? CanalFalso.Sha(binario), binario.Length));
            return binario;
        }

        public Task<ResultadoActualizacion?> Vuelta() => Actualizador.UnaVueltaAsync(CancellationToken.None);

        public void Dispose() => Carpeta.Dispose();
    }

    [Fact]
    public async Task Sin_solicitud_no_hace_nada()
    {
        using var i = new Instalacion();
        Assert.Null(await i.Vuelta());
        Assert.Empty(i.Servicio.Bitacora);
    }

    [Fact]
    public async Task Instala_detiene_reemplaza_y_arranca_en_ese_orden_sin_dos_instancias()
    {
        using var i = new Instalacion();
        var viejo = File.ReadAllBytes(i.Exe);
        i.Servicio.PollsParaDetener = 3;
        var nuevo = i.Preparar(VersionNueva);

        var r = await i.Vuelta();

        Assert.Equal(ResultadoActualizacion.Bien(new SolicitudActualizacion(VersionNueva, CanalFalso.Sha(nuevo), nuevo.Length)), r);
        Assert.Equal(["detener", "arrancar"], i.Servicio.Bitacora);
        Assert.Equal(nuevo, File.ReadAllBytes(i.Exe));
        Assert.Equal(viejo, File.ReadAllBytes(i.Actualizador.ExeAnterior));
        Assert.Equal(nuevo, i.Servicio.Corriendo);
        Assert.Equal(1, i.Servicio.MaxInstancias);
        Assert.Empty(i.Servicio.Violaciones);
        Assert.False(File.Exists(i.Actualizador.ExeNuevo));
        Assert.False(File.Exists(i.Intercambio.Solicitud));
        Assert.False(File.Exists(i.Intercambio.Preparado));
        Assert.Equal(r, ArchivoIntercambio.Leer<ResultadoActualizacion>(i.Intercambio.Resultado));
    }

    [Fact]
    public async Task Hash_invalido_en_el_watchdog_no_detiene_nada_ni_toca_el_exe()
    {
        using var i = new Instalacion();
        var viejo = File.ReadAllBytes(i.Exe);
        i.Preparar(VersionNueva, sha: new string('f', 64));

        var r = await i.Vuelta();

        Assert.Equal("fallida", r!.Resultado);
        Assert.Equal(MotivoFalla.HashInvalido, r.Motivo);
        Assert.Empty(i.Servicio.Bitacora);
        Assert.Equal(viejo, File.ReadAllBytes(i.Exe));
        Assert.Equal(viejo, i.Servicio.Corriendo);
        Assert.False(File.Exists(i.Actualizador.ExeNuevo));
        Assert.False(File.Exists(i.Intercambio.Preparado));
    }

    [Fact]
    public async Task La_ruta_del_preparado_es_fija_y_una_solicitud_invalida_se_descarta_sin_tocar_nada()
    {
        using var i = new Instalacion();
        var viejo = File.ReadAllBytes(i.Exe);
        // Un campo "archivo" que apunta afuera se ignora: el watchdog sólo lee su ruta fija.
        var ajeno = Path.Combine(i.Carpeta.Ruta, "ajeno.exe");
        var binarioAjeno = CanalFalso.BinarioDePrueba("6.6.6");
        File.WriteAllBytes(ajeno, binarioAjeno);
        File.WriteAllText(i.Intercambio.Solicitud, JsonSerializer.Serialize(new
        {
            version = "6.6.6",
            sha256 = CanalFalso.Sha(binarioAjeno),
            tamanoBytes = binarioAjeno.Length,
            archivo = "../../ajeno.exe",
        }));

        var r = await i.Vuelta();

        Assert.Equal(MotivoFalla.HashInvalido, r!.Motivo);
        Assert.Equal(viejo, File.ReadAllBytes(i.Exe));

        // Versión que no es X.Y.Z: se descarta sin resultado y sin tocar el servicio.
        File.Delete(i.Intercambio.Resultado);
        File.WriteAllText(i.Intercambio.Solicitud, JsonSerializer.Serialize(new
        {
            version = "../../1.0.0",
            sha256 = CanalFalso.Sha(binarioAjeno),
            tamanoBytes = binarioAjeno.Length,
        }));
        Assert.Null(await i.Vuelta());
        Assert.False(File.Exists(i.Intercambio.Solicitud));
        Assert.False(File.Exists(i.Intercambio.Resultado));
        Assert.Empty(i.Servicio.Bitacora);
    }

    [Fact]
    public async Task Una_carpeta_de_intercambio_que_es_un_enlace_no_se_sigue()
    {
        using var i = new Instalacion();
        var viejo = File.ReadAllBytes(i.Exe);
        // La carpeta de intercambio apunta a otro lado (junction en Windows, symlink en Linux): el
        // watchdog, que corre como SYSTEM, no instala nada que viva detrás de un enlace.
        var otra = Path.Combine(i.Carpeta.Ruta, "otra");
        Directory.CreateDirectory(otra);
        var enlazada = new CarpetaActualizacion(Path.Combine(i.Carpeta.Ruta, "intercambio-enlazado"));
        CrearEnlaceDeCarpeta(enlazada.Ruta, otra);
        Assert.True(ArchivoIntercambio.EsReparsePoint(enlazada.Ruta));
        var binario = CanalFalso.BinarioDePrueba(VersionNueva);
        File.WriteAllBytes(Path.Combine(otra, "preparado.exe"), binario);
        ArchivoIntercambio.EscribirAtomico(
            Path.Combine(otra, "solicitud.json"), new SolicitudActualizacion(VersionNueva, CanalFalso.Sha(binario), binario.Length));
        var actualizador = new Actualizador(
            enlazada, i.Exe, i.Servicio, i.Servicio, (_, _) => Task.CompletedTask, i.Reloj, i.Log);

        Assert.Null(await actualizador.UnaVueltaAsync(CancellationToken.None));

        Assert.Empty(i.Servicio.Bitacora);
        Assert.Equal(viejo, File.ReadAllBytes(i.Exe));
        Assert.False(File.Exists(actualizador.ExeNuevo));
        // El preparado detrás del enlace no se tocó (ni se instaló ni se borró).
        Assert.True(File.Exists(Path.Combine(otra, "preparado.exe")));
        // El enlace se borra solo (no recursivo): borrar una junction con recursivo da acceso denegado.
        Directory.Delete(enlazada.Ruta);
    }

    /// <summary>Junction en Windows (no pide privilegios, a diferencia de un symlink); symlink en Linux.</summary>
    private static void CrearEnlaceDeCarpeta(string enlace, string destino)
    {
        if (!OperatingSystem.IsWindows())
        {
            Directory.CreateSymbolicLink(enlace, destino);
            return;
        }

        using var proceso = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(
            "cmd.exe", ["/c", "mklink", "/J", enlace, destino])
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        })!;
        proceso.WaitForExit();
        Assert.Equal(0, proceso.ExitCode);
    }

    [Fact]
    public async Task Si_el_servicio_no_se_detiene_no_reemplaza_nada()
    {
        using var i = new Instalacion();
        var viejo = File.ReadAllBytes(i.Exe);
        i.Servicio.NoSeDetiene = true;
        i.Preparar(VersionNueva);

        var r = await i.Vuelta();

        Assert.Equal(MotivoFalla.Detener, r!.Motivo);
        Assert.Equal(["detener"], i.Servicio.Bitacora);
        Assert.Equal(viejo, File.ReadAllBytes(i.Exe));
        Assert.Equal(viejo, i.Servicio.Corriendo);
        Assert.False(File.Exists(i.Actualizador.ExeNuevo));
        Assert.Empty(i.Servicio.Violaciones);
    }

    [Fact]
    public async Task Con_el_proceso_viejo_colgado_no_reemplaza_ni_arranca_otro_encima()
    {
        using var i = new Instalacion();
        var viejo = File.ReadAllBytes(i.Exe);
        i.Servicio.ProcesoColgado = true;
        i.Preparar(VersionNueva);

        var r = await i.Vuelta();

        Assert.Equal(MotivoFalla.Detener, r!.Motivo);
        Assert.Equal(["detener"], i.Servicio.Bitacora);
        Assert.Equal(viejo, File.ReadAllBytes(i.Exe));
        Assert.Equal(1, i.Servicio.MaxInstancias);
        Assert.Empty(i.Servicio.Violaciones);
    }

    [Fact]
    public async Task Si_la_version_nueva_se_cae_regresa_a_la_anterior()
    {
        using var i = new Instalacion();
        var viejo = File.ReadAllBytes(i.Exe);
        i.Servicio.VersionQueSeCae = VersionNueva;
        var nuevo = i.Preparar(VersionNueva);

        var r = await i.Vuelta();

        Assert.Equal(MotivoFalla.Arranque, r!.Motivo);
        Assert.Equal(["detener", "arrancar", "se-cayo", "arrancar"], i.Servicio.Bitacora);
        Assert.Equal(viejo, File.ReadAllBytes(i.Exe));
        Assert.Equal(viejo, i.Servicio.Corriendo);
        Assert.Equal(nuevo, File.ReadAllBytes(i.Actualizador.ExeFallido));
        Assert.Equal(1, i.Servicio.MaxInstancias);
        Assert.Empty(i.Servicio.Violaciones);
    }

    // ------------------------------------------------------------------ de punta a punta

    [Fact]
    public async Task Punta_a_punta_publicar_actualiza_la_sucursal_con_bandera_y_reporta_la_version_nueva()
    {
        using var i = new Instalacion();
        var canal = new CanalFalso();
        using var cliente = new ClienteCanal(Datos.Config(), canal);
        var estado = EstadoActualizacion.Abrir(i.Intercambio.Estado);
        var reloj = new RelojFalso();
        var log = new LogActualizacion();
        RevisorActualizacion AgenteCorriendo() =>
            new(i.Intercambio, cliente, estado, CanalFalso.VersionDe(i.Servicio.Corriendo!) + "+abc1234", reloj, log);

        // Sin bandera (el canal no ofrece nada): ciclos del agente y del watchdog, y nada cambia.
        await AgenteCorriendo().CicloAsync(CancellationToken.None);
        await i.Vuelta();
        Assert.Equal(VersionVieja, CanalFalso.VersionDe(i.Servicio.Corriendo!));

        // Se publica la 1.1.0 y la sucursal tiene la bandera.
        canal.Version = VersionNueva;
        canal.Binario = CanalFalso.BinarioDePrueba(VersionNueva);
        await AgenteCorriendo().CicloAsync(CancellationToken.None); // baja y verifica
        await i.Vuelta();                                            // el watchdog instala
        Assert.Equal(VersionNueva, CanalFalso.VersionDe(i.Servicio.Corriendo!));
        Assert.Equal(canal.Binario, File.ReadAllBytes(i.Exe));

        // El agente NUEVO reporta el resultado del watchdog y ya no descarga nada.
        await AgenteCorriendo().CicloAsync(CancellationToken.None);
        await AgenteCorriendo().CicloAsync(CancellationToken.None);
        Assert.Single(canal.Descargas);
        var reporte = Assert.Single(canal.Reportes);
        Assert.Equal("aplicada", reporte.GetProperty("resultado").GetString());
        Assert.Equal(VersionNueva, reporte.GetProperty("version").GetString());
        Assert.Equal(1, i.Servicio.MaxInstancias);
        Assert.Empty(i.Servicio.Violaciones);
    }

    [Fact]
    public async Task Punta_a_punta_con_hash_invalido_la_sucursal_sigue_en_su_version_y_el_api_recibe_la_falla()
    {
        using var i = new Instalacion();
        var viejo = File.ReadAllBytes(i.Exe);
        var canal = new CanalFalso
        {
            Version = VersionNueva,
            Binario = CanalFalso.BinarioDePrueba(VersionNueva),
            ShaAnunciado = new string('9', 64),
        };
        using var cliente = new ClienteCanal(Datos.Config(), canal);
        var revisor = new RevisorActualizacion(
            i.Intercambio, cliente, EstadoActualizacion.Abrir(i.Intercambio.Estado), VersionVieja, new RelojFalso(), new LogActualizacion());

        await revisor.CicloAsync(CancellationToken.None);
        Assert.Null(await i.Vuelta());

        Assert.Equal(viejo, File.ReadAllBytes(i.Exe));
        Assert.Empty(i.Servicio.Bitacora);
        Assert.Equal("hash_invalido", Assert.Single(canal.Reportes).GetProperty("motivo").GetString());
    }
}
