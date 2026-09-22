import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

import { useAlcance } from './alcance';
import { escribirPeriodo, leerPeriodo, rangoDe, zonaDelPanel, type Periodo } from './periodo';
import { useHoy } from './useHoy';

/**
 * El periodo de la URL ya resuelto (F2-212): el mismo cálculo para la cabecera y para
 * cada vista que filtra por periodo, así nunca pueden discrepar en qué días se ven.
 * `rango` es `null` si el rango a mano no es válido: con él no se consulta.
 */
export function usePeriodo() {
  const { sucursal, sucursales } = useAlcance();
  const [parametros, setParametros] = useSearchParams();
  const periodo = leerPeriodo(parametros);

  const zona = zonaDelPanel(sucursal, sucursales.data);
  const hoy = useHoy(zona);
  const rango = rangoDe(periodo, hoy);

  const cambiarPeriodo = useCallback(
    (nuevo: Periodo) => setParametros((previos) => escribirPeriodo(previos, nuevo)),
    [setParametros],
  );

  return { periodo, rango, hoy, zona, cambiarPeriodo };
}
