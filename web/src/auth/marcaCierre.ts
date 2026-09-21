/**
 * Marca "el usuario cerró sesión en este navegador". Mientras está puesta, el
 * arranque NO intenta el refresh silencioso.
 *
 * Por qué hace falta: la API todavía no tiene logout (F1-092), así que la cookie
 * httpOnly de refresh sigue viva hasta 7 días después de "cerrar sesión" y la SPA no
 * la puede borrar. Esto NO es revocación: quien borre el localStorage en esa máquina
 * entra como el usuario anterior mientras la cookie viva. Es un riesgo abierto y
 * está anotado en docs/nocturno-log.md para F1-092.
 */
const CLAVE = 'monitor.sesionCerrada';

/**
 * ¿Hay que saltarse el refresh silencioso? Si el storage no se puede leer (modo
 * privado estricto, políticas del navegador), la respuesta conservadora es SÍ:
 * mejor pedir login que reanudar una sesión que el usuario pudo haber cerrado.
 */
export function sesionCerradaEnEsteNavegador(): boolean {
  try {
    return window.localStorage.getItem(CLAVE) === '1';
  } catch {
    return true;
  }
}

export function marcarSesionCerrada(): void {
  try {
    window.localStorage.setItem(CLAVE, '1');
  } catch {
    // Sin storage no hay marca; el token en memoria ya se borró igual.
  }
}

export function quitarMarcaSesionCerrada(): void {
  try {
    window.localStorage.removeItem(CLAVE);
  } catch {
    // Nada que hacer.
  }
}
