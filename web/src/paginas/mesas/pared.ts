import { queryVista } from '../../filtros/vista';
import { PARAM_ESTADO, PARAM_ORDEN, type CriterioMesas } from './orden';

/** El texto de la vista vacía cuando ninguna sucursal está en vivo (F2-223). */
export const TEXTO_NADIE_EN_VIVO =
  'Ninguna sucursal está reportando en vivo: sus mesas aparecen cuando su agente vuelva a mandar lectura.';

/** `/mesas/pared?…` o `/mesas?…` con el alcance, el periodo y el criterio actuales. */
export function enlaceMesas(
  ruta: '/mesas' | '/mesas/pared',
  parametros: URLSearchParams,
  criterio: CriterioMesas,
): string {
  const q = new URLSearchParams(queryVista(parametros).replace(/^\?/, ''));
  q.set(PARAM_ORDEN, criterio.orden);
  q.set(PARAM_ESTADO, criterio.estado);
  return `${ruta}?${q.toString()}`;
}

/**
 * Pide pantalla completa (necesita el gesto del usuario: se llama en el clic). Si el
 * navegador no puede o no deja, la vista de pared funciona igual dentro de la ventana.
 */
export function pedirPantallaCompleta(): void {
  const raiz = document.documentElement;
  if (typeof raiz.requestFullscreen !== 'function' || document.fullscreenElement) return;
  raiz.requestFullscreen().catch(() => {});
}

/** Sale de pantalla completa si estaba. */
export function salirPantallaCompleta(): void {
  if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
    document.exitFullscreen().catch(() => {});
  }
}
