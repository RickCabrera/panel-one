import type { Prisma } from '@prisma/client';

import { valorDe } from '../ingesta/existencias';

/**
 * La conciliación de los traspasos del panel contra SoftRestaurant (F2-124), PURA: de los
 * renglones por conciliar y los movimientos de SR candidatos, qué espejo le toca a cada renglón.
 * No lee nada ni escribe nada.
 *
 * Un renglón (insumo, cantidad q) de un traspaso de A (origen) a B (destino) queda conciliado
 * cuando tiene DOS espejos en `movimientos_inventario` (F2-122):
 * - salida: póliza `traspaso_salida` NO cancelada en la sucursal y almacén de ORIGEN, mismo
 *   insumo, cantidad exactamente −q, con |fecha − enviado| ≤ 1 día;
 * - entrada: póliza `traspaso_entrada` NO cancelada en la sucursal y almacén de DESTINO, mismo
 *   insumo, cantidad exactamente +q, con fecha en [enviado − 1 día, (recibido ?? enviado) + 1 día].
 *
 * DECISION PROVISIONAL (nocturno): "fecha ± 1 día" de la ficha = 24 h ABSOLUTAS, no días de
 * calendario; la cantidad se compara EXACTA (NUMERIC(12,3)); no se exige la `referencia` del
 * documento de SR (no se sabe si SR la llena). esquema-sr §10 "Traspasos".
 */

export const VENTANA_ESPEJO_MS = 24 * 60 * 60 * 1000;

type D = Prisma.Decimal;

/** Un espejo: el renglón de una póliza de SR. Sobrevive a una corrección de la póliza. */
export interface Espejo {
  polizaId: string;
  renglon: number;
}

export interface RenglonAConciliar {
  partidaId: string;
  sucursalOrigenId: string;
  almacenOrigen: string;
  sucursalDestinoId: string;
  almacenDestino: string;
  insumo: string;
  /** Siempre > 0. */
  cantidad: D;
  enviadoAt: number;
  recibidoAt: number | null;
  salida: Espejo | null;
  entrada: Espejo | null;
}

export interface MovimientoCandidato extends Espejo {
  sucursalId: string;
  almacen: string;
  insumo: string;
  /** CON SIGNO, como lo guarda F2-122. */
  cantidad: D;
  fecha: number;
  tipo: 'traspaso_salida' | 'traspaso_entrada';
  cancelada: boolean;
}

export const llaveEspejo = (e: Espejo) => `${e.polizaId}#${e.renglon}`;

export function sirveDeSalida(r: RenglonAConciliar, m: MovimientoCandidato): boolean {
  return (
    m.tipo === 'traspaso_salida' &&
    !m.cancelada &&
    m.sucursalId === r.sucursalOrigenId &&
    m.almacen === r.almacenOrigen &&
    m.insumo === r.insumo &&
    m.cantidad.equals(r.cantidad.negated()) &&
    Math.abs(m.fecha - r.enviadoAt) <= VENTANA_ESPEJO_MS
  );
}

export function sirveDeEntrada(r: RenglonAConciliar, m: MovimientoCandidato): boolean {
  return (
    m.tipo === 'traspaso_entrada' &&
    !m.cancelada &&
    m.sucursalId === r.sucursalDestinoId &&
    m.almacen === r.almacenDestino &&
    m.insumo === r.insumo &&
    m.cantidad.equals(r.cantidad) &&
    m.fecha >= r.enviadoAt - VENTANA_ESPEJO_MS &&
    m.fecha <= (r.recibidoAt ?? r.enviadoAt) + VENTANA_ESPEJO_MS
  );
}

export interface Asignacion {
  salida: Espejo | null;
  entrada: Espejo | null;
}

/**
 * Qué espejo le toca a cada renglón.
 *
 * 1. Un espejo que el renglón ya tenía se CONSERVA si sigue sirviendo (una corrección de costo de
 *    la póliza no lo mueve); si ya no sirve (SR canceló la póliza, cambió el artículo o la
 *    cantidad, o el renglón desapareció) se suelta.
 * 2. A lo que falte se le busca uno libre: ni conservado por otro renglón ni en `ocupados`
 *    (espejos de renglones que no están en esta vuelta). Gana el de fecha más cercana (a
 *    `enviado` para la salida; a `recibido ?? enviado` para la entrada), luego póliza y renglón.
 *    Los renglones van en el orden recibido (el llamador los ordena por envío y folio).
 *
 * Determinista: mismas entradas, misma salida. Correrlo sobre su propia salida no cambia nada.
 */
export function conciliarRenglones(
  renglones: readonly RenglonAConciliar[],
  candidatos: readonly MovimientoCandidato[],
  ocupados: ReadonlySet<string> = new Set(),
): Map<string, Asignacion> {
  const porLlave = new Map(candidatos.map((m) => [llaveEspejo(m), m]));
  const usados = new Set(ocupados);
  const salida = new Map<string, Asignacion>();

  const conserva = (e: Espejo | null, sirve: (m: MovimientoCandidato) => boolean) => {
    if (e === null) return null;
    const m = porLlave.get(llaveEspejo(e));
    if (!m || !sirve(m) || usados.has(llaveEspejo(e))) return null;
    usados.add(llaveEspejo(e));
    return { polizaId: e.polizaId, renglon: e.renglon };
  };
  for (const r of renglones) {
    salida.set(r.partidaId, {
      salida: conserva(r.salida, (m) => sirveDeSalida(r, m)),
      entrada: conserva(r.entrada, (m) => sirveDeEntrada(r, m)),
    });
  }

  const ordenados = [...candidatos].sort(
    (a, b) => a.polizaId.localeCompare(b.polizaId) || a.renglon - b.renglon,
  );
  const mejor = (sirve: (m: MovimientoCandidato) => boolean, ancla: number) => {
    let elegido: MovimientoCandidato | null = null;
    for (const m of ordenados) {
      if (usados.has(llaveEspejo(m)) || !sirve(m)) continue;
      if (elegido === null || Math.abs(m.fecha - ancla) < Math.abs(elegido.fecha - ancla)) {
        elegido = m;
      }
    }
    if (elegido === null) return null;
    usados.add(llaveEspejo(elegido));
    return { polizaId: elegido.polizaId, renglon: elegido.renglon };
  };
  for (const r of renglones) {
    const a = salida.get(r.partidaId)!;
    if (a.salida === null) a.salida = mejor((m) => sirveDeSalida(r, m), r.enviadoAt);
    if (a.entrada === null) {
      a.entrada = mejor((m) => sirveDeEntrada(r, m), r.recibidoAt ?? r.enviadoAt);
    }
  }
  return salida;
}

export const iguales = (a: Espejo | null, b: Espejo | null) =>
  a === null ? b === null : b !== null && a.polizaId === b.polizaId && a.renglon === b.renglon;

/** Estado de conciliación que ve el panel. */
export type EstadoConciliacion = 'conciliado' | 'pendiente_sr' | 'en_alerta' | 'cancelado';

/**
 * - cancelado: el traspaso se canceló (no se espera nada de SR);
 * - conciliado: todos sus renglones tienen salida y entrada en SR;
 * - en_alerta: no conciliado y enviado hace MÁS de `umbralHoras` (en el borde exacto, no);
 * - pendiente_sr: lo demás ("pendiente de registrar en SR").
 */
export function estadoConciliacion(op: {
  estado: 'enviado' | 'recibido' | 'cancelado';
  conciliadoAt: Date | null;
  enviadoAt: Date;
  ahora: number;
  umbralHoras: number;
}): EstadoConciliacion {
  if (op.estado === 'cancelado') return 'cancelado';
  if (op.conciliadoAt !== null) return 'conciliado';
  return op.ahora - op.enviadoAt.getTime() > op.umbralHoras * 3_600_000
    ? 'en_alerta'
    : 'pendiente_sr';
}

/**
 * Importe de un renglón: la `valorDe` de F2-121 (round(cantidad × costo, 2) mitad lejos de cero).
 * Sin costo (el origen no tenía lectura de ese artículo) es nulo, nunca 0.
 */
export function importeDe(cantidad: D, costo: D | null): D | null {
  return costo === null ? null : valorDe(cantidad, costo);
}
