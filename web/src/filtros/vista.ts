import { PARAM_EMPRESA, PARAM_SUCURSAL } from './alcance';
import { PARAM_DESDE, PARAM_HASTA, PARAM_PERIODO } from './periodo';

/**
 * Lo que viaja al cambiar de vista (F2-212): el alcance y el periodo. Así un enlace del
 * menú o de la cabecera abre la otra vista con la misma empresa, sucursal y periodo.
 * Lo propio de cada vista (`pagina`, `folio`, `tab`) se queda en ella.
 */
export const PARAMS_VISTA = [
  PARAM_EMPRESA,
  PARAM_SUCURSAL,
  PARAM_PERIODO,
  PARAM_DESDE,
  PARAM_HASTA,
] as const;

/** El query string compartido de la vista actual (`?empresa=…&periodo=…`), o `''`. */
export function queryVista(parametros: URLSearchParams): string {
  const compartidos = new URLSearchParams();
  for (const clave of PARAMS_VISTA) {
    const valor = parametros.get(clave);
    if (valor) compartidos.set(clave, valor);
  }
  const texto = compartidos.toString();
  return texto ? `?${texto}` : '';
}

/**
 * Las vistas que filtran por periodo: sólo en ellas la cabecera pinta el selector. En las
 * demás (el monitor es en vivo, Administración y Mi cuenta no tienen periodo) el periodo
 * sigue en la URL y reaparece al volver. Una vista nueva con periodo se agrega aquí.
 */
export const VISTAS_CON_PERIODO: readonly string[] = [
  '/',
  '/resumen',
  '/comparativos',
  '/analisis',
  '/tickets',
  '/reportes',
];

export function usaPeriodo(pathname: string): boolean {
  // `/tickets/` también es Tickets para el router.
  const ruta = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return VISTAS_CON_PERIODO.includes(ruta || '/');
}
