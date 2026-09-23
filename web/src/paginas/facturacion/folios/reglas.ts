import type {
  EstadoFolios,
  EstadoPaqueteFolios,
  EstadoSaldoFolios,
  ReporteFolios,
} from '../../../api/tipos';
import { armarCsv, texto } from '../../../csv/csv';
import { fechaHoraEn, fechaParaTabla } from '../../tickets/formato';

/**
 * Reglas puras de la pestaña "Folios" (F2-110). El paquete no es de ninguna sucursal: sus fechas se
 * dicen en la zona de la Ciudad de México (la misma en que se capturan), nunca en la del navegador.
 */

export const ZONA_FOLIOS = 'America/Mexico_City';

export const TEXTO_SALDO: Readonly<Record<EstadoSaldoFolios, string>> = {
  sin_control: 'Sin control',
  ok: 'Saldo suficiente',
  bajo: 'Saldo bajo',
  agotado: 'Sin folios',
};

export const TEXTO_PAQUETE: Readonly<Record<EstadoPaqueteFolios, string>> = {
  vigente: 'Vigente',
  por_vencer: 'Por vencer',
  agotado: 'Agotado',
  vencido: 'Vencido',
  futuro: 'Todavía no empieza',
};

/** `dd/mm/aaaa` de un instante en la zona de los folios. */
export function fechaFolios(instante: string): string {
  return fechaParaTabla(fechaHoraEn(ZONA_FOLIOS, instante).fecha);
}

/** El último día en que un paquete sirve: `venceAt` es exclusivo, así que es el día anterior. */
export function ultimoDiaUtil(venceAt: string): string {
  return fechaFolios(new Date(Date.parse(venceAt) - 1).toISOString());
}

/** `AAAA-MM-DD` de hoy en la zona de los folios (el máximo de la fecha de compra). */
export function hoyFolios(ahora: Date): string {
  return fechaHoraEn(ZONA_FOLIOS, ahora.toISOString()).fecha;
}

/** `AAAA-MM` ± meses. */
export function moverMes(mes: string, delta: number): string {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** El rango del reporte por omisión: los 12 meses que terminan en el mes en curso (CDMX). */
export function rangoPorOmision(ahora: Date): { desde: string; hasta: string } {
  const hasta = hoyFolios(ahora).slice(0, 7);
  return { desde: moverMes(hasta, -11), hasta };
}

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** `2026-09` → "septiembre de 2026". */
export function nombreMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return `${MESES[m - 1]} de ${a}`;
}

/**
 * Qué decir del saldo, en español y con qué hacer. Sin control no se dice "0": se dice que no hay
 * paquete registrado y que la emisión no se está limitando.
 */
export function explicacionSaldo(e: EstadoFolios): string {
  switch (e.estado) {
    case 'sin_control':
      return (
        'No hay ningún paquete de folios registrado: el control está apagado y la emisión no se ' +
        'limita. Registra el paquete que compraste al proveedor de timbrado para llevar el saldo.'
      );
    case 'agotado':
      return (
        'La plataforma se quedó sin folios: ninguna empresa puede emitir facturas hasta que ' +
        'registres un paquete nuevo.'
      );
    case 'bajo':
      return (
        `Quedan menos del ${e.umbralPct} % de los folios vigentes. Compra el siguiente paquete ` +
        'antes de que se agoten.'
      );
    case 'ok':
      return `Por encima del ${e.umbralPct} % de aviso.`;
  }
}

/** El porcentaje de lo vigente que queda (entero, redondeado hacia abajo); null sin vigentes. */
export function porcentajeDisponible(e: EstadoFolios): number | null {
  if (e.vigenteTotal <= 0) return null;
  return Math.max(0, Math.floor((e.disponible * 100) / e.vigenteTotal));
}

export function erroresPaquete(f: { cantidad: string; fechaCompra: string }, hoy: string) {
  const errores: { cantidad?: string; fechaCompra?: string } = {};
  const n = Number(f.cantidad);
  if (!/^\d+$/.test(f.cantidad.trim()) || n < 1 || n > 1_000_000) {
    errores.cantidad = 'Escribe cuántos folios compraste (de 1 a 1,000,000).';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.fechaCompra)) {
    errores.fechaCompra = 'Elige el día de compra.';
  } else if (f.fechaCompra > hoy) {
    errores.fechaCompra = 'La fecha de compra no puede ser futura.';
  }
  return errores;
}

/** El reporte como CSV: una fila por empresa y mes, más el total de cada mes. */
export function csvReporte(r: ReporteFolios): string {
  const encabezados = [
    'Mes',
    'Empresa',
    'Vigentes',
    'Cancelados',
    'Total',
    'Portal (ticket)',
    'Sin ticket',
    'Global',
    'Sustitutos',
  ];
  const filas = r.filas.map((f) => [
    f.mes,
    texto(f.empresa),
    String(f.vigentes),
    String(f.cancelados),
    String(f.total),
    String(f.ticket),
    String(f.manual),
    String(f.global),
    String(f.sustitutos),
  ]);
  const totales = r.totales.map((t) => [
    t.mes,
    'TOTAL',
    String(t.vigentes),
    String(t.cancelados),
    String(t.total),
    '',
    '',
    '',
    '',
  ]);
  return armarCsv(encabezados, [...filas, ...totales]);
}
