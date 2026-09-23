import type {
  CfdiFila,
  ResumenConciliacion,
  Sucursal,
  TableroFacturacion,
} from '../../../api/tipos';
import { armarCsv, ErrorCsv, importeCsv, texto, textoExcel } from '../../../csv/csv';
import { aCentavos, paraGrafica } from '../../../dinero/dinero';
import { fechaHoraEn } from '../../tickets/formato';

/**
 * Reglas puras del tablero de facturación (F2-106). Ninguna cifra se calcula aquí: todas son las
 * que manda `GET /facturacion/tablero`. Lo propio es el formato (la tasa como porcentaje, en
 * `bigint`), los puntos de las gráficas y el CSV de la tabla.
 */

const TASA = /^(-?)(\d+)(?:\.(\d{1,4}))?$/;

/** `"0.6898"` → `6898n` (diezmilésimas). Lo que no sea un decimal de hasta 4 cifras → `null`. */
export function aDiezmilesimas(tasa: string): bigint | null {
  const partes = TASA.exec(tasa.trim());
  if (!partes) return null;
  const [, signo, enteros, decimales = ''] = partes;
  const valor = BigInt(enteros) * 10_000n + BigInt(decimales.padEnd(4, '0'));
  return signo === '-' ? -valor : valor;
}

/**
 * La tasa como porcentaje con 2 decimales, exacto (`"0.6898"` → `"68.98 %"`): una diezmilésima es
 * una centésima de punto, así que no hay redondeo ni float. `null` → `null` (la vista pinta "—").
 */
export function tasaTexto(tasa: string | null): string | null {
  if (tasa === null) return null;
  const d = aDiezmilesimas(tasa);
  if (d === null) return 'Tasa inválida';
  return `${puntosPorcentuales(d)} %`;
}

/**
 * Diezmilésimas → puntos porcentuales con 2 decimales, sin `%` (`6898n` → `"68.98"`,
 * `-125n` → `"-1.25"`). Exacto: una diezmilésima es una centésima de punto.
 */
export function puntosPorcentuales(d: bigint): string {
  const negativo = d < 0n;
  const abs = negativo ? -d : d;
  return `${negativo ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** Sólo para dibujar (Recharts pide `number`). Un importe ilegible se dibuja en 0. */
const aGrafica = (importe: string) => paraGrafica(aCentavos(importe) ?? 0n);

export interface PuntoSucursal {
  sucursalId: string;
  nombre: string;
  venta: number;
  facturado: number;
  ventaTexto: string;
  facturadoTexto: string;
  /** F2-108: la factura global de la sucursal, aparte (no suma a la tasa). */
  globalTexto: string;
  tasa: string | null;
}

export function puntosSucursal(t: TableroFacturacion): PuntoSucursal[] {
  return t.porSucursal.map((s) => ({
    sucursalId: s.sucursalId,
    nombre: s.nombre,
    venta: aGrafica(s.venta),
    facturado: aGrafica(s.facturado),
    ventaTexto: s.venta,
    facturadoTexto: s.facturado,
    globalTexto: s.global.monto,
    tasa: s.tasa,
  }));
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** `2026-09` → `sep 2026`. */
export function etiquetaMes(mes: string): string {
  const [anio, m] = mes.split('-');
  return `${MESES[Number(m) - 1] ?? m} ${anio}`;
}

export interface PuntoSerie {
  etiqueta: string;
  valor: number;
  texto: string;
  cfdis: number;
}

export function puntosMes(t: TableroFacturacion): PuntoSerie[] {
  return t.porMes.map((m) => ({
    etiqueta: etiquetaMes(m.mes),
    valor: aGrafica(m.facturado),
    texto: m.facturado,
    cfdis: m.cfdis,
  }));
}

export function puntosHora(t: TableroFacturacion): PuntoSerie[] {
  return t.porHora.map((h) => ({
    etiqueta: `${String(h.hora).padStart(2, '0')}:00`,
    valor: aGrafica(h.facturado),
    texto: h.facturado,
    cfdis: h.cfdis,
  }));
}

/**
 * Por qué el tablero no tiene facturas, dicho en claro (regla de estados vacíos de la Ronda 2):
 * sin ventas en el periodo no hay nada que facturar; con ventas y sin CFDI, nadie facturó todavía.
 * `null` = sí hay CFDI (o cancelados) en el periodo.
 */
export function motivoSinFacturas(t: TableroFacturacion): string | null {
  if (t.facturado.cfdis > 0 || t.cancelados.cfdis > 0 || t.global.cfdis > 0) return null;
  if (t.ventas.cuentas === 0) {
    return 'No hay ventas en este periodo: no hay nada que facturar. Elige otro periodo o revisa que la sucursal esté sincronizando.';
  }
  return 'No se emitió ninguna factura en este periodo. Los clientes facturan desde el portal de autofactura con el código de su ticket; para que puedan hacerlo, la empresa necesita sus datos fiscales y un CSD vigente (pestaña Datos fiscales).';
}

/**
 * F2-110b: el resumen de una vuelta de conciliación con el PAC, en frases. Sin nada que resolver lo
 * dice (nunca una lista de ceros).
 */
export function textoConciliacion(r: ResumenConciliacion): string[] {
  const n = (x: number, uno: string, varios: string) => `${x} ${x === 1 ? uno : varios}`;
  const frases: string[] = [];
  const { reservas: res, cancelaciones: can, sustituciones: sus, archivos: arc } = r;
  if (res.confirmadas > 0) {
    frases.push(
      `${n(res.confirmadas, 'factura que el PAC sí timbró quedó confirmada y se entregó', 'facturas que el PAC sí timbró quedaron confirmadas y se entregaron')}.`,
    );
  }
  if (res.liberadas > 0) {
    frases.push(
      `${n(res.liberadas, 'emisión que el PAC nunca timbró se liberó', 'emisiones que el PAC nunca timbró se liberaron')}: sus tickets se pueden volver a facturar.`,
    );
  }
  if (res.enEspera > 0) {
    frases.push(
      `${n(res.enEspera, 'emisión no aparece', 'emisiones no aparecen')} en el PAC todavía: se vuelve a buscar en 15 minutos antes de liberarla.`,
    );
  }
  if (can.canceladas > 0) {
    frases.push(
      `${n(can.canceladas, 'cancelación que el PAC registró tarde quedó anotada', 'cancelaciones que el PAC registró tarde quedaron anotadas')}.`,
    );
  }
  if (can.descartadas > 0) {
    frases.push(
      `${n(can.descartadas, 'cancelación sin confirmar se descartó', 'cancelaciones sin confirmar se descartaron')} (la factura sigue vigente o ya estaba cancelada).`,
    );
  }
  if (sus.cerradas > 0) {
    frases.push(
      `${n(sus.cerradas, 'refacturación terminó', 'refacturaciones terminaron')}: la factura anterior quedó cancelada con motivo 01.`,
    );
  }
  if (arc.recuperados > 0) {
    frases.push(
      `${n(arc.recuperados, 'factura recuperó', 'facturas recuperaron')} su XML y PDF del PAC.`,
    );
  }
  if (r.fallidas > 0) {
    frases.push(
      `${n(r.fallidas, 'caso no se pudo resolver', 'casos no se pudieron resolver')} (el PAC falló o no dio una respuesta clara): se reintentan solos.`,
    );
  }
  if (r.requierenRevision.length > 0) {
    frases.push(
      `Revisar a mano en el PAC: ${r.requierenRevision.join(', ')} (confirmadas, pero el PAC ya las reporta canceladas).`,
    );
  }
  if (frases.length === 0) {
    const revisados = res.revisadas + can.revisadas + sus.revisadas + arc.revisados;
    // Revisar algo que sigue igual no es "nada pendiente": se dice que sigue pendiente.
    frases.push(
      revisados > 0
        ? `Se ${revisados === 1 ? 'revisó 1 caso' : `revisaron ${revisados} casos`} con el PAC ` +
            'y todavía no cambia nada: se vuelve a revisar solo.'
        : 'No había nada pendiente con el PAC: ninguna emisión colgada, cancelación sin ' +
            'confirmar, refacturación a medias ni factura sin archivos.',
    );
  }
  return frases;
}

export const ENCABEZADOS_CSV = [
  'UUID',
  'Serie-folio',
  'Sucursal',
  'Fecha',
  'Hora',
  'RFC receptor',
  'Receptor',
  'Total',
  'Estado',
  'Folio del ticket',
] as const;

/**
 * El CSV de la tabla de CFDI (reglas comunes de `csv/csv.ts`: BOM, CRLF, anti-inyección, importes
 * validados). Fecha y hora de emisión en la zona de SU sucursal; sin la sucursal no hay zona, y
 * mejor ningún archivo que uno con la hora equivocada.
 */
export function cfdisACsv(
  cfdis: readonly CfdiFila[],
  sucursales: ReadonlyMap<string, Sucursal>,
): string {
  const filas = cfdis.map((c) => {
    const sucursal = sucursales.get(c.sucursalId);
    if (!sucursal) {
      throw new ErrorCsv(`La factura ${c.serieFolio} es de una sucursal que no está en tu lista.`);
    }
    const { fecha, hora } = fechaHoraEn(sucursal.zonaHoraria, c.emitidoAt);
    return [
      texto(c.uuid),
      textoExcel(c.serieFolio),
      texto(sucursal.nombre),
      fecha,
      hora,
      texto(c.receptorRfc),
      texto(c.receptorNombre),
      importeCsv(
        c.total,
        () => `La factura ${c.serieFolio} trae un total inválido ("${c.total}").`,
      ),
      c.estado === 'vigente' ? 'Vigente' : 'Cancelada',
      textoExcel(c.folioTicket),
    ];
  });
  return armarCsv(ENCABEZADOS_CSV, filas);
}
