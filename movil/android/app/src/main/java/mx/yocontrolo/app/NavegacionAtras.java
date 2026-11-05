package mx.yocontrolo.app;

/**
 * Qué hace el botón Atrás de Android. Lógica pura (sin Android) para probarla con JUnit en la JVM.
 *
 * <ul>
 *   <li>Si el WebView tiene historial, regresa en el historial del panel (las rutas de la SPA
 *       entran al historial del WebView con pushState).</li>
 *   <li>En la raíz (sin historial) deja que Android haga lo suyo: salir de la app.</li>
 *   <li>En la pantalla de respaldo "Sin conexión" siempre sale: regresar en el historial volvería
 *       a la carga que falló, que vuelve a fallar y trae de nuevo la pantalla de respaldo.</li>
 * </ul>
 */
final class NavegacionAtras {

    enum Accion {
        ATRAS_EN_EL_PANEL,
        SALIR,
    }

    private NavegacionAtras() {}

    /**
     * @param puedeIrAtras {@code WebView.canGoBack()}
     * @param urlActual {@code WebView.getUrl()} (puede ser null antes de la primera carga)
     * @param urlRespaldo {@code Bridge.getErrorUrl()}: la pantalla de respaldo, con o sin query
     *     (puede ser null si no hay server.errorPath)
     */
    static Accion decidir(boolean puedeIrAtras, String urlActual, String urlRespaldo) {
        if (esPantallaDeRespaldo(urlActual, urlRespaldo)) {
            return Accion.SALIR;
        }
        return puedeIrAtras ? Accion.ATRAS_EN_EL_PANEL : Accion.SALIR;
    }

    /** Compara sin query ni fragmento: el ?panel= de la ruta de respaldo no cuenta. */
    static boolean esPantallaDeRespaldo(String urlActual, String urlRespaldo) {
        if (urlActual == null || urlRespaldo == null) {
            return false;
        }
        return sinQuery(urlActual).equals(sinQuery(urlRespaldo));
    }

    private static String sinQuery(String url) {
        int corte = url.length();
        int q = url.indexOf('?');
        int h = url.indexOf('#');
        if (q >= 0) corte = Math.min(corte, q);
        if (h >= 0) corte = Math.min(corte, h);
        return url.substring(0, corte);
    }
}
