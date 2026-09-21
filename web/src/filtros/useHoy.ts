import { useEffect, useState } from 'react';

import { hoyEn } from './periodo';

/**
 * El día local de hoy en `zona`, revisado cada minuto: con el panel abierto toda la
 * noche, "Hoy" pasa al día nuevo a la medianoche de la sucursal sin recargar.
 */
export function useHoy(zona: string): string {
  const [, setPulso] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPulso((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  return hoyEn(zona, new Date());
}
