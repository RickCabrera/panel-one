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
  /** La lectura MÁS VIEJA de las sucursales que han reportado. */
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

/** Todo lo que pinta el monitor, a partir de la respuesta y la hora actual. */
export function armarMonitor(
  filas: readonly MesasSucursal[],
  respuestaAt: number,
  ahora: number,
): Monitor {
  const sucursales: SucursalMonitor[] = [];
  const mesas: MesaMonitor[] = [];

  for (const fila of filas) {
    const snap = fila.snapshot;
    if (!snap) {
      sucursales.push({
        sucursalId: fila.sucursalId,
        nombre: fila.nombre,
        estado: 'sin-reporte',
        edadSegundos: null,
        recibidoAt: null,
      });
      continue;
    }
    const edad = edadEfectiva(snap.edadRecepcionSegundos, respuestaAt, ahora);
    const estado = frescura(edad) === 'desconectada' ? 'desconectada' : 'conectada';
    sucursales.push({
      sucursalId: fila.sucursalId,
      nombre: fila.nombre,
      estado,
      edadSegundos: edad,
      recibidoAt: Date.parse(snap.recibidoAt),
    });
    if (estado !== 'conectada') continue;

    const capturadoAt = Date.parse(snap.capturadoAt);
    const deEsta: MesaMonitor[] = snap.mesas.map((crudo, i) => {
      const mesa = leerMesa(crudo);
      const minutos = minutosAbierta(mesa.abiertoAt, capturadoAt, edad);
      return {
        ...mesa,
        clave: `${fila.sucursalId}:${mesa.folio ?? ''}:${i}`,
        sucursalId: fila.sucursalId,
        sucursal: fila.nombre,
        minutos,
        semaforo: semaforo(minutos),
      };
    });
    // Orden estable entre polls (sucursal, luego nº de mesa natural): ordenar por
    // urgencia haría saltar las tarjetas cada 20 s. Sin nº de mesa, al final.
    deEsta.sort((a, b) => {
      if (a.mesa === null || b.mesa === null) return a.mesa === b.mesa ? 0 : a.mesa ? -1 : 1;
      return orden.compare(a.mesa, b.mesa);
    });
    mesas.push(...deEsta);
  }

  const totales = mesas.map((m) => m.total);
  const impresos = mesas.map((m) => m.impreso);
  const conLectura = sucursales.filter((s) => s.edadSegundos !== null && s.recibidoAt !== null);
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
