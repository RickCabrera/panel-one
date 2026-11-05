# Yo Controlo · App móvil (Android hoy, iPhone después)

La app es **el mismo panel web**, abierto dentro de una app nativa hecha con
[Capacitor](https://capacitorjs.com) 8. No empaqueta el build de `/web`: su WebView carga el
panel de producción (`server.url` en `capacitor.config.ts`).

**Descarga (Android):** https://github.com/RickCabrera/panel-one/releases/download/android/YoControlo.apk
(y `YoControlo.apk.sha256` al lado).

## Cómo funciona

- **Mismo origen que el navegador.** La app abre `https://web-production-730b5.up.railway.app/`
  (o la de la variable `YC_URL_PANEL`). La SPA y la API quedan en el mismo origen que siempre:
  la cookie de sesión (HttpOnly, SameSite=Strict, Path=/api/auth), el `/api` relativo y la CSP de
  Caddy funcionan sin CORS y sin tocar la API. Cada deploy del panel llega a la app sin publicar
  un APK nuevo. Empaquetar el build local del web con la API en otro origen rompería la cookie
  SameSite=Strict y la CSP: por eso no se hace.
- **Enlaces.** Sólo el host del panel navega dentro de la app (`server.allowNavigation`). Lo demás
  (github.com —p. ej. la descarga del instalador del agente—, `mailto:`, `tel:`, cualquier otro
  dominio) lo abre Capacitor con el navegador, el correo o el marcador del teléfono
  (`Bridge.launchIntent` de `@capacitor/android`).
- **Botón Atrás.** Regresa en el historial del panel; en la raíz sale de la app. En la pantalla
  "Sin conexión" sale siempre. Es lo único nativo propio:
  `android/app/src/main/java/mx/yocontrolo/app/MainActivity.java` + `NavegacionAtras.java`
  (probado con JUnit en `android/app/src/test`).
- **Sin internet.** Si la carga del panel falla (modo avión, sin señal, el servidor no responde),
  Capacitor muestra `www/index.html` (`server.errorPath`): pantalla morada con el logo, "Sin
  conexión. Revisa tu internet y vuelve a intentar." y un botón **Reintentar** que vuelve a
  abrir el panel. Dos matices, iguales que en el navegador: si el panel ya estaba abierto y se
  cae la red, se queda como está y sus llamadas a la API fallan; y una vez que el panel se abrió
  con internet, su service worker (la PWA, F2-146) guarda el armazón y lo sirve sin red, así que
  sin internet puede abrirse el armazón del panel en vez de esta pantalla. La pantalla de
  respaldo es para cuando no hay nada que mostrar (la primera vez, o un error del servidor en la
  carga de la página).
- **Plugins:** ninguno además de `@capacitor/core` y `@capacitor/android`. `SystemBars` (barra de
  estado con íconos claros sobre el morado) viene dentro de `@capacitor/android`. Permiso único:
  `INTERNET` (el CI falla si aparece otro).
- **Sin respaldo:** `allowBackup="false"` y `dataExtractionRules` que excluyen todo (Android 12+
  también en la transferencia entre teléfonos): la sesión del panel no sale del teléfono. Sin el
  FileProvider de la plantilla (era para la cámara de `<input capture>`, que el panel no usa).

### Lo que todavía no hace

- **Descargas del panel** (exportar CSV, PDF/XML de facturas): el WebView no trae gestor de
  descargas y el panel genera esos archivos como `blob:`. En la app el botón no hace nada; en el
  navegador sí. Arreglarlo pide un plugin nativo de archivos o un cambio en el web (MOV-02).
- **Notificaciones push nativas** (FCM): Capacitor lo deja listo para sumar `@capacitor/push-notifications`.

## Instalar el APK en un Android

1. En el teléfono, abre la liga de descarga de arriba con Chrome y descarga `YoControlo.apk`.
2. Ábrelo desde la notificación de descarga (o desde *Archivos › Descargas*).
3. Android avisa que la app viene de una fuente desconocida: toca **Configuración** y activa
   **Permitir de esta fuente** para Chrome (o el gestor de archivos). Regresa e **Instalar**.
   (En algunos teléfonos está en *Ajustes › Seguridad › Instalar apps desconocidas*.)
4. Play Protect puede decir que no reconoce la app: **Instalar de todas formas**. Es normal en
   una app que no viene de la Play Store.
5. Abre **Yo Controlo** e inicia sesión como en el navegador.

Para comprobar que el archivo es el que armó el CI:
`sha256sum YoControlo.apk` contra `YoControlo.apk.sha256`, o
`gh attestation verify YoControlo.apk -R RickCabrera/panel-one`.

### Actualizar (y por qué hoy hay que desinstalar)

Lo que se publica es siempre el APK de **release** (no debuggable: el CI lo comprueba con
`aapt2`). Mientras no estén los secrets de la llave de release, `publicar` lo firma con una llave
**efímera**: la genera con `keytool` en esa corrida y la borra al terminar. Android sólo instala una
versión encima de otra si las dos tienen la **misma firma**, así que con la llave efímera cada APK
nuevo pide **desinstalar el anterior** (sólo se pierde la sesión guardada; los datos viven en el
panel). Para no molestar de más, el CI sólo publica un APK nuevo cuando cambia algo de la app
(`movil/`, `apk.yml`, la URL del panel o el tipo de firma), no en cada deploy del panel.

No se versiona una llave fija en el repo: el repo es público y cualquiera podría firmar un APK "de
Yo Controlo" que se instale encima del bueno. La solución es la llave de release.

## Firmar con la llave de release (lo que falta para actualizar sin desinstalar y para Play Store)

1. Crear la llave UNA vez, en la máquina de Ricardo (JDK instalado), y guardarla fuera del repo
   con respaldo (perderla = no poder actualizar nunca la app ya instalada):

   ```bash
   keytool -genkeypair -v -keystore yocontrolo-release.jks -alias yocontrolo \
     -keyalg RSA -keysize 4096 -validity 10000
   ```

2. Cargar cuatro secrets en GitHub (*Settings › Secrets and variables › Actions › New repository
   secret*):

   | Secret | Valor |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | `base64 -w0 yocontrolo-release.jks` (en PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("yocontrolo-release.jks"))`) |
   | `ANDROID_KEYSTORE_PASSWORD` | la contraseña del keystore |
   | `ANDROID_KEY_ALIAS` | `yocontrolo` |
   | `ANDROID_KEY_PASSWORD` | la contraseña de la llave (la misma si no se dio otra) |

3. Correr *Actions › App Android (APK) › Run workflow* sobre `main`. Desde ahí el release `android`
   trae el APK firmado con esa llave. Quien tenga uno firmado con llave efímera lo desinstala UNA última vez; las
   siguientes versiones se instalan encima.

Cómo se protege la llave: el job `armar` (que compila código del repo, y en un PR código sin
revisar) **nunca** la ve; arma `app-release-unsigned.apk`. El job `publicar` no hace checkout ni
ejecuta código del repo: con `umask 077` decodifica la llave en `$RUNNER_TEMP`, firma con
`zipalign` + `apksigner` del SDK del runner y la borra (`trap`). Los cuatro secrets o ninguno: con
una configuración a medias el workflow falla en vez de caer en silencio a la llave efímera.

### Play Store

Además de la llave:

- Play pide **AAB**, no APK: agregar `./gradlew bundleRelease` y firmar el `.aab` con la llave de
  *upload* (con Play App Signing, la llave de arriba sirve como llave de upload).
- Cuenta de desarrollador de Google Play (pago único), ficha de la tienda (capturas, ícono de
  512×512 —`docs/marca/isotipo-app.svg`—, descripción), política de privacidad pública y el
  formulario de *Seguridad de los datos*.
- Una app que sólo envuelve un sitio web puede ser rechazada por "funcionalidad mínima"
  (política de *webview spam*): conviene llegar con algo nativo (push FCM, por ejemplo).
- `targetSdkVersion` al día (hoy 36, el de la plantilla de Capacitor 8).

## Pasar a iPhone (más adelante)

En una Mac con Xcode:

```bash
cd movil
npm install --save-exact @capacitor/ios@<la misma versión que @capacitor/android>
npx cap add ios        # crea movil/ios (se versiona, como android/)
npx cap open ios       # firma con la cuenta de Apple Developer y corre en un iPhone
```

`capacitor.config.ts` ya sirve tal cual (misma `server.url`, `errorPath` y `allowNavigation`).
Lo propio de iOS: el botón Atrás no existe (el gesto de deslizar lo da `WKWebView` con
`allowsBackForwardNavigationGestures`), la distribución es por TestFlight / App Store (no hay
sideload) y Apple también revisa la "funcionalidad mínima" de las apps que envuelven un sitio.

## Desarrollo

Requisitos: Node 22, JDK 21 y el SDK de Android (Android Studio). Todo desde `movil/`:

```bash
npm ci
npm test                  # pruebas de la URL del panel y de la pantalla de respaldo (node:test)
npx cap sync android      # copia www/ y escribe capacitor.config.json en android/
cd android && ./gradlew testDebugUnitTest assembleDebug   # APK en app/build/outputs/apk/debug
npx cap open android      # (opcional) abre Android Studio
```

- **Otro panel** (un dominio propio, o uno de pruebas): `YC_URL_PANEL=https://panel.ejemplo.mx
  npx cap sync android`. Sólo https, sin ruta (la cookie y `/api` viven en la raíz del origen);
  `url-panel.cjs` lo valida. En el CI es la variable del repo `YC_URL_PANEL`.
- **Íconos y splash**: se generan desde `docs/marca/isotipo-*.svg` (la marca, UI-02) con `npm run iconos` (rasteriza con
  Playwright, que no es dependencia de `/movil`) y los PNG se versionan en
  `android/app/src/main/res`.
- **versionCode** = `YC_VERSION_CODE` (en el CI, el número de corrida de `apk.yml`); versionName
  `1.0.<versionCode>`.
- `android/` se versiona (es lo normal con Capacitor y es donde viven los recursos y el
  `MainActivity`); lo que genera `cap sync` (`assets/public`, `capacitor.config.json`) no.
