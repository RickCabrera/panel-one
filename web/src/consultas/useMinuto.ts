import { useEffect, useMemo, useState } from 'react';

import { alturaDe } from '../paginas/resumen/comparables';

/**
 * El minuto en curso (instante truncado, ver `alturaDe`). Se revisa cada 5 s y sólo
 * re-renderiza cuando CAMBIA el minuto: así la altura de las bases queda a lo más 5 s detrás
 * del minuto real, no hasta 2 min como con un intervalo de 60 s que arranca al montar.
 *
 * Nació en el Resumen (F2-220); Comparativos (F2-140) lo comparte.
 */
export function useMinuto(): Date {
  const [minuto, setMinuto] = useState(() => alturaDe(new Date()));
  useEffect(() => {
    const id = setInterval(() => setMinuto(alturaDe(new Date())), 5_000);
    return () => clearInterval(id);
  }, []);
  return useMemo(() => new Date(minuto), [minuto]);
}
