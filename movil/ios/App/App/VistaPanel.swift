import UIKit
import Capacitor

/// El visor del panel: el `CAPBridgeViewController` de Capacitor con lo único nativo propio de iOS.
///
/// iPhone no tiene botón Atrás (en Android lo resuelve `NavegacionAtras.java`). Aquí se activa el
/// gesto del sistema: deslizar desde el borde izquierdo regresa en el historial del panel y desde
/// el derecho avanza, igual que en Safari. En la raíz del panel el gesto no hace nada (no hay a
/// dónde regresar) y la app no se cierra: en iOS las apps no se cierran solas.
class VistaPanelViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        webView?.allowsBackForwardNavigationGestures = true
    }
}
