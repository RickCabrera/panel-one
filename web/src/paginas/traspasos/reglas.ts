import type {
  AlmacenTraspaso,
  EstadoConciliacionTraspaso,
  EstadoTraspaso,
  PartidaTraspaso,
  Traspasos,
  TraspasoResumen,
} from '../../api/tipos';

/**
 * Reglas PURAS de los traspasos (F2-124): textos, validación del alta y estados vacíos. Un
 * traspaso es del PANEL: se registra también en SoftRestaurant a mano, y el panel lo concilia
 * solo cuando la sincronización trae su salida y su entrada.
 */

export const TEXTO_ESTADO_TRASPASO: Record<EstadoTraspaso, string> = {
  enviado: 'Enviado',
  recibido: 'Recibido',
  cancelado: 'Cancelado',
};

export const TEXTO_CONCILIACION: Record<EstadoConciliacionTraspaso, string> = {
  conciliado: 'Conciliado con SR',
  pendiente_sr: 'Pendiente de registrar en SR',
  en_alerta: 'Sin registrar en SR (alerta)',
  cancelado: 'Cancelado',
};

/** El punto de color acompaña al texto; nunca lo sustituye. */
export const COLOR_CONCILIACION: Record<EstadoConciliacionTraspaso, string> = {
  conciliado: 'bg-semaforo-ok',
  pendiente_sr: 'bg-semaforo-alerta',
  en_alerta: 'bg-semaforo-rojo',
  cancelado: 'bg-semaforo-sin-dato',
};

export function nombreAlmacenTraspaso(a: {
  almacen: string | null;
  almacenOrigenSrId: string;
}): string {
  return a.almacen ?? `Almacén ${a.almacenOrigenSrId} (sin catálogo)`;
}

export function origenDe(t: TraspasoResumen): string {
  return `${t.sucursal} · ${t.almacenOrigen ?? `Almacén ${t.almacenOrigenSrId}`}`;
}

export function destinoDe(t: TraspasoResumen): string {
  return `${t.sucursalDestino} · ${t.almacenDestino ?? `Almacén ${t.almacenDestinoSrId}`}`;
}

export function nombreArticuloTraspaso(
  p: Pick<PartidaTraspaso, 'insumo' | 'insumoOrigenSrId'>,
): string {
  return p.insumo ?? `Insumo ${p.insumoOrigenSrId} (sin catálogo)`;
}

/** "1 de 2": renglones con salida Y entrada vigentes en SR. */
export function avanceConciliacion(t: Pick<TraspasoResumen, 'conciliados' | 'articulos'>): string {
  return `${t.conciliados} de ${t.articulos}`;
}

/** Hacen falta dos almacenes (en cualquier sucursal) para traspasar de uno a otro. */
export function puedeTraspasar(r: Pick<Traspasos, 'almacenes'>): boolean {
  return r.almacenes.length >= 2;
}

export type VacioTraspasos =
  | { tipo: 'con-datos' }
  | { tipo: 'sin-almacenes'; porque: string; falta: string }
  | { tipo: 'sin-traspasos'; porque: string; falta: string };

/**
 * ¿Hay algo que mostrar? Sin traspasos y sin dos almacenes conocidos: no hay entre qué traspasar
 * (los almacenes llegan del catálogo del POS). Con almacenes: se invita a enviar el primero.
 */
export function vacioTraspasos(r: Traspasos): VacioTraspasos {
  if (r.traspasos.length > 0) return { tipo: 'con-datos' };
  if (!puedeTraspasar(r)) {
    return {
      tipo: 'sin-almacenes',
      porque:
        r.almacenes.length === 0
          ? 'El panel todavía no conoce ningún almacén de esta empresa.'
          : 'El panel sólo conoce un almacén de esta empresa: no hay a dónde traspasar.',
      falta:
        'Los almacenes llegan del catálogo de SoftRestaurant que manda el agente de cada ' +
        'sucursal (o de su lectura de existencias). Con dos almacenes ya se puede registrar un ' +
        'traspaso.',
    };
  }
  return {
    tipo: 'sin-traspasos',
    porque: 'Todavía no hay traspasos registrados en el panel en este alcance.',
    falta:
      'Registra el primero con "Nuevo traspaso". Queda pendiente de registrar en SR hasta que la ' +
      'sincronización traiga su salida y su entrada.',
  };
}

/** La cantidad que acepta el API: decimal sin signo, hasta 3 decimales, mayor que 0. */
const CANTIDAD = /^\d{1,9}(\.\d{1,3})?$/;

export function errorCantidad(texto: string): string | null {
  const v = texto.trim();
  if (v === '') return 'Escribe la cantidad.';
  if (!CANTIDAD.test(v)) return 'Cantidad sin signo, con hasta 3 decimales.';
  if (milesimas(v) === 0n) return 'La cantidad tiene que ser mayor que 0.';
  return null;
}

export interface RenglonCaptura {
  insumoOrigenSrId: string;
  cantidad: string;
}

/** Errores del alta, en palabras. Vacío = se puede enviar. */
export function erroresAlta(op: {
  origen: { sucursalId: string; almacenOrigenSrId: string } | null;
  destino: { sucursalId: string; almacenOrigenSrId: string } | null;
  renglones: readonly RenglonCaptura[];
}): string[] {
  const errores: string[] = [];
  if (!op.origen) errores.push('Elige el almacén de origen.');
  if (!op.destino) errores.push('Elige el almacén de destino.');
  if (
    op.origen &&
    op.destino &&
    op.origen.sucursalId === op.destino.sucursalId &&
    op.origen.almacenOrigenSrId === op.destino.almacenOrigenSrId
  ) {
    errores.push('El destino es el mismo almacén que el origen.');
  }
  if (op.renglones.length === 0) errores.push('Agrega al menos un artículo.');
  const vistos = new Set<string>();
  for (const r of op.renglones) {
    if (vistos.has(r.insumoOrigenSrId)) {
      errores.push('Un artículo está repetido: junta sus cantidades en un solo renglón.');
      break;
    }
    vistos.add(r.insumoOrigenSrId);
  }
  if (op.renglones.some((r) => errorCantidad(r.cantidad) !== null)) {
    errores.push('Revisa las cantidades marcadas.');
  }
  return errores;
}

/**
 * Aviso (no bloquea) cuando se traspasa más de lo que dice la última lectura del almacén de origen:
 * la lectura puede ir atrasada, así que el panel no lo impide.
 */
export function avisoExistencia(cantidad: string, existencia: string | null): string | null {
  if (existencia === null || errorCantidad(cantidad) !== null) return null;
  const pedida = milesimas(cantidad.trim());
  const hay = milesimas(existencia);
  return pedida !== null && hay !== null && pedida > hay
    ? 'Más de lo que dice la última lectura del almacén de origen.'
    : null;
}

/** "12.5" → 12500n milésimas (con signo), sin pasar por float; null si no es un decimal. */
export function milesimas(v: string): bigint | null {
  const m = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(v);
  if (!m) return null;
  const n = BigInt(m[2]) * 1000n + BigInt((m[3] ?? '').padEnd(3, '0'));
  return m[1] === '-' ? -n : n;
}

/** Almacenes de destino posibles: todos menos el de origen. */
export function destinosPosibles(
  almacenes: readonly AlmacenTraspaso[],
  origen: { sucursalId: string; almacenOrigenSrId: string } | null,
): AlmacenTraspaso[] {
  return almacenes.filter(
    (a) =>
      !origen ||
      a.sucursalId !== origen.sucursalId ||
      a.almacenOrigenSrId !== origen.almacenOrigenSrId,
  );
}
