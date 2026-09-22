import type { CuentaObservada } from './evaluador';

/**
 * Lectura de las cuentas del snapshot de mesas para el evaluador (F2-224). Misma forma
 * PROVISIONAL que lee el web (`leerMesa`, web/src/paginas/mesas/mesa.ts; SUPUESTO,
 * esquema-sr.md §5): `folio`, `mesa`, `abiertoAt` (ISO con zona, reloj del POS), `impreso`.
 * Defensiva campo por campo: lo que no se entiende no se mide (nunca un 0 inventado).
 */

function texto(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function instante(v: unknown): number | null {
  // Sólo ISO con zona explícita, como el web: una fecha sin zona se leería en la del servidor.
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Minutos ENTEROS que lleva abierta: la regla `minutosAbierta` del web.
 * `capturadoAt − abiertoAt` son dos horas del MISMO reloj (la PC del POS); lo que pasó
 * después de la captura se suma con la edad de RECEPCIÓN (reloj del servidor). Una apertura
 * posterior a la captura es inconsistente: no se mide.
 */
export function minutosAbierta(
  abiertoAt: number,
  capturadoAt: number,
  edadRecepcionS: number,
): number | null {
  const abiertaAlCapturar = capturadoAt - abiertoAt;
  if (abiertaAlCapturar < 0) return null;
  return Math.floor((abiertaAlCapturar / 1000 + edadRecepcionS) / 60);
}

/**
 * Las cuentas rastreables de un snapshot. Sin folio, o con un folio repetido dentro del mismo
 * snapshot, una cuenta no tiene identidad entre lecturas y no se rastrea (se ve en el Monitor,
 * pero no abre alerta). Tampoco las que no tienen hora de apertura medible.
 */
export function cuentasDelSnapshot(
  payload: unknown,
  capturadoAt: Date,
  edadRecepcionS: number,
): CuentaObservada[] {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const mesas = (payload as { mesas?: unknown }).mesas;
  if (!Array.isArray(mesas)) return [];
  const leidas = mesas
    .filter(
      (m): m is Record<string, unknown> => m !== null && typeof m === 'object' && !Array.isArray(m),
    )
    .map((m) => ({
      folio: texto(m.folio),
      mesa: texto(m.mesa),
      abiertoAt: instante(m.abiertoAt),
      impreso: typeof m.impreso === 'boolean' ? m.impreso : null,
    }));
  const vistos = new Map<string, number>();
  for (const m of leidas) {
    if (m.folio !== null) vistos.set(m.folio, (vistos.get(m.folio) ?? 0) + 1);
  }
  const salida: CuentaObservada[] = [];
  for (const m of leidas) {
    if (m.folio === null || vistos.get(m.folio)! > 1 || m.abiertoAt === null) continue;
    const minutos = minutosAbierta(m.abiertoAt, capturadoAt.getTime(), edadRecepcionS);
    if (minutos === null) continue;
    salida.push({ folio: m.folio, mesa: m.mesa, minutos, impreso: m.impreso });
  }
  return salida;
}

/** El día local (AAAA-MM-DD) de un instante en una zona IANA. */
export function diaLocal(instanteMs: number, zona: string): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instanteMs));
  const p = (t: Intl.DateTimeFormatPartTypes) => partes.find((x) => x.type === t)!.value;
  return `${p('year')}-${p('month')}-${p('day')}`;
}

/** `dia` menos `n` días de calendario (aritmética sobre la medianoche UTC: sin horario de verano). */
export function restarDias(dia: string, n: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}
