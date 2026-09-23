/** Sin caracteres que se confundan al dictarla (0/O, 1/l/I). */
const ALFABETO = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Contraseña inicial aleatoria (F2-147), del generador criptográfico del navegador. El sesgo
 * del módulo sobre 2^32 con 56 símbolos es despreciable (< 1e-8).
 */
export function generarPassword(largo = 16): string {
  const bytes = new Uint32Array(largo);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('');
}
