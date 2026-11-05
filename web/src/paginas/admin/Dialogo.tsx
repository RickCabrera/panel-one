import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const ENFOCABLES =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Diálogo modal de la administración (F1-060), con el mismo comportamiento que el
 * detalle de mesa de F1-051: Escape cierra, Tab no sale, el fondo no hace scroll y
 * al cerrar el foco vuelve a quien lo abrió.
 *
 * `cerrable=false` quita Escape y el clic en el fondo: para el modal de la API key,
 * que sólo se cierra con su botón, a propósito, para que nadie la pierda sin querer.
 */
export function Dialogo({
  titulo,
  onCerrar,
  cerrable = true,
  children,
}: {
  titulo: string;
  onCerrar: () => void;
  cerrable?: boolean;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const idTitulo = useId();

  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    const primero = panel.current?.querySelector<HTMLElement>(ENFOCABLES);
    (primero ?? panel.current)?.focus();
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
      if (cerrable) onCerrar();
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

  // UI-06: en un portal a <body>, como `HojaInferior`. Un ancestro con `backdrop-filter` (las
  // tarjetas de vidrio del estilo «Noche») se vuelve el contenedor de todo `fixed` y un contexto
  // de apilamiento: montado dentro de una tarjeta (Facturación), el velo y el diálogo sólo
  // cubrían la tarjeta.
  return createPortal(
    <div
      // UI-04: en el celular es una hoja inferior a todo lo ancho; desde md, centrado.
      className="fixed inset-0 z-50 flex items-end justify-center bg-velo md:items-center md:p-4"
      onMouseDown={(e) => {
        if (cerrable && e.target === e.currentTarget) onCerrar();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        onKeyDown={teclado}
        className="flex max-h-[92dvh] w-full min-w-0 flex-col overflow-y-auto rounded-t-2xl bg-superficie vidrio-fuerte p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl outline-none motion-safe:animate-hoja md:max-h-full md:max-w-lg md:rounded-lg md:pb-4 md:motion-safe:animate-none"
      >
        <h2 id={idTitulo} className="text-lg font-semibold break-words">
          {titulo}
        </h2>
        <div className="mt-3 min-w-0">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
