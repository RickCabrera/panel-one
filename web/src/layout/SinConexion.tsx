import { useSyncExternalStore } from 'react';

/**
 * Aviso de "sin conexión" (F2-146). Con la PWA, el armazón abre sin red (lo sirve el service
 * worker) pero los datos NO se guardan en caché: cada vista dice que no pudo leer. Este aviso
 * explica por qué, en vez de que parezca que el panel se rompió.
 */
function suscribir(aviso: () => void): () => void {
  window.addEventListener('online', aviso);
  window.addEventListener('offline', aviso);
  return () => {
    window.removeEventListener('online', aviso);
    window.removeEventListener('offline', aviso);
  };
}

export function SinConexion() {
  const enLinea = useSyncExternalStore(
    suscribir,
    () => navigator.onLine,
    () => true,
  );
  if (enLinea) return null;
  return (
    <div
      role="status"
      data-testid="sin-conexion"
      className="border-b border-aviso-borde bg-aviso-fondo px-4 py-2 text-sm text-aviso-fuerte"
    >
      Sin conexión a internet: no se pueden leer ventas, mesas ni alertas hasta que vuelva la red.
      Lo que ves puede no estar al día.
    </div>
  );
}
