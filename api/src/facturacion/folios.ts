import type { PlantillaCorreo } from '../adaptadores/correo/puerto';
import { fechaLocal, instanteDesdeLocal } from '../comun/fechas';
import { escaparHtml } from '../reportes/formato';

/**
 * Control de folios del PAC (F2-110), PURO: de los paquetes comprados y los timbres contados, cuánto
 * le queda a cada paquete, cuánto hay disponible y en qué estado está el saldo. No lee ni escribe.
 *
 * - El saldo es de la PLATAFORMA: Facturama multiemisor tiene UN saldo de folios para la cuenta, y
 *   lo compra el admin_global. DECISION PROVISIONAL (nocturno): esquema-sr §2 "Control de folios".
 * - Consume un folio cada CFDI `vigente` o `cancelado` (cualquier origen: ticket, sin ticket,
 *   global, sustituto) en su `emitido_at`, y cada reserva en `timbrando` "ahora" (todavía no se
 *   sabe si timbró: se aparta). Un rechazo (reserva liberada) y una cancelación no consumen.
 * - FIFO por vencimiento: los límites de los paquetes (`compradoAt`, `venceAt`) parten el tiempo en
 *   segmentos donde el conjunto de paquetes activos es fijo; los timbres de cada segmento se
 *   asignan al activo que vence primero y aún tiene restante. Lo que no cabe es SOBREGIRO (se
 *   reporta, no se descuenta). Un paquete vencido pierde lo que le quedaba.
 */

/** La zona en que se captura la fecha de compra: el paquete no es de ninguna sucursal. */
export const ZONA_FOLIOS = 'America/Mexico_City';
/** Días antes del vencimiento en que se avisa (el mismo criterio que el CSD, F2-100). */
export const DIAS_AVISO_VIGENCIA = 30;
export const UMBRAL_POR_DEFECTO = 20;
export const MAX_CANTIDAD_PAQUETE = 1_000_000;

export interface PaqueteFolios {
  id: string;
  cantidad: number;
  compradoAt: Date;
  /** Exclusivo: en `venceAt` el paquete ya no ampara nada. */
  venceAt: Date;
}

/**
 * La compra y el vencimiento de un paquete desde el día de compra `AAAA-MM-DD` (zona de
 * `ZONA_FOLIOS`). Vence al EMPEZAR el mismo día local un año después; un 29 de febrero vence el 1
 * de marzo. DECISION PROVISIONAL (nocturno): la lectura conservadora de "12 meses a partir de la
 * compra" (vence lo antes posible). Null si el texto no es una fecha real.
 */
export function vigenciaDeCompra(dia: string): { compradoAt: Date; venceAt: Date } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) return null;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const real = new Date(Date.UTC(a, mes - 1, d));
  if (real.getUTCFullYear() !== a || real.getUTCMonth() !== mes - 1 || real.getUTCDate() !== d) {
    return null;
  }
  const siguiente = new Date(Date.UTC(a + 1, mes - 1, d));
  // 29-feb + 1 año "se desborda" al 1-mar: justo lo que se quiere.
  const diaVence = siguiente.toISOString().slice(0, 10);
  const compradoAt = instanteDesdeLocal(`${dia}T00:00:00`, ZONA_FOLIOS);
  const venceAt = instanteDesdeLocal(`${diaVence}T00:00:00`, ZONA_FOLIOS);
  if (!compradoAt || !venceAt) return null;
  return { compradoAt, venceAt };
}

/** Los límites de todos los paquetes, sin repetir y en orden: el arreglo de `width_bucket`. */
export function limitesDe(paquetes: readonly PaqueteFolios[]): Date[] {
  const ms = new Set<number>();
  for (const p of paquetes) {
    ms.add(p.compradoAt.getTime());
    ms.add(p.venceAt.getTime());
  }
  return [...ms].sort((x, y) => x - y).map((t) => new Date(t));
}

/**
 * El cubo de `width_bucket(instante, limites)` de Postgres: 0 antes del primer límite; `i` si
 * `limites[i-1] <= instante < limites[i]`; `n` desde el último. Sirve para ubicar "ahora".
 */
export function cuboDe(instante: Date, limites: readonly Date[]): number {
  const t = instante.getTime();
  let i = 0;
  while (i < limites.length && limites[i].getTime() <= t) i++;
  return i;
}

export interface AsignacionFolios {
  /** Timbres asignados a cada paquete (por id). */
  consumidos: Map<string, number>;
  /** Timbres que no cupieron en ningún paquete activo. */
  sobregiro: number;
}

/**
 * Reparte los timbres de cada cubo (`conteos[b]`, la longitud es `limites.length + 1`) entre los
 * paquetes activos del segmento, el que vence primero antes. Recorre los cubos en orden de tiempo.
 */
export function asignarFolios(
  paquetes: readonly PaqueteFolios[],
  limites: readonly Date[],
  conteos: readonly number[],
): AsignacionFolios {
  const consumidos = new Map<string, number>(paquetes.map((p) => [p.id, 0]));
  const orden = [...paquetes].sort(
    (x, y) =>
      x.venceAt.getTime() - y.venceAt.getTime() ||
      x.compradoAt.getTime() - y.compradoAt.getTime() ||
      (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
  );
  let sobregiro = 0;
  for (let b = 0; b < conteos.length; b++) {
    let pendientes = conteos[b];
    if (pendientes <= 0) continue;
    // Fuera de los límites (cubo 0 o el último) ningún paquete está activo.
    if (b > 0 && b < limites.length) {
      const desde = limites[b - 1].getTime();
      const hasta = limites[b].getTime();
      for (const p of orden) {
        if (pendientes === 0) break;
        if (p.compradoAt.getTime() > desde || p.venceAt.getTime() < hasta) continue;
        const usados = consumidos.get(p.id)!;
        const toma = Math.min(p.cantidad - usados, pendientes);
        if (toma <= 0) continue;
        consumidos.set(p.id, usados + toma);
        pendientes -= toma;
      }
    }
    sobregiro += pendientes;
  }
  return { consumidos, sobregiro };
}

export type EstadoSaldo = 'sin_control' | 'ok' | 'bajo' | 'agotado';
export type EstadoPaquete = 'vigente' | 'por_vencer' | 'agotado' | 'vencido' | 'futuro';

export interface SaldoFolios<P extends PaqueteFolios = PaqueteFolios> {
  control: boolean;
  umbralPct: number;
  /** Σ restante de los paquetes vigentes ahora (ya descontadas las reservas en emisión). */
  disponible: number;
  /** Σ cantidad de los paquetes vigentes ahora: la base del umbral. */
  vigenteTotal: number;
  /** Reservas en `timbrando` (ya descontadas de `disponible`). */
  enEmision: number;
  sobregiro: number;
  estado: EstadoSaldo;
  paquetes: Array<
    P & {
      consumidos: number;
      restantes: number;
      estado: EstadoPaquete;
      /** Días completos que le quedan; null si ya venció o todavía no empieza. */
      diasParaVencer: number | null;
    }
  >;
}

const DIA_MS = 86_400_000;

/**
 * El estado del saldo en `ahora`. `conteos` son los timbres emitidos por cubo; las `enEmision`
 * reservas se cuentan en el cubo de `ahora`.
 */
export function saldoFolios<P extends PaqueteFolios>(entrada: {
  control: boolean;
  umbralPct: number;
  paquetes: readonly P[];
  limites: readonly Date[];
  conteos: readonly number[];
  enEmision: number;
  ahora: Date;
}): SaldoFolios<P> {
  const { paquetes, limites, ahora } = entrada;
  const conteos = [...entrada.conteos];
  while (conteos.length < limites.length + 1) conteos.push(0);
  conteos[cuboDe(ahora, limites)] += entrada.enEmision;
  const { consumidos, sobregiro } = asignarFolios(paquetes, limites, conteos);
  const t = ahora.getTime();
  let disponible = 0;
  let vigenteTotal = 0;
  const filas = paquetes.map((p) => {
    const usados = consumidos.get(p.id) ?? 0;
    const restantes = p.cantidad - usados;
    const vigente = p.compradoAt.getTime() <= t && t < p.venceAt.getTime();
    if (vigente) {
      disponible += restantes;
      vigenteTotal += p.cantidad;
    }
    const diasParaVencer = vigente ? Math.floor((p.venceAt.getTime() - t) / DIA_MS) : null;
    const estado: EstadoPaquete =
      t >= p.venceAt.getTime()
        ? 'vencido'
        : t < p.compradoAt.getTime()
          ? 'futuro'
          : restantes <= 0
            ? 'agotado'
            : p.venceAt.getTime() - t <= DIAS_AVISO_VIGENCIA * DIA_MS
              ? 'por_vencer'
              : 'vigente';
    return { ...p, consumidos: usados, restantes, estado, diasParaVencer };
  });
  return {
    control: entrada.control,
    umbralPct: entrada.umbralPct,
    disponible,
    vigenteTotal,
    enEmision: entrada.enEmision,
    sobregiro,
    estado: estadoSaldo(entrada.control, disponible, vigenteTotal, entrada.umbralPct),
    paquetes: filas,
  };
}

/** Bajo = estrictamente por debajo del umbral (en el borde exacto, no); agotado = nada disponible. */
export function estadoSaldo(
  control: boolean,
  disponible: number,
  vigenteTotal: number,
  umbralPct: number,
): EstadoSaldo {
  if (!control) return 'sin_control';
  if (disponible <= 0) return 'agotado';
  return disponible * 100 < umbralPct * vigenteTotal ? 'bajo' : 'ok';
}

/** ¿Hay que avisar del vencimiento de este paquete? Con restante, vigente y a ≤ 30 días. */
export function avisaVigencia(
  p: { compradoAt: Date; venceAt: Date; restantes: number },
  ahora: Date,
): boolean {
  const t = ahora.getTime();
  if (p.restantes <= 0 || t < p.compradoAt.getTime() || t >= p.venceAt.getTime()) return false;
  return p.venceAt.getTime() - t <= DIAS_AVISO_VIGENCIA * DIA_MS;
}

// ---------------------------------------------------------------------------
// Los avisos por correo al admin_global. Sin datos de clientes: sólo cifras de la plataforma.
// ---------------------------------------------------------------------------

export const PLANTILLA_FOLIOS_BAJO = 'folios-bajo';
export const PLANTILLA_FOLIOS_POR_VENCER = 'folios-por-vencer';

/** `AAAA-MM-DD` del instante en la zona de los folios. */
export function diaFolios(instante: Date): string {
  return fechaLocal(instante, ZONA_FOLIOS).slice(0, 10);
}

function envolver(titulo: string, parrafos: readonly string[]): string {
  return (
    '<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#f9fafb;' +
    'font-family:Arial,Helvetica,sans-serif;color:#111827;">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;">' +
    '<div style="background:#0f766e;color:#ffffff;padding:16px 20px;font-size:18px;' +
    `font-weight:600;">${escaparHtml(titulo)}</div>` +
    '<div style="padding:20px;font-size:14px;line-height:1.5;">' +
    parrafos.map((p) => `<p style="margin:0 0 12px;">${escaparHtml(p)}</p>`).join('') +
    '</div></div></body></html>'
  );
}

export function plantillaFoliosBajo(s: {
  estado: 'bajo' | 'agotado';
  disponible: number;
  vigenteTotal: number;
  umbralPct: number;
}): PlantillaCorreo {
  const agotado = s.estado === 'agotado';
  const titulo = agotado ? 'Folios de timbrado AGOTADOS' : 'Saldo de folios de timbrado bajo';
  const parrafos = [
    agotado
      ? 'La plataforma se quedó sin folios de timbrado: ninguna empresa puede emitir facturas ' +
        'hasta que se registre un paquete nuevo.'
      : `Quedan ${s.disponible} de ${s.vigenteTotal} folios vigentes: por debajo del ` +
        `${s.umbralPct} % configurado.`,
    'Compra un paquete de folios al proveedor de timbrado y regístralo en Facturación → Folios.',
  ];
  return {
    nombre: PLANTILLA_FOLIOS_BAJO,
    asunto: titulo,
    html: envolver(titulo, parrafos),
    texto: [titulo, '', ...parrafos].join('\n'),
  };
}

export function plantillaFoliosPorVencer(p: {
  cantidad: number;
  restantes: number;
  compradoAt: Date;
  venceAt: Date;
}): PlantillaCorreo {
  const titulo = 'Un paquete de folios está por vencer';
  // `venceAt` es exclusivo: el último día en que sirve es el anterior.
  const ultimoDia = diaFolios(new Date(p.venceAt.getTime() - 1));
  const parrafos = [
    `El paquete de ${p.cantidad} folios comprado el ${diaFolios(p.compradoAt)} vence al terminar ` +
      `el ${ultimoDia} y todavía le quedan ${p.restantes} folios sin usar.`,
    'Los folios que no se usen antes de esa fecha se pierden. Si hace falta, compra el siguiente ' +
      'paquete con tiempo.',
  ];
  return {
    nombre: PLANTILLA_FOLIOS_POR_VENCER,
    asunto: titulo,
    html: envolver(titulo, parrafos),
    texto: [titulo, '', ...parrafos].join('\n'),
  };
}
