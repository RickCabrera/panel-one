import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

import { formatearPesos } from '../../dinero/dinero';
import type { ModificadorMesa, PartidaMesa } from './mesa';

import type { MesaMonitor } from './reglas';
import { TEXTO_SEMAFORO } from './textos';

const SIN_DATO = 'Sin dato';

const importe = (centavos: bigint | null) =>
  centavos === null ? SIN_DATO : formatearPesos(centavos);

const ENFOCABLES = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Detalle de consumo de una cuenta abierta (F1-051). `mesa` es la del poll ACTUAL
 * (`buscarSeleccion`): si ya no está, el modal lo dice en vez de enseñar datos viejos.
 * El total es el que reporta SR para la cuenta; nunca se recalcula sumando partidas
 * (esquema-sr.md §3).
 */
export function DetalleMesa({
  mesa,
  titulo,
  conSucursal,
  onCerrar,
}: {
  mesa: MesaMonitor | null;
  /** El nombre con que se abrió, para que el título no cambie si la cuenta desaparece. */
  titulo: string;
  conSucursal: boolean;
  onCerrar: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const cerrar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cerrar.current?.focus();
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previo;
    };
  }, []);

  // Escape cierra; Tab no sale del modal.
  function teclado(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCerrar();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const enfocables = Array.from(panel.current.querySelectorAll<HTMLElement>(ENFOCABLES));
    if (enfocables.length === 0) return;
    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    // Con el foco en el panel mismo (clic sobre texto), Tab entra al modal, no al grid.
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

  return (
    <div
      data-testid="detalle-fondo"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="detalle-mesa-titulo"
        // Enfocable por código y por clic: así un clic sobre texto deja el foco DENTRO
        // del modal y Escape/Tab lo siguen escuchando.
        tabIndex={-1}
        onKeyDown={teclado}
        className="flex max-h-full w-full max-w-2xl min-w-0 flex-col rounded-lg bg-white shadow-xl outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
          <h2 id="detalle-mesa-titulo" className="min-w-0 text-lg font-semibold break-words">
            {titulo}
          </h2>
          <button
            ref={cerrar}
            type="button"
            onClick={onCerrar}
            className="shrink-0 rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
          >
            Cerrar
          </button>
        </div>
        <div className="min-w-0 overflow-y-auto p-4">
          {mesa === null ? (
            <p role="status" className="text-sm text-slate-600">
              Esta cuenta ya no aparece entre las abiertas en vivo: se cerró, o su sucursal dejó de
              reportar.
            </p>
          ) : (
            <Consumo mesa={mesa} conSucursal={conSucursal} />
          )}
        </div>
      </div>
    </div>
  );
}

function Dato({
  etiqueta,
  testId,
  children,
}: {
  etiqueta: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{etiqueta}</dt>
      <dd data-testid={testId} className="break-words tabular-nums">
        {children}
      </dd>
    </div>
  );
}

function Consumo({ mesa, conSucursal }: { mesa: MesaMonitor; conSucursal: boolean }) {
  return (
    <>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <Dato etiqueta="Mesa" testId="detalle-mesa">
          {mesa.mesa ?? SIN_DATO}
        </Dato>
        {conSucursal && (
          <Dato etiqueta="Sucursal" testId="detalle-sucursal">
            {mesa.sucursal}
          </Dato>
        )}
        <Dato etiqueta="Mesero" testId="detalle-mesero">
          {mesa.mesero ?? SIN_DATO}
        </Dato>
        <Dato etiqueta="Folio" testId="detalle-folio">
          {mesa.folio ?? SIN_DATO}
        </Dato>
        <Dato etiqueta="Comensales" testId="detalle-comensales">
          {mesa.comensales ?? SIN_DATO}
        </Dato>
        <Dato etiqueta="Tiempo abierta" testId="detalle-minutos">
          {mesa.minutos === null ? SIN_DATO : `${mesa.minutos} min`}
          <span className="sr-only"> · {TEXTO_SEMAFORO[mesa.semaforo]}</span>
        </Dato>
        <Dato etiqueta="Total" testId="detalle-total">
          {importe(mesa.total)}
        </Dato>
      </dl>

      <h3 className="mt-4 text-xs font-medium text-slate-500 uppercase">Partidas</h3>
      {mesa.partidas === null ? (
        <p className="mt-1 text-sm text-slate-500">Partidas: sin dato.</p>
      ) : mesa.partidas.length === 0 ? (
        <p className="mt-1 text-sm text-slate-500">Sin partidas.</p>
      ) : (
        <ul aria-label="Partidas" className="mt-1 divide-y divide-slate-200 text-sm text-slate-700">
          {mesa.partidas.map((p, i) => (
            <Partida key={i} partida={p} />
          ))}
        </ul>
      )}

      <div className="mt-3 flex justify-between gap-3 border-t border-slate-300 pt-3 font-semibold">
        <span>Total de la cuenta</span>
        <span data-testid="detalle-total-cuenta" className="tabular-nums">
          {importe(mesa.total)}
        </span>
      </div>
    </>
  );
}

/**
 * Lo que oye el lector de pantalla por renglón: cantidad, producto e importe, con el
 * mismo formato que el texto visible (F1-094). Los modificadores no traen cantidad en
 * el snapshot (esquema-sr.md §5): llevan nombre y precio, sin inventarla.
 */
function etiquetaPartida(p: PartidaMesa): string {
  return `${p.cantidad ?? SIN_DATO} × ${p.producto ?? SIN_DATO}, ${importe(p.total)}`;
}

function etiquetaModificador(m: ModificadorMesa): string {
  return `${m.nombre ?? SIN_DATO}, ${importe(m.precio)}`;
}

function Partida({ partida: p }: { partida: PartidaMesa }) {
  return (
    <li className="py-1.5" aria-label={etiquetaPartida(p)}>
      <div className="flex gap-3">
        <span className="w-12 shrink-0 text-right tabular-nums">{p.cantidad ?? SIN_DATO}</span>
        <span className="min-w-0 flex-1 break-words">
          {p.producto ?? SIN_DATO}
          <span className="block text-xs text-slate-500">
            {p.categoria ?? 'Categoría: sin dato'} · {importe(p.precioUnit)} c/u
          </span>
        </span>
        <span className="shrink-0 tabular-nums">{importe(p.total)}</span>
      </div>
      {p.modificadores === null ? (
        <p className="mt-0.5 ml-15 text-xs text-slate-500">Modificadores: sin dato</p>
      ) : (
        <Modificadores lista={p.modificadores} truncado={false} className="ml-15" />
      )}
    </li>
  );
}

function Modificadores({
  lista,
  truncado,
  className,
}: {
  lista: ModificadorMesa[];
  truncado: boolean;
  className: string;
}) {
  if (lista.length === 0 && !truncado) return null;
  return (
    <ul className={`mt-0.5 text-xs text-slate-500 ${className}`}>
      {lista.map((m, i) => (
        <li key={i} aria-label={etiquetaModificador(m)}>
          <div className="flex gap-3">
            <span className="min-w-0 flex-1 break-words">+ {m.nombre ?? SIN_DATO}</span>
            <span className="shrink-0 tabular-nums">{importe(m.precio)}</span>
          </div>
          <Modificadores lista={m.modificadores} truncado={m.truncado} className="ml-4" />
        </li>
      ))}
      {truncado && <li className="italic">Más modificadores no mostrados.</li>}
    </ul>
  );
}
