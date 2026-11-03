/**
 * Reglas puras del diálogo "Conectar sucursal" (instalador de un clic).
 */

/** La URL de descarga del paquete del instalador, sólo si es `https://`. Si no, null. */
export function leerUrlInstalador(valor: string | undefined): string | null {
  const limpio = valor?.trim() ?? '';
  if (!limpio) return null;
  try {
    return new URL(limpio).protocol === 'https:' ? limpio : null;
  } catch {
    return null;
  }
}

/** La de este despliegue (`VITE_URL_INSTALADOR_AGENTE`), ya validada. */
export const URL_INSTALADOR = leerUrlInstalador(
  import.meta.env.VITE_URL_INSTALADOR_AGENTE as string | undefined,
);

/** Segundos que le quedan al código (nunca negativo). */
export function segundosRestantes(expiraAt: string, ahoraMs: number): number {
  return Math.max(0, Math.ceil((Date.parse(expiraAt) - ahoraMs) / 1000));
}

/** `1799` → `29:59`. */
export function formatoRestante(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
