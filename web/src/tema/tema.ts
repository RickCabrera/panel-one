/**
 * Tema claro / oscuro / del sistema (F2-211): preferencia, persistencia y aplicación.
 *
 * Aplicar un tema = poner cada token de la paleta como variable CSS en `:root`
 * (`--fondo`, `--tinta`...) por CSSOM (`style.setProperty`), más `data-tema` y
 * `color-scheme`. OJO con la CSP (`style-src 'self'`): setProperty sobre el CSSOM está
 * permitido; `setAttribute('style', …)` o inyectar un `<style>` NO lo están. No
 * cambies la forma de aplicarlo sin mirar `seguridad/csp.test.ts`.
 */
import { derivarAcento } from './acento';
import { PALETA, type Tema } from './paleta';

export type PreferenciaTema = Tema | 'sistema';

export const PREFERENCIAS: readonly PreferenciaTema[] = ['claro', 'oscuro', 'sistema'];

/*
 * DECISION PROVISIONAL (nocturno): la preferencia vive en localStorage, por usuario Y
 * POR NAVEGADOR, no en una columna de `Usuario` en la API. Es presentación pura; una
 * columna metería migración, endpoint y contrato OpenAPI para algo que no es dato del
 * negocio. Si Ricardo la quiere entre dispositivos, es una tarea de /api.
 *
 * Dos claves: la del usuario (`monitor.tema.<id>`) y la última elegida en este
 * navegador (`monitor.tema.ultimo`), que es la que ve el login y el arranque antes de
 * saber quién entra. Cerrar sesión no borra ninguna: el tema sobrevive al logout.
 * Quien entre después en la misma máquina sin preferencia propia hereda `ultimo`
 * (mismo precedente que `monitor.menu.colapsadas.<id>`).
 */
export const CLAVE_ULTIMO = 'monitor.tema.ultimo';
export const clavePreferencia = (usuarioId: string) => `monitor.tema.${usuarioId}`;

const MEDIA_OSCURO = '(prefers-color-scheme: dark)';

function esPreferencia(valor: unknown): valor is PreferenciaTema {
  return typeof valor === 'string' && (PREFERENCIAS as readonly string[]).includes(valor);
}

function leerClave(clave: string): PreferenciaTema | null {
  try {
    const valor = window.localStorage.getItem(clave);
    return esPreferencia(valor) ? valor : null;
  } catch {
    return null;
  }
}

/** La del usuario; si no tiene, la última de este navegador; si no, `sistema`. */
export function leerPreferencia(usuarioId?: string): PreferenciaTema {
  return (
    (usuarioId === undefined ? null : leerClave(clavePreferencia(usuarioId))) ??
    leerClave(CLAVE_ULTIMO) ??
    'sistema'
  );
}

export function guardarPreferencia(preferencia: PreferenciaTema, usuarioId?: string): void {
  try {
    if (usuarioId !== undefined)
      window.localStorage.setItem(clavePreferencia(usuarioId), preferencia);
    window.localStorage.setItem(CLAVE_ULTIMO, preferencia);
  } catch {
    // Sin storage (modo privado, cuota): el tema vale para esta visita y ya.
  }
}

/** ¿El sistema operativo pide oscuro? Sin `matchMedia` (navegadores viejos): no. */
export function sistemaOscuro(): boolean {
  return window.matchMedia?.(MEDIA_OSCURO).matches ?? false;
}

/** Avisa cuando el tema del sistema cambia. Devuelve cómo dejar de escuchar. */
export function escucharSistema(oyente: (oscuro: boolean) => void): () => void {
  const media = window.matchMedia?.(MEDIA_OSCURO);
  if (!media) return () => {};
  const alCambiar = (evento: MediaQueryListEvent) => oyente(evento.matches);
  media.addEventListener('change', alCambiar);
  return () => media.removeEventListener('change', alCambiar);
}

export function resolverTema(preferencia: PreferenciaTema, oscuro: boolean): Tema {
  if (preferencia === 'sistema') return oscuro ? 'oscuro' : 'claro';
  return preferencia;
}

/** Pone el tema en `raiz`: variables de la paleta, del acento, `data-tema` y `color-scheme`. */
export function aplicarTema(
  tema: Tema,
  acento: string,
  raiz: HTMLElement = document.documentElement,
): void {
  const valores = { ...PALETA[tema], ...derivarAcento(acento, tema) };
  for (const [token, valor] of Object.entries(valores)) raiz.style.setProperty(`--${token}`, valor);
  raiz.style.setProperty('color-scheme', tema === 'oscuro' ? 'dark' : 'light');
  raiz.dataset.tema = tema;
}

/**
 * Arranque, desde `main.tsx` ANTES del primer render: aplica la última preferencia de
 * este navegador. `main.tsx` es un módulo diferido y la CSP no deja scripts inline,
 * así que con "oscuro" elegido y el sistema en claro puede verse un destello blanco
 * mientras baja el JS. Devuelve el tema aplicado.
 */
export function iniciarTema(acento: string, raiz: HTMLElement = document.documentElement): Tema {
  const tema = resolverTema(leerPreferencia(), sistemaOscuro());
  aplicarTema(tema, acento, raiz);
  return tema;
}
