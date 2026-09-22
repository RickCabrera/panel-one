import { useEffect, useState } from 'react';

import { horaEn, hoyEn } from './periodo';

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

/**
 * La hora en curso (0–23) en `zona`, revisada cada minuto: la gráfica de "Hoy"
 * termina ahí y avanza sola con el panel abierto (F2-201).
 */
export function useHoraEn(zona: string): number {
  const [instante, setInstante] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setInstante(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return Number(horaEn(zona, instante).slice(0, 2));
}
