import { createHash, randomInt } from 'node:crypto';

/**
 * El código de enlace del instalador de un clic: lo que una persona NO técnica teclea en la PC
 * del restaurante para conectar la sucursal. El instalador lo cambia por la API key (que nunca
 * se copia a mano) en `POST /agente/enlace`. Todo lo de aquí es puro.
 *
 * Formato: 6 símbolos de A–Z y 2–9 SIN los ambiguos O, 0, I, 1 (el mismo alfabeto que el código
 * de facturación de F2-101), mostrados como `K7P-42X`. 32^6 ≈ 1.07·10^9 códigos. Lo que lo vuelve
 * inadivinable no es sólo el tamaño: vive 30 minutos, sirve UNA vez, hay a lo más uno vigente por
 * sucursal y el canje tiene rate limit por IP, por código y de fallos por IP.
 *
 * En la base sólo queda el SHA-256 del código normalizado (sin guión), igual que la API key.
 */

export const ALFABETO_ENLACE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const LONGITUD_ENLACE = 6;
/** El código sin guión, ya normalizado. */
export const REGEX_ENLACE = /^[A-HJ-NP-Z2-9]{6}$/;
/** Cuánto vive un código desde que se genera. */
export const VIGENCIA_ENLACE_MS = 30 * 60 * 1000;

/** Un código al azar (sin guión). `aleatorio(n)`: entero uniforme en [0, n), sin sesgo. */
export function generarCodigoEnlace(aleatorio: (n: number) => number = randomInt): string {
  let codigo = '';
  for (let i = 0; i < LONGITUD_ENLACE; i++) {
    codigo += ALFABETO_ENLACE[aleatorio(ALFABETO_ENLACE.length)];
  }
  return codigo;
}

/** Cómo se muestra: `K7P42X` → `K7P-42X`. */
export function formatearCodigoEnlace(codigo: string): string {
  return `${codigo.slice(0, 3)}-${codigo.slice(3)}`;
}

/**
 * Lo que alguien teclea: sin espacios ni guiones (en cualquier lugar) y en mayúsculas. Nada
 * más: no se "corrige" una O por un 0 (el alfabeto no tiene ninguno de los dos).
 */
export function normalizarCodigoEnlace(texto: string): string {
  return texto.replace(/[\s-]/g, '').toUpperCase();
}

export function esCodigoEnlaceValido(normalizado: string): boolean {
  return REGEX_ENLACE.test(normalizado);
}

/** SHA-256 hex del código NORMALIZADO. Determinista: se busca por igualdad (índice único). */
export function hashCodigoEnlace(normalizado: string): string {
  return createHash('sha256').update(`enlace:${normalizado}`, 'utf8').digest('hex');
}

/**
 * La URL base de la API que el instalador escribe en `config.json` (`API_URL_PUBLICA`).
 * Opcional: sin ella, el canje devuelve `null` y el instalador se queda con la URL con la que
 * llamó (la que trae el paquete). Si está, tiene que ser una URL absoluta `https://` (o `http://`
 * a localhost, para desarrollo), sin `?` ni `#`, igual que la valida el agente; si no, la API no
 * arranca: una URL mala en el config de cada sucursal nueva es peor que un error al desplegar.
 */
export function leerUrlPublicaApi(entorno: NodeJS.ProcessEnv = process.env): string | null {
  const valor = entorno.API_URL_PUBLICA?.trim();
  if (!valor) return null;
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new Error('API_URL_PUBLICA no es una URL válida (ejemplo: https://monitor.ejemplo.com).');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('API_URL_PUBLICA debe empezar con https:// (http:// sólo para localhost).');
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new Error('API_URL_PUBLICA va sin "?", "#" ni usuario: sólo la dirección base.');
  }
  return valor.replace(/\/+$/, '');
}
