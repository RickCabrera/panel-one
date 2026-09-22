import { ErrorApi } from '../../api/cliente';
import type { CapturaRespuesta } from '../../api/tipos';
import {
  conValor,
  guardarBorrador,
  leerBorrador,
  loteDe,
  sinConfirmados,
  type Borrador,
} from './borrador';

/** Cuánto espera tras la última tecla antes de mandar (junta varias capturas en un lote). */
export const ESPERA_ENVIO_MS = 800;
/** Tras un error de red, cuándo reintenta solo (además de al volver a la pestaña o a la red). */
export const REINTENTO_MS = 10_000;

export type EstadoEnvio =
  | { tipo: 'al-dia' }
  | { tipo: 'enviando' }
  | { tipo: 'sin-red'; mensaje: string }
  | { tipo: 'rechazado'; mensaje: string };

/** Manda un lote al API (`PUT /inventario/conteos/{id}/partidas`). */
export type Mandar = (
  partidas: ReadonlyArray<{ insumoOrigenSrId: string; contado: string | null }>,
) => Promise<CapturaRespuesta>;

export interface EstadoCaptura {
  borrador: Borrador;
  envio: EstadoEnvio;
}

/**
 * El envío de lo capturado en un conteo (F2-123), sin React: el borrador local (ver
 * `borrador.ts`) y su sincronización con `PUT /inventario/conteos/{id}/partidas`.
 *
 * - `capturar` escribe PRIMERO en el borrador (memoria y `localStorage`) y programa el envío.
 * - Se manda en lotes de hasta 500; lo confirmado (con el mismo valor) sale del borrador.
 * - Error de red o 5xx: el borrador se queda; se reintenta cuando quien la usa llama `enviar`
 *   (al montar, al volver la pestaña o la red) y sola cada `REINTENTO_MS`.
 * - Sesión vencida (401): como sin red, con su propio mensaje; el borrador espera el nuevo login.
 * - 409 (el conteo ya no está en captura), 404, 403 o 400: NO se reintenta en bucle ni se descarta en
 *   silencio. Queda "rechazado" con su motivo hasta que el usuario decida (`descartar`).
 */
export class CapturaConteo {
  readonly #llave: string;
  readonly #mandar: Mandar;
  readonly #alGuardar: (guardadas: CapturaRespuesta['guardadas']) => void;
  #borrador: Borrador;
  #envio: EstadoEnvio = { tipo: 'al-dia' };
  #enVuelo = false;
  #temporizador: ReturnType<typeof setTimeout> | null = null;
  #oyentes = new Set<(e: EstadoCaptura) => void>();

  constructor(op: {
    llave: string;
    mandar: Mandar;
    /** Lo confirmado, ANTES de salir del borrador: quien pinta lo pone en su caché. */
    alGuardar?: (guardadas: CapturaRespuesta['guardadas']) => void;
  }) {
    this.#llave = op.llave;
    this.#mandar = op.mandar;
    this.#alGuardar = op.alGuardar ?? (() => undefined);
    this.#borrador = leerBorrador(op.llave);
  }

  estado(): EstadoCaptura {
    return { borrador: this.#borrador, envio: this.#envio };
  }

  suscribir(oyente: (e: EstadoCaptura) => void): () => void {
    this.#oyentes.add(oyente);
    oyente(this.estado());
    return () => this.#oyentes.delete(oyente);
  }

  #avisar(): void {
    const e = this.estado();
    for (const o of this.#oyentes) o(e);
  }

  #fijar(b: Borrador): void {
    this.#borrador = b;
    guardarBorrador(this.#llave, b);
  }

  #programar(ms: number): void {
    if (this.#temporizador) clearTimeout(this.#temporizador);
    this.#temporizador = setTimeout(() => void this.enviar(), ms);
  }

  capturar(insumo: string, valor: string | null): void {
    this.#fijar(conValor(this.#borrador, insumo, valor));
    if (this.#envio.tipo !== 'rechazado') this.#programar(ESPERA_ENVIO_MS);
    this.#avisar();
  }

  async enviar(): Promise<void> {
    if (this.#temporizador) {
      clearTimeout(this.#temporizador);
      this.#temporizador = null;
    }
    if (this.#enVuelo || this.#envio.tipo === 'rechazado') return;
    const lote = loteDe(this.#borrador);
    if (lote.length === 0) {
      if (this.#envio.tipo !== 'al-dia') {
        this.#envio = { tipo: 'al-dia' };
        this.#avisar();
      }
      return;
    }
    this.#enVuelo = true;
    this.#envio = { tipo: 'enviando' };
    this.#avisar();
    try {
      const r = await this.#mandar(lote);
      // Primero lo confirmado llega a quien pinta y luego sale del borrador: el renglón nunca
      // se ve vacío entre una cosa y otra.
      this.#alGuardar(r.guardadas);
      this.#fijar(sinConfirmados(this.#borrador, r.guardadas));
      this.#enVuelo = false;
      this.#envio = { tipo: 'al-dia' };
      this.#avisar();
      // Lo que se capturó mientras viajaba la petición sale en seguida.
      if (loteDe(this.#borrador).length > 0) await this.enviar();
    } catch (e) {
      this.#enVuelo = false;
      if (e instanceof ErrorApi && [400, 403, 404, 409].includes(e.status)) {
        this.#envio = {
          tipo: 'rechazado',
          mensaje:
            e.status === 409
              ? 'No enviado: el conteo ya está cerrado o cancelado.'
              : e.status === 404
                ? 'No enviado: el conteo ya no existe o no está en tu alcance.'
                : e.status === 403
                  ? 'No enviado: tu usuario ya no puede capturar conteos.'
                  : `No enviado: el servidor rechazó lo capturado (${e.message}).`,
        };
      } else {
        this.#envio = {
          tipo: 'sin-red',
          mensaje:
            e instanceof ErrorApi && e.status === 401
              ? 'Tu sesión venció: lo capturado está guardado en este dispositivo; vuelve a ' +
                'entrar y se reenviará.'
              : 'Sin conexión: lo capturado está guardado en este dispositivo y se reenviará.',
        };
        this.#programar(REINTENTO_MS);
      }
      this.#avisar();
    }
  }

  /** Lo que no se pudo enviar (rechazado) se tira, por decisión del usuario. */
  descartar(): void {
    this.#fijar({});
    this.#envio = { tipo: 'al-dia' };
    this.#avisar();
  }

  /** Al desmontar: deja de reintentar sola. El borrador se queda en `localStorage`. */
  detener(): void {
    if (this.#temporizador) clearTimeout(this.#temporizador);
    this.#temporizador = null;
  }
}
