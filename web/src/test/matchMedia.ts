/**
 * `matchMedia` falso para jsdom, que no lo trae (F2-211). Sólo entiende
 * `(prefers-color-scheme: dark)`; cualquier otra consulta nunca coincide. `test-setup.ts`
 * lo instala antes de cada test con el sistema en CLARO; `temaDelSistema(true)` simula
 * que la persona cambia su sistema operativo a oscuro y avisa a quien escuche, igual
 * que el navegador de verdad.
 */
const MEDIA_OSCURO = '(prefers-color-scheme: dark)';

type Oyente = (evento: MediaQueryListEvent) => void;

let oscuro = false;
const oyentes = new Set<Oyente>();

export function instalarMatchMediaFalso(): void {
  oscuro = false;
  oyentes.clear();
  window.matchMedia = (consulta: string) => {
    const esTema = consulta === MEDIA_OSCURO;
    return {
      get matches() {
        return esTema && oscuro;
      },
      media: consulta,
      onchange: null,
      addEventListener: (_tipo: string, oyente: Oyente) => {
        if (esTema) oyentes.add(oyente);
      },
      removeEventListener: (_tipo: string, oyente: Oyente) => {
        oyentes.delete(oyente);
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

/** Cuántos escuchan el tema del sistema (para comprobar que se limpian). */
export const oyentesDelSistema = () => oyentes.size;
