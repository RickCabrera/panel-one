/**
 * `matchMedia` falso para jsdom, que no lo trae (F2-211). Entiende
 * `(prefers-color-scheme: dark)` y, desde UI-04, las consultas de ancho
 * (`(max-width: 767.98px)`, `(min-width: 768px)`, unidas con `and`). Cualquier otra
 * consulta nunca coincide. `test-setup.ts` lo instala antes de cada test con el sistema en
 * CLARO y una pantalla de ESCRITORIO (1280 px): los tests de siempre ven el lateral.
 *
 * `temaDelSistema(true)` simula que la persona cambia su sistema operativo a oscuro y
 * `anchoDePantalla(390)` que gira o cambia de dispositivo; las dos avisan a quien escuche,
 * igual que el navegador de verdad.
 */
const MEDIA_OSCURO = '(prefers-color-scheme: dark)';
const ANCHO_POR_DEFECTO = 1280;

type Oyente = (evento: MediaQueryListEvent) => void;

let oscuro = false;
let ancho = ANCHO_POR_DEFECTO;
const oyentes = new Set<Oyente>();
const oyentesAncho = new Map<Oyente, string>();

/** `null` si la consulta no es de ancho (entonces nunca coincide). */
function coincideAncho(consulta: string): boolean | null {
  const partes = consulta.split(/\s+and\s+/);
  let entendida = false;
  for (const parte of partes) {
    const m = /^\((min|max)-width:\s*([\d.]+)px\)$/.exec(parte.trim());
    if (!m) return null;
    entendida = true;
    const valor = Number(m[2]);
    if (m[1] === 'min' ? ancho < valor : ancho > valor) return false;
  }
  return entendida ? true : null;
}

export function instalarMatchMediaFalso(): void {
  oscuro = false;
  ancho = ANCHO_POR_DEFECTO;
  oyentes.clear();
  oyentesAncho.clear();
  window.matchMedia = (consulta: string) => {
    const esTema = consulta === MEDIA_OSCURO;
    const esAncho = coincideAncho(consulta) !== null;
    return {
      get matches() {
        if (esTema) return oscuro;
        return coincideAncho(consulta) === true;
      },
      media: consulta,
      onchange: null,
      addEventListener: (_tipo: string, oyente: Oyente) => {
        if (esTema) oyentes.add(oyente);
        else if (esAncho) oyentesAncho.set(oyente, consulta);
      },
      removeEventListener: (_tipo: string, oyente: Oyente) => {
        oyentes.delete(oyente);
        oyentesAncho.delete(oyente);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  };
}

/** Cambia el tema del sistema operativo simulado y dispara `change`. */
export function temaDelSistema(nuevoOscuro: boolean): void {
  oscuro = nuevoOscuro;
  for (const oyente of [...oyentes]) {
    oyente({ matches: nuevoOscuro, media: MEDIA_OSCURO } as MediaQueryListEvent);
  }
}

/** Cambia el ancho de la pantalla simulada (px) y avisa a las consultas de ancho. */
export function anchoDePantalla(nuevo: number): void {
  ancho = nuevo;
  for (const [oyente, consulta] of [...oyentesAncho]) {
    oyente({ matches: coincideAncho(consulta) === true, media: consulta } as MediaQueryListEvent);
  }
}

/** Cuántos escuchan el tema del sistema (para comprobar que se limpian). */
export const oyentesDelSistema = () => oyentes.size;
