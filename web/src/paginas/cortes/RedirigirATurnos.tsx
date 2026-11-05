import { Navigate, useLocation } from 'react-router';

import { queryDeTurnos, RUTA_TURNOS } from './reglas';

/**
 * UI-01: `/cortes` (la ruta del MVP) lleva a `/turnos` con el MISMO query (alcance, periodo y el
 * turno del detalle: `?corte=<id>` pasa a `?turno=<id>`), reemplazando la entrada del historial
 * para que "atrás" no rebote aquí.
 */
export function RedirigirATurnos() {
  const { search, hash } = useLocation();
  const query = queryDeTurnos(new URLSearchParams(search)).toString();
  return <Navigate to={`${RUTA_TURNOS}${query ? `?${query}` : ''}${hash}`} replace />;
}
