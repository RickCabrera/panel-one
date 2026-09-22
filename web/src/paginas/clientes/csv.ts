import type { FilaResumenCliente } from '../../api/tipos';
import { armarCsv, importeCsv, nombreCsv, texto } from '../../csv/csv';
import type { Rango } from '../../filtros/periodo';
import { estadoFila } from './reglas';

/**
 * El CSV de Clientes (F2-232). Mismas reglas que los otros CSV: BOM, CRLF, textos con
 * anti-inyección e importes exactos (uno ilegible detiene el archivo).
 *
 * Por defecto NO lleva datos personales: cada cliente va por su clave o su id del POS. El
 * nombre, el teléfono, el correo y el RFC sólo entran si el usuario lo pidió explícitamente
 * (`contacto`), y sólo entonces se piden a la API.
 */

export const ENCABEZADOS_CLIENTES = [
  'Sucursal',
  'Clave',
  'Id del POS',
  'Estado',
  'Visitas',
  'Venta',
  'Ticket promedio',
  'Última visita (UTC)',
  'Canceladas',
  'Monto cancelado',
] as const;

export const ENCABEZADOS_CONTACTO = ['Nombre', 'Teléfono', 'Correo', 'RFC'] as const;

export function clientesACsv(filas: readonly FilaResumenCliente[], contacto: boolean): string {
  const encabezados = contacto
    ? [...ENCABEZADOS_CLIENTES, ...ENCABEZADOS_CONTACTO]
    : [...ENCABEZADOS_CLIENTES];
  return armarCsv(
    encabezados,
    filas.map((f) => {
      const quien = `El cliente ${f.clave ?? f.origenSrId} (${f.sucursal})`;
      const inv = (v: string) => () => `${quien} trae un importe inválido ("${v}").`;
      const base = [
        texto(f.sucursal),
        texto(f.clave),
        texto(f.origenSrId),
        texto(estadoFila(f)),
        String(f.visitas),
        importeCsv(f.venta, inv(f.venta)),
        f.ticketPromedio === null ? '' : importeCsv(f.ticketPromedio, inv(f.ticketPromedio)),
        f.ultimaVisita ?? '',
        String(f.canceladas.cuentas),
        importeCsv(f.canceladas.monto, inv(f.canceladas.monto)),
      ];
      return contacto
        ? [
            ...base,
            texto(f.nombre),
            texto(f.telefono ?? null),
            texto(f.correo ?? null),
            texto(f.rfc ?? null),
          ]
        : base;
    }),
  );
}

/** `clientes_<desde>_<hasta>[_<sucursal>].csv`. */
export function nombreCsvClientes(rango: Rango, sucursal?: string): string {
  return nombreCsv('clientes', rango.desde, rango.hasta, sucursal);
}
