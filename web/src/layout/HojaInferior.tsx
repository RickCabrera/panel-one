import { X } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

const ENFOCABLES =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

/** Lo que hay que arrastrar hacia abajo (px) para que la hoja se cierre al soltar. */
export const UMBRAL_ARRASTRE_PX = 80;

/**
 * Hoja inferior del celular (UI-04): la hoja «Más» y la de empresa/sucursal. Es un diálogo
 * modal con el mismo trato que `Dialogo` (F1-060): el foco entra al abrir y vuelve a quien la
 * abrió al cerrar, Tab no sale, Escape cierra y el fondo no hace scroll. Además se cierra
 * tocando el velo, con el botón «Cerrar» o arrastrando la agarradera hacia abajo.
 *
 * El arrastre mueve la hoja con `style.transform` (CSSOM, que la CSP permite); al soltar,
 * pasado el umbral se cierra y si no, regresa. Con `prefers-reduced-motion` no hay animación
 * de entrada (`motion-safe:`).
 */
export function HojaInferior({
  id,
  titulo,
  onCerrar,
  children,
}: {
  /** Para el `aria-controls` de quien la abre. */
  id?: string;
  titulo: string;
  onCerrar: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const inicioArrastre = useRef<number | null>(null);
  const desplazado = useRef(0);
  const idTitulo = useId();
  // Escape/arrastre llaman la versión vigente sin volver a montar el efecto de foco.
  const cerrarRef = useRef(onCerrar);
  useEffect(() => {
    cerrarRef.current = onCerrar;
  }, [onCerrar]);

  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      if (previo && document.contains(previo)) previo.focus();
    };
  }, []);

  function teclado(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      cerrarRef.current();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const enfocables = Array.from(panel.current.querySelectorAll<HTMLElement>(ENFOCABLES));
    if (enfocables.length === 0) return;
    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    if (!enfocables.includes(document.activeElement as HTMLElement)) {
      e.preventDefault();
      (e.shiftKey ? ultimo : primero).focus();
    } else if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  }

  function empezarArrastre(e: PointerEvent<HTMLDivElement>) {
    // Sólo el dedo o el botón principal; el botón «Cerrar» atiende su propio clic.
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    inicioArrastre.current = e.clientY;
    desplazado.current = 0;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function arrastrar(e: PointerEvent<HTMLDivElement>) {
    if (inicioArrastre.current === null || !panel.current) return;
    desplazado.current = Math.max(0, e.clientY - inicioArrastre.current);
    panel.current.style.transform = `translateY(${desplazado.current}px)`;
  }

  function soltar() {
    if (inicioArrastre.current === null) return;
    inicioArrastre.current = null;
    if (desplazado.current > UMBRAL_ARRASTRE_PX) {
      cerrarRef.current();
      return;
    }
    if (panel.current) panel.current.style.transform = '';
  }

  // En un portal: la cabecera fija lleva `backdrop-blur`, y un `backdrop-filter` vuelve al
  // ancestro el contenedor de todo `fixed`; montada ahí, la hoja quedaba dentro de la cabecera.
  return createPortal(
    <div
      data-testid="hoja-velo"
      className="fixed inset-0 z-50 flex items-end bg-velo print:hidden"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div
        ref={panel}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        onKeyDown={teclado}
        className="flex max-h-[92dvh] w-full min-w-0 flex-col rounded-t-2xl border-t border-linea bg-superficie text-tinta shadow-lg outline-none motion-safe:animate-hoja"
      >
        <div
          data-testid="hoja-agarradera"
          className="shrink-0 cursor-grab touch-none px-4 pt-2 pb-1 select-none"
          onPointerDown={empezarArrastre}
          onPointerMove={arrastrar}
          onPointerUp={soltar}
          onPointerCancel={soltar}
        >
          <span
            aria-hidden="true"
            className="mx-auto block h-1 w-10 rounded-full bg-linea-fuerte"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <h2 id={idTitulo} className="min-w-0 truncate text-lg font-semibold">
              {titulo}
            </h2>
            <button
              type="button"
              onClick={onCerrar}
              aria-label="Cerrar"
              className="-mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-tinta-suave hover:bg-realce hover:text-tinta"
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
