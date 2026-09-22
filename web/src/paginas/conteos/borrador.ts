/**
 * El borrador local de un conteo (F2-123): lo capturado que TODAVÍA no confirma el servidor.
 *
 * Cada valor se escribe aquí ANTES de mandarse. Si el celular bloquea la pantalla, se queda sin
 * red o se recarga la página a media captura, al volver el borrador se pinta encima de lo del
 * servidor y se reenvía. Sólo se borra lo que el servidor confirmó con ESE mismo valor.
 *
 * - La llave lleva usuario + empresa + conteo: en una tablet compartida el borrador de un usuario
 *   nunca se reenvía con la sesión de otro.
 * - `localStorage` puede no existir o lanzar (modo privado, cuota): todo va en try/catch y la
 *   captura sigue funcionando, sólo que sin esa red de seguridad.
 * - DECISION PROVISIONAL (nocturno): gana el último en llegar al servidor. Un borrador viejo de
 *   este dispositivo, reenviado al volver, puede pisar un valor más nuevo que otro dispositivo
 *   capturó en el mismo renglón (esquema-sr §10).
 */

/** insumoOrigenSrId → lo capturado (texto ya normalizado) o `null` = borrar lo capturado. */
export type Borrador = Readonly<Record<string, string | null>>;

const PREFIJO = 'monitor:conteo-borrador';

export function llaveBorrador(usuarioId: string, empresaId: string, conteoId: string): string {
  return `${PREFIJO}:${usuarioId}:${empresaId}:${conteoId}`;
}

function esBorrador(v: unknown): v is Borrador {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => x === null || (typeof x === 'string' && CANTIDAD.test(x)))
  );
}

export function leerBorrador(llave: string): Borrador {
  try {
    const crudo = window.localStorage.getItem(llave);
    if (crudo === null) return {};
    const v: unknown = JSON.parse(crudo);
    return esBorrador(v) ? v : {};
  } catch {
    return {};
  }
}

export function guardarBorrador(llave: string, b: Borrador): void {
  try {
    if (Object.keys(b).length === 0) window.localStorage.removeItem(llave);
    else window.localStorage.setItem(llave, JSON.stringify(b));
  } catch {
    // Sin almacenamiento: la captura sigue, sin red de seguridad.
  }
}

/** La misma regla que el API (`CANTIDAD_NO_NEGATIVA`): sin signo, hasta 3 decimales. */
export const CANTIDAD = /^\d{1,9}(\.\d{1,3})?$/;

export type LecturaCantidad = { ok: true; valor: string | null } | { ok: false; error: string };

/**
 * Lo que se tecleó, como lo manda el API. Vacío = borrar lo capturado. Acepta coma decimal (el
 * teclado numérico del celular en español la pone) y la vuelve punto. Más de 3 decimales, signo
 * o letras = error: nunca se redondea en silencio.
 */
export function leerCantidad(texto: string): LecturaCantidad {
  const t = texto.trim().replace(',', '.');
  if (t === '') return { ok: true, valor: null };
  if (!CANTIDAD.test(t)) {
    return { ok: false, error: 'Escribe una cantidad sin signo, con hasta 3 decimales.' };
  }
  return { ok: true, valor: t };
}

/** "12.5" y "12.500" son la misma cantidad: se comparan en milésimas, sin floats. */
export function mismaCantidad(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const mil = (v: string) => {
    const [ent, dec = ''] = v.split('.');
    return BigInt(ent) * 1000n + BigInt((dec + '000').slice(0, 3));
  };
  return mil(a) === mil(b);
}

export function conValor(b: Borrador, insumo: string, valor: string | null): Borrador {
  return { ...b, [insumo]: valor };
}

/**
 * Quita del borrador lo que el servidor confirmó, SÓLO si el borrador todavía tiene ese mismo
 * valor: si el usuario lo cambió mientras viajaba la petición, el cambio nuevo se queda
 * pendiente.
 */
export function sinConfirmados(
  b: Borrador,
  guardadas: ReadonlyArray<{ insumoOrigenSrId: string; contado: string | null }>,
): Borrador {
  const quedan: Record<string, string | null> = { ...b };
  for (const g of guardadas) {
    if (g.insumoOrigenSrId in quedan && mismaCantidad(quedan[g.insumoOrigenSrId], g.contado)) {
      delete quedan[g.insumoOrigenSrId];
    }
  }
  return quedan;
}

/** Lo que se manda en una petición: hasta `max` renglones pendientes (el API acepta 500). */
export function loteDe(b: Borrador, max = 500) {
  return Object.entries(b)
    .slice(0, max)
    .map(([insumoOrigenSrId, contado]) => ({ insumoOrigenSrId, contado }));
}
