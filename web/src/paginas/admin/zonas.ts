/**
 * Zonas para el alta de sucursal (F1-060): primero las de México, luego el resto
 * de la lista IANA del navegador. La API valida contra la SUYA (el ICU de Node) y
 * rechaza cualquier offset (`-06:00`); aquí no se escribe a mano.
 */
export const ZONAS_MEXICO = [
  'America/Mexico_City',
  'America/Tijuana',
  'America/Hermosillo',
  'America/Mazatlan',
  'America/Chihuahua',
  'America/Ciudad_Juarez',
  'America/Monterrey',
  'America/Matamoros',
  'America/Merida',
  'America/Cancun',
  'America/Bahia_Banderas',
] as const;

export const ZONA_POR_DEFECTO = 'America/Mexico_City';

export function zonasDisponibles(actual?: string): string[] {
  let todas: string[] = [];
  try {
    todas = Intl.supportedValuesOf('timeZone');
  } catch {
    // Navegador sin `supportedValuesOf`: sólo las de México.
  }
  const mexico: string[] = [...ZONAS_MEXICO];
  const resto = todas.filter((z) => !mexico.includes(z));
  // La zona guardada siempre aparece, aunque el navegador no la liste.
  const extra = actual && !mexico.includes(actual) && !resto.includes(actual) ? [actual] : [];
  return [...mexico, ...extra, ...resto];
}
