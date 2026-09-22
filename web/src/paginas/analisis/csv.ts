import type { VentaHoraDia, VentaPorMesa, VentaPorProducto } from '../../api/tipos';
import { armarCsv, importeCsv, nombreCsv, texto } from '../../csv/csv';
import type { Rango } from '../../filtros/periodo';
import { DIAS_SEMANA, nombreMesero, type MeseroOrdenado } from './reglas';

/**
 * Los CSV de Análisis (F2-221). Mismas reglas que Reportes y Comparativos: BOM, CRLF, textos del
 * POS (mesero, producto, mesa, sucursal) con anti-inyección, importes exactos (uno ilegible
 * detiene el archivo) y SIN fila de total: el total lo saca Excel y nadie lo suma dos veces.
 * Cada CSV lleva TODAS las filas del desglose, no la página que se ve.
 */

const inv = (quien: string, v: string) => () => `${quien} trae un importe inválido ("${v}").`;

export const ENCABEZADOS_MESEROS = [
  'Posición',
  'Sucursal',
  'Mesero',
  'Venta',
  'Cuentas',
  'Ticket promedio',
  'Comensales',
  'Cuentas con comensales',
  'Propina',
  'Descuentos',
  'Cuentas con descuento',
  'Cancelaciones',
  'Monto cancelado',
] as const;

export function meserosACsv(filas: readonly MeseroOrdenado[]): string {
  return armarCsv(
    ENCABEZADOS_MESEROS,
    filas.map(({ fila: f, posicion }) => {
      const quien = `El mesero ${nombreMesero(f)} (${f.sucursal})`;
      return [
        posicion === null ? '' : String(posicion),
        texto(f.sucursal),
        texto(f.mesero),
        importeCsv(f.venta, inv(quien, f.venta)),
        String(f.cuentas),
        f.ticketPromedio === null ? '' : importeCsv(f.ticketPromedio, inv(quien, f.ticketPromedio)),
        String(f.comensales),
        String(f.cuentasConComensales),
        importeCsv(f.propina, inv(quien, f.propina)),
        importeCsv(f.descuentos.monto, inv(quien, f.descuentos.monto)),
        String(f.descuentos.cuentas),
        String(f.cancelados.cuentas),
        importeCsv(f.cancelados.monto, inv(quien, f.cancelados.monto)),
      ];
    }),
  );
}

export const ENCABEZADOS_PRODUCTOS = ['Producto', 'Importe', 'Cantidad'] as const;

/** El texto del renglón de diferencia, en pantalla y en el CSV. */
export const DIFERENCIA_CUENTAS =
  'Diferencia entre el total de las cuentas y sus partidas (descuentos, impuestos y otros ajustes)';

/**
 * Todos los productos y, al final, el renglón de diferencia: es parte del desglose (sin él las
 * filas no suman la venta), no un total; su Cantidad va vacía.
 */
export function productosACsv(datos: VentaPorProducto): string {
  return armarCsv(ENCABEZADOS_PRODUCTOS, [
    ...datos.productos.map((p) => [
      texto(p.producto),
      importeCsv(p.importe, inv(`El producto ${p.producto}`, p.importe)),
      p.cantidad,
    ]),
    [
      texto(DIFERENCIA_CUENTAS),
      importeCsv(datos.diferenciaCuentas, inv('La diferencia', datos.diferenciaCuentas)),
      '',
    ],
  ]);
}

export const ENCABEZADOS_HORA_DIA = ['Día', 'Hora', 'Venta', 'Cuentas', 'En el periodo'] as const;

/**
 * Una fila por celda (7 × 24). "Sin ventas" y "no está en el periodo" dejan Venta VACÍA (no
 * 0.00); "cero pesos" sí escribe 0.00, porque hubo cuentas.
 */
export function horaDiaACsv(datos: VentaHoraDia): string {
  const dias = new Map(datos.diasEnRango.map((d) => [d.diaSemana, d.dias]));
  const porCelda = new Map(datos.celdas.map((c) => [`${c.diaSemana}-${c.hora}`, c]));
  return armarCsv(
    ENCABEZADOS_HORA_DIA,
    DIAS_SEMANA.flatMap(({ dia, nombre }) =>
      Array.from({ length: 24 }, (_, hora) => {
        const c = porCelda.get(`${dia}-${hora}`);
        const hubo = c !== undefined && c.cuentas > 0;
        return [
          nombre,
          String(hora),
          hubo ? importeCsv(c.venta, inv(`La celda ${nombre} ${hora}:00`, c.venta)) : '',
          String(c?.cuentas ?? 0),
          (dias.get(dia) ?? 0) > 0 ? 'sí' : 'no',
        ];
      }),
    ),
  );
}

export const ENCABEZADOS_MESAS = [
  'Sucursal',
  'Mesa',
  'Cuentas',
  'Venta',
  'Minutos promedio',
  'Cuentas con duración',
] as const;

/** Las mesas en el orden de pantalla y, al final, las cuentas sin mesa (parte del desglose). */
export function mesasACsv(datos: VentaPorMesa, filas: VentaPorMesa['filas']): string {
  return armarCsv(ENCABEZADOS_MESAS, [
    ...filas.map((m) => [
      texto(m.sucursal),
      texto(m.mesa),
      String(m.cuentas),
      importeCsv(m.venta, inv(`La mesa ${m.mesa} (${m.sucursal})`, m.venta)),
      m.minutosPromedio ?? '',
      String(m.cuentasConDuracion),
    ]),
    [
      '',
      'Sin mesa',
      String(datos.sinMesa.cuentas),
      importeCsv(datos.sinMesa.venta, inv('Las cuentas sin mesa', datos.sinMesa.venta)),
      '',
      '',
    ],
  ]);
}

export type BloqueCsv = 'meseros' | 'productos' | 'hora-dia' | 'mesas';

/** `analisis-<bloque>_<desde>_<hasta>[_<sucursal>].csv`. */
export function nombreCsvAnalisis(bloque: BloqueCsv, rango: Rango, sucursal?: string): string {
  return nombreCsv(`analisis-${bloque}`, rango.desde, rango.hasta, sucursal);
}
