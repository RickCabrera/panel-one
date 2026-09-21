/**
 * Marca "el usuario cerró sesión en este navegador". Mientras está puesta, el
 * arranque NO intenta el refresh silencioso.
 *
 * Por qué sigue haciendo falta aunque la API ya tiene logout (F1-093): "Salir"
 * llama a `POST /auth/logout`, que revoca la sesión y borra la cookie httpOnly de
 * refresh, pero ese POST puede no llegar (sin red, API caída, pestaña cerrada a
 * media salida). Entonces la cookie sigue viva hasta 7 días y la SPA no la puede
 * borrar; esta marca evita que el arranque la use para reanudar la sesión. NO es
 * revocación: quien borre el localStorage en esa máquina entraría como el usuario
 * anterior, pero sólo si el logout no llegó a la API.
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
