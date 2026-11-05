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
import {
  ESTILO_POR_DEFECTO,
  ESTILOS,
  PALETAS,
  type Estilo,
  type Tema,
  type Token,
  type TokenAcento,
} from './paleta';

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

function leerValor<T>(clave: string, valido: (v: unknown) => v is T): T | null {
  try {
    const valor = window.localStorage.getItem(clave);
    return valido(valor) ? valor : null;
  } catch {
    return null;
  }
}

function escribir(claves: string[], valor: string): void {
  try {
    for (const clave of claves) window.localStorage.setItem(clave, valor);
  } catch {
    // Sin storage (modo privado, cuota): la elección vale para esta visita y ya.
  }
}

const leerClave = (clave: string) => leerValor(clave, esPreferencia);

/** La del usuario; si no tiene, la última de este navegador; si no, `sistema`. */
export function leerPreferencia(usuarioId?: string): PreferenciaTema {
  return (
    (usuarioId === undefined ? null : leerClave(clavePreferencia(usuarioId))) ??
    leerClave(CLAVE_ULTIMO) ??
    'sistema'
  );
}

export function guardarPreferencia(preferencia: PreferenciaTema, usuarioId?: string): void {
  const claves = usuarioId === undefined ? [] : [clavePreferencia(usuarioId)];
  escribir([...claves, CLAVE_ULTIMO], preferencia);
}

/*
 * UI-06: el ESTILO de la marca («Noche» o «Clásico») se guarda igual que el tema: por usuario y
 * por navegador (`monitor.estilo.<id>` y `monitor.estilo.ultimo`), en localStorage y sin API. Sin
 * nada guardado (o con basura), «Noche».
 */
export const CLAVE_ESTILO_ULTIMO = 'monitor.estilo.ultimo';
export const claveEstilo = (usuarioId: string) => `monitor.estilo.${usuarioId}`;

function esEstilo(valor: unknown): valor is Estilo {
  return typeof valor === 'string' && (ESTILOS as readonly string[]).includes(valor);
}

/** El del usuario; si no tiene, el último de este navegador; si no, «Noche». */
export function leerEstilo(usuarioId?: string): Estilo {
  return (
    (usuarioId === undefined ? null : leerValor(claveEstilo(usuarioId), esEstilo)) ??
    leerValor(CLAVE_ESTILO_ULTIMO, esEstilo) ??
    ESTILO_POR_DEFECTO
  );
}

export function guardarEstilo(estilo: Estilo, usuarioId?: string): void {
  const claves = usuarioId === undefined ? [] : [claveEstilo(usuarioId)];
  escribir([...claves, CLAVE_ESTILO_ULTIMO], estilo);
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

/** Todos los colores de un estilo y un tema: la paleta más los derivados del acento. */
export function coloresDe(
  tema: Tema,
  acento: string,
  estilo: Estilo,
): Record<Token | TokenAcento, string> {
  return { ...PALETAS[estilo][tema], ...derivarAcento(acento, tema, estilo) };
}

/**
 * Pone el tema en `raiz`: variables de la paleta del estilo, del acento, `data-tema`,
 * `data-estilo` (UI-06: las reglas del vidrio y del resplandor de index.css sólo aplican con
 * `noche`) y `color-scheme`. También el `theme-color` (la barra del navegador del celular): el
 * color del lateral, negro en «Noche» y morado en «Clásico».
 */
export function aplicarTema(
  tema: Tema,
  acento: string,
  raiz: HTMLElement = document.documentElement,
  estilo: Estilo = ESTILO_POR_DEFECTO,
): void {
  const valores = coloresDe(tema, acento, estilo);
  for (const [token, valor] of Object.entries(valores)) raiz.style.setProperty(`--${token}`, valor);
  raiz.style.setProperty('color-scheme', tema === 'oscuro' ? 'dark' : 'light');
  raiz.dataset.tema = tema;
  raiz.dataset.estilo = estilo;
  // `content` de un <meta> no es estilo: la CSP no lo toca.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', valores.lateral);
}

/**
 * UI-06 · la «zona oscura»: en «Noche» con tema claro, los marcos negros (la barra de arriba, la
 * cabecera del celular, el login) llevan dentro controles comunes (selectores, campana, tema...)
 * que pintan con `bg-realce`, `text-tinta`... Esta función devuelve las variables de la paleta
 * OSCURA de «Noche» para ponerlas como `style` del marco (React las pone por CSSOM, que la CSP
 * permite): todo lo de adentro se ve como en oscuro sin tocar un solo componente. Fuera de
 * «Noche» o en tema oscuro no hace falta: `undefined`.
 */
export function zonaOscura(
  tema: Tema,
  acento: string,
  estilo: Estilo,
): Record<string, string> | undefined {
  if (estilo !== 'noche' || tema === 'oscuro') return undefined;
  const variables: Record<string, string> = { colorScheme: 'dark' };
  const colores = coloresDe('oscuro', acento, estilo);
  for (const [token, valor] of Object.entries(colores)) variables[`--${token}`] = valor;
  // Lo opaco a lo que vuelven los hijos de un vidrio (index.css) también es el de la zona.
  variables['--superficie-opaca'] = colores.superficie;
  variables['--linea-suave-opaca'] = colores['linea-suave'];
  variables['--linea-opaca'] = colores.linea;
  return variables;
}

/**
 * Arranque, desde `main.tsx` ANTES del primer render: aplica la última preferencia de
 * este navegador (tema y estilo). `main.tsx` es un módulo diferido y la CSP no deja scripts inline,
 * así que con "oscuro" elegido y el sistema en claro puede verse un destello blanco
 * mientras baja el JS. Devuelve el tema aplicado.
 */
export function iniciarTema(acento: string, raiz: HTMLElement = document.documentElement): Tema {
  const tema = resolverTema(leerPreferencia(), sistemaOscuro());
  // UI-06: el estilo también, en el mismo paso: sin destello de «Clásico» a «Noche».
  aplicarTema(tema, acento, raiz, leerEstilo());
  return tema;
}
