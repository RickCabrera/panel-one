/**
 * `socket.io-client` falso para vitest (F2-142). `test-setup.ts` lo instala en TODAS las
 * pruebas: ningún test abre un socket de verdad. Por defecto `connect()` no conecta nada, así
 * que una vista se comporta como con el socket caído (polling de 20 s). Las pruebas del tiempo
 * real lo manejan a mano con `sockets` y los `simular…`.
 */

type Manejador = (...args: unknown[]) => void;

export interface OpcionesFalsas {
  path?: string;
  autoConnect?: boolean;
  auth?: (cb: (datos: Record<string, unknown>) => void) => void;
}

export class SocketFalso {
  connected = false;
  /** Como en socket.io: true mientras el cliente reintenta solo. */
  active = false;
  /** Cuántas veces se llamó `connect()` / `disconnect()`. */
  conexiones = 0;
  desconexiones = 0;
  /** Lo que se emitió con ack: el evento y su cuerpo. */
  emitidos: Array<{ evento: string; cuerpo: unknown }> = [];
  /** La respuesta que dará el ack de `suscribir`; `null` = no contesta (vence el tope). */
  respuestaSuscribir: unknown = { ok: true };
  /** El tope que pidió el último `timeout()`. */
  ultimoTope: number | null = null;
  private readonly manejadores = new Map<string, Set<Manejador>>();

  constructor(readonly opciones: OpcionesFalsas) {}

  on(evento: string, fn: Manejador): this {
    let set = this.manejadores.get(evento);
    if (!set) this.manejadores.set(evento, (set = new Set()));
    set.add(fn);
    return this;
  }

  off(evento: string, fn?: Manejador): this {
    if (fn) this.manejadores.get(evento)?.delete(fn);
    else this.manejadores.delete(evento);
    return this;
  }

  removeAllListeners(): this {
    this.manejadores.clear();
    return this;
  }

  connect(): this {
    this.conexiones += 1;
    this.active = true;
    return this;
  }

  disconnect(): this {
    this.desconexiones += 1;
    const estaba = this.connected;
    this.connected = false;
    this.active = false;
    if (estaba) this.disparar('disconnect', 'io client disconnect');
    return this;
  }

  timeout(ms: number) {
    this.ultimoTope = ms;
    return {
      emitWithAck: (evento: string, cuerpo: unknown): Promise<unknown> => {
        this.emitidos.push({ evento, cuerpo });
        const r = this.respuestaSuscribir;
        return r === null
          ? Promise.reject(new Error('operation has timed out'))
          : Promise.resolve(r);
      },
    };
  }

  /** El token que mandaría el handshake AHORA (el `auth` es función). */
  tokenDelHandshake(): unknown {
    let datos: Record<string, unknown> = {};
    this.opciones.auth?.((d) => (datos = d));
    return datos.token;
  }

  simularConexion(): void {
    this.connected = true;
    this.active = true;
    this.disparar('connect');
  }

  simularCaida(motivo = 'transport close'): void {
    this.connected = false;
    // Una caída de red la reintenta socket.io; un corte del servidor, no.
    this.active = motivo !== 'io server disconnect';
    this.disparar('disconnect', motivo);
  }

  /** `active` false = error del middleware (socket.io NO reintenta solo). */
  simularErrorConexion(mensaje: string, active = false): void {
    this.connected = false;
    this.active = active;
    this.disparar('connect_error', new Error(mensaje));
  }

  recibir(evento: string, datos: unknown): void {
    this.disparar(evento, datos);
  }

  private disparar(evento: string, ...args: unknown[]): void {
    for (const fn of [...(this.manejadores.get(evento) ?? [])]) fn(...args);
  }
}

/** Todos los sockets creados, en orden. Las pruebas lo vacían en su `beforeEach`. */
export const sockets: SocketFalso[] = [];

export function io(opciones: OpcionesFalsas): SocketFalso {
  const s = new SocketFalso(opciones);
  sockets.push(s);
  if (opciones.autoConnect !== false) s.connect();
  return s;
}
