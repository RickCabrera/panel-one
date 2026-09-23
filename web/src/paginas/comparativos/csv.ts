import type { Rango } from '../../filtros/periodo';
import { aDiezmilesimas, puntosPorcentuales } from '../facturacion/tablero/reglas';
import { armarCsv, centavosCsv, ErrorCsv, importeCsv, nombreCsv, texto } from '../../csv/csv';
import {
  deltaDe,
  METRICAS,
  tieneDatos,
  type Cifras,
  type FilaOrdenada,
  type Metrica,
} from './matriz';

/**
 * El CSV de Comparativos (F2-140). Mismas reglas que los reportes (`reportes/csv.ts`): BOM,
 * CRLF, anti-inyección en el nombre de la sucursal (viene de SR), importes exactos y NINGUNA
 * fila de total (el total lo saca Excel; así nadie lo suma dos veces).
 *
 * - Una fila por sucursal, en el orden del ranking que se ve en pantalla.
 * - Sin datos en un periodo = celda VACÍA, nunca 0 ni 0.00. Lo mismo el Δ sin base y la
 *   posición de quien quedó fuera del ranking.
 * - Δ con signo `-` sólo en negativos; Δ % como número sin `%` (`12.3`, `-4.0`, `0.0`).
 * - Utilidad (F2-126): la de operación del API; sin utilidad = celda vacía, igual que sin datos.
 * - Tasa de facturación (F2-106): en porcentaje sin `%` (`68.98`) y su Δ en puntos porcentuales
 *   (`-1.25`); sin tasa = celda vacía.
 */

export const ENCABEZADOS_COMPARATIVOS: readonly string[] = [
  'Posición',
  'Sucursal',
  ...METRICAS.flatMap(({ nombre }) => [
    `${nombre} A`,
    `${nombre} B`,
    `Δ ${nombre}`,
    `Δ ${nombre} %`,
  ]),
];

function cifra(c: Cifras | null, m: Metrica, sucursal: string): string {
  if (!tieneDatos(c)) return '';
  const invalido = (v: string) => () =>
    `La sucursal ${sucursal} trae un importe inválido ("${v}").`;
  switch (m) {
    case 'venta':
      return importeCsv(c.venta, invalido(c.venta));
    case 'cuentas':
      return String(c.cuentas);
    case 'ticketPromedio':
      if (c.ticketPromedio === null) return '';
      return importeCsv(c.ticketPromedio, invalido(c.ticketPromedio));
    case 'comensales':
      return String(c.comensales);
    case 'utilidad':
      // Sin utilidad (sin costo, cortada o ilegible) = celda VACÍA, nunca 0.
      if (c.utilidad.importe === null) return '';
      return importeCsv(c.utilidad.importe, invalido(c.utilidad.importe));
    case 'tasaFacturacion': {
      if (c.tasa.valor === null) return '';
      const d = aDiezmilesimas(c.tasa.valor);
      if (d === null) {
        throw new ErrorCsv(`La sucursal ${sucursal} trae una tasa inválida ("${c.tasa.valor}").`);
      }
      return puntosPorcentuales(d);
    }
  }
}

/** `"+12.3 %"` → `12.3`; `"-4.0 %"` → `-4.0`. */
function porcentajeCsv(p: string): string {
  return p.replace(/ %$/, '').replace(/^\+/, '');
}

export function comparativosACsv(filas: readonly FilaOrdenada[]): string {
  return armarCsv(
    ENCABEZADOS_COMPARATIVOS,
    filas.map(({ fila, posicion }) => [
      posicion === null ? '' : String(posicion),
      texto(fila.nombre),
      ...METRICAS.flatMap(({ metrica, dinero }) => {
        const a = cifra(fila.a, metrica, fila.nombre);
        const b = cifra(fila.b, metrica, fila.nombre);
        const d = deltaDe(fila, metrica);
        if (d.tipo === 'sinBase') return [a, b, '', ''];
        return [
          a,
          b,
          dinero
            ? centavosCsv(d.diferencia)
            : metrica === 'tasaFacturacion'
              ? puntosPorcentuales(d.diferencia)
              : d.diferencia.toString(),
          porcentajeCsv(d.porcentaje),
        ];
      }),
    ]),
  );
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** `comparativos_<A.desde>_<A.hasta>_vs_<B.desde>_<B.hasta>[_<sucursal>].csv`. */
export function nombreCsvComparativos(a: Rango, b: Rango, sucursal?: string): string {
  for (const dia of [a.desde, a.hasta, b.desde, b.hasta]) {
    if (!DIA.test(dia)) throw new ErrorCsv(`Fecha inválida en el periodo ("${dia}").`);
  }
  // El saneamiento del nombre de la sucursal es el de siempre (`nombreCsv`); las cuatro
  // fechas ya se validaron arriba.
  return nombreCsv('comparativos', a.desde, `${a.hasta}_vs_${b.desde}_${b.hasta}`, sucursal);
}
