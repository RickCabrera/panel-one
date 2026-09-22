import type { MesasSucursal } from '../../api/tipos';
import { sumar } from '../../dinero/dinero';
import { leerMesa, type MesaAbierta } from './mesa';

/**
 * DECISION PROVISIONAL (nocturno): cada cuánto lee el agente. El API no lo sabe
 * (F1-033); se toma el `intervaloSegundos: 30` por defecto de la config del agente
 * (F1-020). Si el intervalo termina siendo configurable por sucursal, F1-020/F1-025
 * tienen que mandarlo (heartbeat) y esta constante se vuelve un dato por sucursal.
 * Supuesto anotado en esquema-sr.md §5.
 */
export const INTERVALO_AGENTE_S = 30;

/** Backlog F1-050: "si la última lectura tiene > 3 intervalos" → desconectada. */
export const UMBRAL_DESCONEXION_S = 3 * INTERVALO_AGENTE_S;

/** Hasta aquí la lectura se ve verde; de aquí al umbral, ámbar. */
export const UMBRAL_DEMORA_S = 2 * INTERVALO_AGENTE_S;

/** Cada cuánto se consulta el monitor (backlog F1-050). */
export const POLLING_MS = 20_000;

export type Semaforo = 'ok' | 'alerta' | 'rojo' | 'sin-dato';
export type Frescura = 'fresca' | 'demorada' | 'desconectada';

/**
 * Semáforo de la mesa sobre MINUTOS ENTEROS (ya truncados por `minutosAbierta`):
 * < 40 ok · 40–60 alerta · > 60 rojo. 60 min con 59 s todavía es 60: alerta.
 */
export function semaforo(minutos: number | null): Semaforo {
  if (minutos === null) return 'sin-dato';
  if (minutos < 40) return 'ok';
  if (minutos <= 60) return 'alerta';
  return 'rojo';
}

/**
 * La edad del snapshot AHORA, en segundos enteros: la de recepción que dio el API
 * (reloj del servidor) más lo que pasó desde esa respuesta (reloj del navegador,
 * restando contra sí mismo). Si el API deja de contestar, la edad sigue creciendo y
 * la sucursal pasa sola a desconectada: la vista no se queda con la última respuesta
 * como si fuera viva.
 */
export function edadEfectiva(
  edadRecepcionSegundos: number,
  respuestaAt: number,
  ahora: number,
): number {
  return Math.floor(edadRecepcionSegundos + Math.max(0, ahora - respuestaAt) / 1000);
}

export function frescura(edadSegundos: number): Frescura {
  if (edadSegundos > UMBRAL_DESCONEXION_S) return 'desconectada';
  if (edadSegundos > UMBRAL_DEMORA_S) return 'demorada';
  return 'fresca';
}

/**
 * Minutos ENTEROS (truncados) que lleva abierta la cuenta. `capturadoAt − abiertoAt`
 * son dos horas del MISMO reloj (la PC del POS), así que un reloj desfasado no mueve
 * el resultado; lo que pasó después de la captura se suma con la edad efectiva
 * (reloj del servidor/navegador). Una apertura posterior a la captura es un dato
 * inconsistente: `null`, nunca 0.
 */
export function minutosAbierta(
  abiertoAt: number | null,
  capturadoAt: number,
  edadSegundos: number,
): number | null {
  if (abiertoAt === null || Number.isNaN(capturadoAt)) return null;
  const abiertaAlCapturar = capturadoAt - abiertoAt;
  if (abiertaAlCapturar < 0) return null;
  return Math.floor((abiertaAlCapturar / 1000 + edadSegundos) / 60);
}

export interface MesaMonitor extends MesaAbierta {
  /** Llave de React: sucursal + folio + posición en el snapshot. */
  clave: string;
  sucursalId: string;
  sucursal: string;
  minutos: number | null;
  semaforo: Semaforo;
}

export type EstadoSucursal = 'conectada' | 'desconectada' | 'sin-reporte';

export interface SucursalMonitor {
  sucursalId: string;
  nombre: string;
  estado: EstadoSucursal;
  /** Edad efectiva del último snapshot; null si nunca llegó uno. */
  edadSegundos: number | null;
  recibidoAt: number | null;
}

export interface Kpis {
  /** Mesas de las sucursales conectadas. */
  mesas: number;
  /** Σ de sus totales; null si UNA no trae total legible (no hay suma parcial). */
  enCurso: bigint | null;
  /** Cuentas con `impreso === false`; null si alguna no dice si se imprimió. */
  sinImprimir: number | null;
  /** Mesas con más de 60 minutos. */
  atencion: number;
  /** Mesas sin hora de apertura legible: ni están en `atencion` ni se esconden. */
  sinHora: number;
  /**
   * Regla (F1-094): la lectura MÁS VIEJA de las sucursales que ENTRAN en las cifras
   * (las conectadas), o sea, qué tan viejo es el dato más viejo que se está sumando.
   * Las desconectadas NO cuentan: ya tienen su banner y salen en `excluidas`, y con
   * ellas el KPI decía "hace 2 h" junto a cifras de hace segundos. Sin ninguna
   * conectada es `null` (el Monitor no pinta KPIs en ese caso). La tarjeta "Venta en
   * vivo" del Panel usa este mismo valor para su "dato de hace…".
   */
  ultimaLectura: { recibidoAt: number; edadSegundos: number; frescura: Frescura } | null;
  /** Nombres de las sucursales que no entran en las cifras. */
  excluidas: string[];
}

export interface Monitor {
  sucursales: SucursalMonitor[];
  /** Sólo de sucursales conectadas: los datos viejos nunca se pintan como vivos. */
  mesas: MesaMonitor[];
  kpis: Kpis;
}

const orden = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

/**
 * Estado de cada sucursal AHORA: conectada (su último snapshot tiene menos de
 * `UMBRAL_DESCONEXION_S` de edad efectiva), desconectada, o sin reporte (nunca llegó uno).
 */
export function estadosSucursales(
  filas: readonly MesasSucursal[],
  respuestaAt: number,
  ahora: number,
): SucursalMonitor[] {
  return filas.map((fila) => {
    const snap = fila.snapshot;
    if (!snap) {
      return {
        sucursalId: fila.sucursalId,
        nombre: fila.nombre,
        estado: 'sin-reporte',
        edadSegundos: null,
        recibidoAt: null,
      };
    }
    const edad = edadEfectiva(snap.edadRecepcionSegundos, respuestaAt, ahora);
    return {
      sucursalId: fila.sucursalId,
      nombre: fila.nombre,
      estado: frescura(edad) === 'desconectada' ? 'desconectada' : 'conectada',
      edadSegundos: edad,
      recibidoAt: Date.parse(snap.recibidoAt),
    };
  });
}

/** Las mesas de UNA sucursal, leídas y en orden de mesa, sin nada que dependa del reloj. */
function mesasDeFila(fila: MesasSucursal): Array<MesaAbierta & { clave: string }> {
  const deEsta = (fila.snapshot?.mesas ?? []).map((crudo, i) => {
    const mesa = leerMesa(crudo);
    return { ...mesa, clave: `${fila.sucursalId}:${mesa.folio ?? ''}:${i}` };
  });
  // Orden estable entre polls (sucursal, luego nº de mesa natural): ordenar por
  // urgencia haría saltar las tarjetas cada 20 s. Sin nº de mesa, al final.
  deEsta.sort((a, b) => {
    if (a.mesa === null || b.mesa === null) return a.mesa === b.mesa ? 0 : a.mesa ? -1 : 1;
    return orden.compare(a.mesa, b.mesa);
  });
  return deEsta;
}

/** Todo lo que pinta el monitor, a partir de la respuesta y la hora actual. */
export function armarMonitor(
  filas: readonly MesasSucursal[],
  respuestaAt: number,
  ahora: number,
): Monitor {
  const sucursales = estadosSucursales(filas, respuestaAt, ahora);
  const mesas: MesaMonitor[] = [];

  filas.forEach((fila, i) => {
    const s = sucursales[i];
    const snap = fila.snapshot;
    if (!snap || s.estado !== 'conectada') return;
    const capturadoAt = Date.parse(snap.capturadoAt);
    for (const mesa of mesasDeFila(fila)) {
      const minutos = minutosAbierta(mesa.abiertoAt, capturadoAt, s.edadSegundos!);
      mesas.push({
        ...mesa,
        sucursalId: fila.sucursalId,
        sucursal: fila.nombre,
        minutos,
        semaforo: semaforo(minutos),
      });
    }
  });

  const totales = mesas.map((m) => m.total);
  const impresos = mesas.map((m) => m.impreso);
  const conLectura = sucursales.filter(
    (s) => s.estado === 'conectada' && s.edadSegundos !== null && s.recibidoAt !== null,
  );
  const masVieja = conLectura.reduce<SucursalMonitor | null>(
    (peor, s) => (peor === null || s.edadSegundos! > peor.edadSegundos! ? s : peor),
    null,
  );

  return {
    sucursales,
    mesas,
    kpis: {
      mesas: mesas.length,
      enCurso: totales.every((t) => t !== null) ? sumar(totales as bigint[]) : null,
      sinImprimir: impresos.every((i) => i !== null)
        ? impresos.filter((i) => i === false).length
        : null,
      atencion: mesas.filter((m) => m.semaforo === 'rojo').length,
      sinHora: mesas.filter((m) => m.minutos === null).length,
      ultimaLectura:
        masVieja === null
          ? null
          : {
              recibidoAt: masVieja.recibidoAt!,
              edadSegundos: masVieja.edadSegundos!,
              frescura: frescura(masVieja.edadSegundos!),
            },
      excluidas: sucursales.filter((s) => s.estado !== 'conectada').map((s) => s.nombre),
    },
  };
}

// ---------------------------------------------------------------------------------
// F2-223: el Monitor separa lo que depende del reloj de lo que no. Las mesas "vivas"
// no cambian al avanzar el reloj: cada tarjeta calcula sus minutos con su propio
// `useConReloj`, y la vista sólo se vuelve a pintar cuando cambia algo de verdad.
// ---------------------------------------------------------------------------------

/** Una cuenta abierta tal como la pinta el Monitor, sin nada que dependa de la hora. */
export interface MesaViva extends MesaAbierta {
  clave: string;
  sucursalId: string;
  sucursal: string;
  /**
   * Instante de apertura con el reloj del NAVEGADOR (ms), o `null` si no se puede
   * medir (misma regla que `minutosAbierta`). Ver `aperturaEnNavegador`.
   */
  apertura: number | null;
  /** Todo lo que pinta la tarjeta, en un texto: si no cambia, la tarjeta no se pinta. */
  firma: string;
}

/**
 * La apertura de la cuenta en el reloj del navegador:
 * `respuestaAt − edadRecepcion − (capturadoAt − abiertoAt)`.
 *
 * - `capturadoAt − abiertoAt` resta dos horas del MISMO reloj (la PC del POS): el
 *   desfase de esa PC no mueve el resultado.
 * - `edadRecepcion` la mide el servidor contra su propio reloj.
 * - `respuestaAt` es el `dataUpdatedAt` de TanStack: el reloj del NAVEGADOR al recibir
 *   la respuesta, nunca una hora del servidor.
 *
 * Así, los minutos son `ahora − apertura` con `ahora` del mismo reloj del navegador, y
 * el valor no depende de la hora: avanzar el reloj no cambia la mesa.
 */
export function aperturaEnNavegador(
  abiertoAt: number | null,
  capturadoAt: number,
  edadRecepcionSegundos: number,
  respuestaAt: number,
): number | null {
  if (abiertoAt === null || Number.isNaN(capturadoAt)) return null;
  const abiertaAlCapturar = capturadoAt - abiertoAt;
  if (abiertaAlCapturar < 0) return null;
  return respuestaAt - edadRecepcionSegundos * 1000 - abiertaAlCapturar;
}

/**
 * Minutos ENTEROS (truncados) desde la apertura. Difiere de `minutosAbierta` (la que
 * usan Inicio y la cabecera vía `armarMonitor`) en menos de 2 s en el borde de un
 * minuto: `edadRecepcion` llega en segundos enteros y `estabilizarAperturas` tolera
 * 2 s de ruido. Dentro del Monitor todo (tarjeta, KPI, filtro, detalle) usa ésta, así
 * que entre sí nunca discrepan.
 */
export function minutosDesde(apertura: number | null, ahora: number): number | null {
  if (apertura === null) return null;
  return Math.floor(Math.max(0, ahora - apertura) / 60_000);
}

/** Cuánto puede moverse la apertura calculada de un poll a otro sin que sea otra. */
export const TOLERANCIA_APERTURA_MS = 2_000;

/**
 * Llave para reconocer la misma cuenta entre polls: sucursal + folio. Sin folio, o con
 * un folio repetido en el snapshot, no hay llave (esas mesas no se estabilizan).
 */
function llaveEstable(m: { sucursalId: string; folio: string | null }): string | null {
  return m.folio === null ? null : `${m.sucursalId}␟${m.folio}`;
}

/**
 * La apertura calculada tiene ruido de hasta ~1 s entre polls (la edad llega en
 * segundos enteros, más la latencia). Si la de la misma cuenta (`previas`) difiere
 * menos de `TOLERANCIA_APERTURA_MS`, se conserva la anterior: así la tarjeta no se
 * vuelve a pintar ni el orden por antigüedad salta con cada poll. Se compara siempre
 * contra la guardada, así que el error no se acumula: un cambio real (otra hora de
 * apertura) supera la tolerancia y se toma el nuevo. Devuelve el mapa para el siguiente
 * poll (sólo con las cuentas de éste).
 */
export function estabilizarAperturas<T extends MesaSinFirma>(
  mesas: readonly T[],
  previas: ReadonlyMap<string, number>,
): { mesas: T[]; aperturas: Map<string, number> } {
  const repetidas = new Set<string>();
  const vistas = new Set<string>();
  for (const m of mesas) {
    const llave = llaveEstable(m);
    if (llave === null) continue;
    if (vistas.has(llave)) repetidas.add(llave);
    vistas.add(llave);
  }
  const aperturas = new Map<string, number>();
  const salida = mesas.map((m) => {
    const llave = llaveEstable(m);
    if (llave === null || repetidas.has(llave) || m.apertura === null) return m;
    const previa = previas.get(llave);
    const apertura =
      previa !== undefined && Math.abs(previa - m.apertura) < TOLERANCIA_APERTURA_MS
        ? previa
        : m.apertura;
    aperturas.set(llave, apertura);
    return apertura === m.apertura ? m : { ...m, apertura };
  });
  return { mesas: salida, aperturas };
}

type MesaSinFirma = Omit<MesaViva, 'firma'>;

/** Texto con todo lo que pinta la tarjeta o el detalle (los importes, en centavos). */
export function firmaDe(m: MesaSinFirma): string {
  return JSON.stringify(
    [m.clave, m.sucursal, m.mesa, m.mesero, m.folio, m.total, m.comensales, m.impreso, m.apertura, m.partidas],
    (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
  );
}

/**
 * Las mesas de las sucursales `conectadas`, en el orden de siempre (sucursal y nº de
 * mesa), con su apertura estabilizada contra `previas` y su firma.
 */
export function mesasVivas(
  filas: readonly MesasSucursal[],
  respuestaAt: number,
  conectadas: ReadonlySet<string>,
  previas: ReadonlyMap<string, number> = new Map(),
): { mesas: MesaViva[]; aperturas: Map<string, number> } {
  const crudas: MesaSinFirma[] = [];
  for (const fila of filas) {
    const snap = fila.snapshot;
    if (!snap || !conectadas.has(fila.sucursalId)) continue;
    const capturadoAt = Date.parse(snap.capturadoAt);
    for (const mesa of mesasDeFila(fila)) {
      crudas.push({
        ...mesa,
        sucursalId: fila.sucursalId,
        sucursal: fila.nombre,
        apertura: aperturaEnNavegador(
          mesa.abiertoAt,
          capturadoAt,
          snap.edadRecepcionSegundos,
          respuestaAt,
        ),
      });
    }
  }
  const { mesas, aperturas } = estabilizarAperturas(crudas, previas);
  return { mesas: mesas.map((m) => ({ ...m, firma: firmaDe(m) })), aperturas };
}

/** ¿Requiere atención (semáforo rojo) a esta hora? Sin hora de apertura, no se sabe: no. */
export function requiereAtencion(m: Pick<MesaViva, 'apertura'>, ahora: number): boolean {
  return semaforo(minutosDesde(m.apertura, ahora)) === 'rojo';
}
