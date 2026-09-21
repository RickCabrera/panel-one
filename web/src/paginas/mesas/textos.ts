import type { MesaMonitor, Semaforo } from './reglas';

/** El semáforo en palabras, para el lector de pantalla (el color no basta). */
export const TEXTO_SEMAFORO: Record<Semaforo, string> = {
  ok: 'a tiempo',
  alerta: 'en alerta',
  rojo: 'requiere atención',
  'sin-dato': 'sin hora de apertura',
};

/** "Mesa 12" o "Mesa 12 · Centro": el nombre de la tarjeta y el título del modal. */
export function nombreMesa(mesa: MesaMonitor, conSucursal: boolean): string {
  const nombre = `Mesa ${mesa.mesa ?? 'sin número'}`;
  return conSucursal ? `${nombre} · ${mesa.sucursal}` : nombre;
}
