package mx.yocontrolo.app;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

/**
 * La app es un WebView (Capacitor) sobre el panel de producción; ver movil/capacitor.config.ts.
 *
 * <p>Lo único nativo propio es el botón Atrás (sin el plugin @capacitor/app, Android cerraría la
 * app al primer Atrás). Los enlaces externos (otros dominios, mailto:, tel:, github.com) ya los
 * abre Capacitor fuera de la app (Bridge.launchIntent) y la pantalla "Sin conexión" la carga
 * Capacitor con server.errorPath.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = bridge != null ? bridge.getWebView() : null;
                NavegacionAtras.Accion accion = webView == null
                    ? NavegacionAtras.Accion.SALIR
                    : NavegacionAtras.decidir(webView.canGoBack(), webView.getUrl(), bridge.getErrorUrl());
                if (accion == NavegacionAtras.Accion.ATRAS_EN_EL_PANEL) {
                    webView.goBack();
                    return;
                }
                // En la raíz: lo que Android haga por defecto (salir / mandar al fondo).
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }
}
