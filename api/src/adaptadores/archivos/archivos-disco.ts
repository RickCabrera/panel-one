import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { Reloj } from '../../comun/reloj';
import { ArchivoNoEncontrado, type PuertoArchivos } from './puerto';

/** Raíz por defecto del almacenamiento FALSO (desarrollo, test y demo). */
export const RAIZ_ARCHIVOS_FALSO = join(tmpdir(), 'monitor-archivos');

/**
 * Secreto del modo FALSO. No es un secreto: el arranque en producción rechaza
 * `ARCHIVOS_IMPL=falso` (config.ts), así que nunca firma una URL real.
 */
export const SECRETO_ARCHIVOS_FALSO = 'solo-desarrollo-no-usar-firma-de-archivos-falsos';

/**
 * Lo que ve el NAVEGADOR: el web habla con el api detrás de `/api` (el proxy lo quita antes de
 * llegar a Nest, que sirve la descarga en `/archivos`). La real es `ARCHIVOS_URL_BASE`.
 */
export const URL_BASE_ARCHIVOS_FALSO = '/api/archivos';

const SEGMENTO = /^[A-Za-z0-9._-]+$/;

/** Clave → segmentos, o error. Bloquea path traversal antes de tocar el disco. */
export function validarClave(clave: string): string[] {
  const segmentos = clave.split('/');
  const invalida =
    clave.length === 0 ||
    clave.length > 512 ||
    segmentos.some((s) => !SEGMENTO.test(s) || s === '.' || s === '..');
  if (invalida) throw new Error(`Clave de archivo inválida: "${clave}".`);
  return segmentos;
}

function firmar(secreto: string, clave: string, expira: number): string {
  return createHmac('sha256', secreto).update(`${clave}\n${expira}`).digest('base64url');
}

/**
 * Verifica una URL firmada por `ArchivosDisco.urlFirmada` (la usa `verificarUrl`, que es
 * lo que llama el endpoint de descarga de F2-105). Comparación en tiempo constante;
 * vencida = inválida.
 */
export function verificarFirma(
  secreto: string,
  clave: string,
  expira: number,
  firma: string,
  ahoraMs: number,
): boolean {
  if (!Number.isInteger(expira) || expira * 1000 <= ahoraMs) return false;
  try {
    validarClave(clave);
  } catch {
    return false;
  }
  const esperada = Buffer.from(firmar(secreto, clave, expira));
  const recibida = Buffer.from(firma);
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

/**
 * Archivos en disco local bajo `raiz`. Es la implementación de las DOS variantes:
 * - `falso`: raíz temporal y secreto de desarrollo (arriba).
 * - `disco`: la real, sobre el volumen persistente del servidor (F2-191), con raíz,
 *   secreto y URL base obligatorios del entorno.
 * Escritura atómica: se escribe a un temporal y se renombra, así un lector nunca ve
 * un XML a medias.
 */
export class ArchivosDisco implements PuertoArchivos {
  constructor(
    private readonly raiz: string,
    private readonly secreto: string,
    private readonly urlBase: string,
    private readonly reloj: Pick<Reloj, 'ahora'>,
  ) {}

  private ruta(clave: string): string {
    return join(this.raiz, ...validarClave(clave));
  }

  // El tipo MIME no se guarda en disco: lo registra quien guarda (p. ej. F2-105 en su
  // tabla) y lo manda el endpoint de descarga.
  async guardar(clave: string, contenido: Buffer): Promise<void> {
    const destino = this.ruta(clave);
    await mkdir(dirname(destino), { recursive: true });
    const temporal = `${destino}.${randomUUID()}.tmp`;
    await writeFile(temporal, contenido);
    await rename(temporal, destino);
  }

  async leer(clave: string): Promise<Buffer> {
    try {
      return await readFile(this.ruta(clave));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ArchivoNoEncontrado(clave);
      throw error;
    }
  }

  async abrirLectura(clave: string): Promise<{ flujo: Readable; bytes: number }> {
    const ruta = this.ruta(clave);
    try {
      const info = await stat(ruta);
      if (!info.isFile()) throw new ArchivoNoEncontrado(clave);
      return { flujo: createReadStream(ruta), bytes: info.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ArchivoNoEncontrado(clave);
      throw error;
    }
  }

  urlFirmada(clave: string, ttlSegundos: number): Promise<string> {
    validarClave(clave);
    if (!Number.isInteger(ttlSegundos) || ttlSegundos <= 0) {
      return Promise.reject(new Error('ttlSegundos tiene que ser un entero positivo.'));
    }
    const expira = Math.floor(this.reloj.ahora() / 1000) + ttlSegundos;
    const query = new URLSearchParams({
      expira: String(expira),
      firma: firmar(this.secreto, clave, expira),
    });
    return Promise.resolve(`${this.urlBase.replace(/\/+$/, '')}/${clave}?${query}`);
  }

  verificarUrl(clave: string, expira: number, firma: string): boolean {
    return verificarFirma(this.secreto, clave, expira, firma, this.reloj.ahora());
  }
}
