import type { CapacitorConfig } from '@capacitor/cli';
import { resolverUrlPanel, rutaDeRespaldo } from './url-panel.cjs';

// La app NO empaqueta el build de /web: carga el panel de producción en su WebView. Así la SPA y
// la API quedan en el MISMO origen que en el navegador (cookie de sesión HttpOnly SameSite=Strict
// con Path=/api/auth, /api relativo, la CSP de Caddy) sin CORS ni cambios en la API, y cada deploy
// del panel llega a la app sin publicar un APK nuevo.
//
// www/ sólo trae la pantalla de respaldo "Sin conexión" (server.errorPath): Capacitor la muestra
// cuando la carga del panel falla. Todo lo demás de este archivo existe para que la app sea un
// visor del panel y nada más.
const urlPanel = resolverUrlPanel(process.env.YC_URL_PANEL);
const hostPanel = new URL(urlPanel).host;

const config: CapacitorConfig = {
  appId: 'mx.yocontrolo.app',
  appName: 'Yo Controlo',
  webDir: 'www',
  // Morado de la marca detrás del WebView: es lo que se ve mientras carga el panel y bajo la
  // barra de estado, en vez de un destello blanco.
  backgroundColor: '#2C1533',
  server: {
    url: urlPanel,
    // Sólo el host del panel navega DENTRO de la app. Cualquier otro (github.com para el
    // instalador, mailto:, tel:, ligas de terceros) Capacitor lo abre con un Intent: navegador
    // del sistema, correo o marcador. Ver Bridge.launchIntent en @capacitor/android.
    allowNavigation: [hostPanel],
    androidScheme: 'https',
    cleartext: false,
    errorPath: rutaDeRespaldo(urlPanel),
  },
  android: {
    // La app no carga contenido mixto ni se depura en un APK de release.
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    // SystemBars viene en @capacitor/android 8 (no es un plugin extra). DARK = íconos claros
    // sobre la barra morada; `native` respeta el viewport del panel (sin viewport-fit=cover el
    // WebView queda debajo de la barra de estado, que pinta el morado de la ventana).
    SystemBars: {
      insetsHandling: 'native',
      style: 'DARK',
    },
  },
};

export default config;
