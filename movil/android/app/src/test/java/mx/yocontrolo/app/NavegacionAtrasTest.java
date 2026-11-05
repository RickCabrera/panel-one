package mx.yocontrolo.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class NavegacionAtrasTest {

    private static final String PANEL = "https://web-production-730b5.up.railway.app/";
    private static final String RESPALDO =
        "https://localhost/index.html?panel=https%3A%2F%2Fweb-production-730b5.up.railway.app%2F";

    @Test
    public void conHistorialRegresaEnElPanel() {
        assertEquals(
            NavegacionAtras.Accion.ATRAS_EN_EL_PANEL,
            NavegacionAtras.decidir(true, PANEL + "ventas", RESPALDO)
        );
    }

    @Test
    public void enLaRaizSinHistorialSale() {
        assertEquals(NavegacionAtras.Accion.SALIR, NavegacionAtras.decidir(false, PANEL, RESPALDO));
    }

    @Test
    public void enLaPantallaDeRespaldoSaleAunqueHayaHistorial() {
        // Regresar llevaría a la carga que falló, que vuelve a traer el respaldo: un ciclo.
        assertEquals(NavegacionAtras.Accion.SALIR, NavegacionAtras.decidir(true, RESPALDO, RESPALDO));
        assertEquals(
            NavegacionAtras.Accion.SALIR,
            NavegacionAtras.decidir(true, "https://localhost/index.html", RESPALDO)
        );
    }

    @Test
    public void sinUrlTodaviaDecidePorElHistorial() {
        assertEquals(NavegacionAtras.Accion.SALIR, NavegacionAtras.decidir(false, null, RESPALDO));
        assertEquals(NavegacionAtras.Accion.ATRAS_EN_EL_PANEL, NavegacionAtras.decidir(true, null, null));
    }

    @Test
    public void unaRutaDelPanelNoSeConfundeConElRespaldo() {
        assertFalse(NavegacionAtras.esPantallaDeRespaldo(PANEL + "index.html", RESPALDO));
        assertFalse(NavegacionAtras.esPantallaDeRespaldo("https://localhost/otra.html", RESPALDO));
        assertTrue(NavegacionAtras.esPantallaDeRespaldo(RESPALDO + "#x", RESPALDO));
    }
}
