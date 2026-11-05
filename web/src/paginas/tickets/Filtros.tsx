import { useId, useState, type FormEvent } from 'react';

import {
  CANCELADAS,
  limpiarImporte,
  MAX_LARGO_MESA,
  MAX_LARGO_TEXTO_FILTRO,
  SIN_FILTROS,
  type Canceladas,
  type FiltrosTickets,
} from '../../filtros/tickets';
import { errorDe, ETIQUETA_CANCELADAS } from './reglasFiltros';

const CAMPO =
  'w-full min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-1 text-sm focus:border-acento-borde focus:outline-none';
const BOTON =
  'rounded-md border border-linea-fuerte bg-superficie px-3 py-1 text-sm text-tinta-medio hover:bg-realce disabled:opacity-50';

/**
 * Los filtros de Tickets (F2-222). Se editan en un borrador y se aplican juntos con "Aplicar":
 * así no sale una consulta por cada tecla, y la URL cambia una sola vez (una entrada de
 * "atrás" por búsqueda). La vista le pone `key` con los filtros aplicados: si la URL cambia
 * por fuera (atrás, quitar un filtro), el borrador vuelve a lo aplicado.
 *
 * `meseros` son los del alcance y periodo (de `/ventas/por-mesero`); con `null` (cargando o
 * error) el campo es de texto libre: el filtro es igualdad exacta y sigue sirviendo.
 *
 * `formasPago` (UI-01) son los textos de forma de pago de SR del alcance y periodo (de
 * `/ventas/formas-pago/textos`), los mismos que enseña la tabla; con `null`, texto libre.
 */
export function FiltrosTicketsForm({
  filtros,
  meseros,
  formasPago = null,
  onAplicar,
}: {
  filtros: FiltrosTickets;
  meseros: readonly string[] | null;
  formasPago?: readonly string[] | null;
  onAplicar: (filtros: FiltrosTickets) => void;
}) {
  const id = useId();
  const [borrador, setBorrador] = useState<FiltrosTickets>(filtros);
  const [error, setError] = useState<string | null>(null);
  const cambiar = <K extends keyof FiltrosTickets>(llave: K, valor: FiltrosTickets[K]) =>
    setBorrador((previo) => ({ ...previo, [llave]: valor }));

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const problema = errorDe(borrador);
    setError(problema);
    if (problema) return;
    onAplicar({
      ...borrador,
      mesero: borrador.mesero.trim(),
      mesa: borrador.mesa.trim(),
      producto: borrador.producto.trim(),
      importeMin: limpiarImporte(borrador.importeMin),
      importeMax: limpiarImporte(borrador.importeMax),
    });
  };

  // Un mesero que viene en la URL pero no en la lista del periodo sigue siendo elegible.
  const opcionesMesero =
    meseros && filtros.mesero && !meseros.includes(filtros.mesero)
      ? [filtros.mesero, ...meseros]
      : meseros;
  // Igual con la forma de pago: la de la URL sigue elegible aunque no se cobrara en el periodo.
  const opcionesForma =
    formasPago && filtros.formaRaw && !formasPago.includes(filtros.formaRaw)
      ? [filtros.formaRaw, ...formasPago]
      : formasPago;

  return (
    <form
      aria-label="Filtros de tickets"
      onSubmit={enviar}
      className="grid min-w-0 grid-cols-1 gap-3 rounded-lg border border-linea bg-superficie p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-4"
    >
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <label htmlFor={`${id}-c1`}>Mesero</label>
        {opcionesMesero ? (
          <select
            id={`${id}-c1`}
            value={borrador.mesero}
            onChange={(e) => cambiar('mesero', e.target.value)}
            className={CAMPO}
          >
            <option value="">Todos</option>
            {opcionesMesero.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={`${id}-c1`}
            type="text"
            value={borrador.mesero}
            maxLength={MAX_LARGO_TEXTO_FILTRO}
            onChange={(e) => cambiar('mesero', e.target.value)}
            placeholder="Nombre exacto"
            className={CAMPO}
          />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <label htmlFor={`${id}-c2`}>Mesa</label>
        <input
          id={`${id}-c2`}
          type="text"
          value={borrador.mesa}
          maxLength={MAX_LARGO_MESA}
          onChange={(e) => cambiar('mesa', e.target.value)}
          placeholder="Exacta, p. ej. 12"
          className={CAMPO}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <label htmlFor={`${id}-c3`}>Forma de pago</label>
        {opcionesForma ? (
          <select
            id={`${id}-c3`}
            value={borrador.formaRaw}
            onChange={(e) => cambiar('formaRaw', e.target.value)}
            className={CAMPO}
          >
            <option value="">Todas</option>
            {opcionesForma.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={`${id}-c3`}
            type="text"
            value={borrador.formaRaw}
            maxLength={MAX_LARGO_TEXTO_FILTRO}
            onChange={(e) => cambiar('formaRaw', e.target.value)}
            placeholder="Como en el POS, p. ej. EFECTIVO"
            className={CAMPO}
          />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <label htmlFor={`${id}-c4`}>Canceladas</label>
        <select
          id={`${id}-c4`}
          value={borrador.canceladas}
          onChange={(e) => cambiar('canceladas', e.target.value as Canceladas)}
          className={CAMPO}
        >
          {CANCELADAS.map((c) => (
            <option key={c} value={c}>
              {ETIQUETA_CANCELADAS[c]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <label htmlFor={`${id}-c5`}>Importe desde</label>
        <input
          id={`${id}-c5`}
          type="text"
          inputMode="decimal"
          value={borrador.importeMin}
          onChange={(e) => cambiar('importeMin', e.target.value)}
          placeholder="$ mínimo"
          className={CAMPO}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <label htmlFor={`${id}-c6`}>Importe hasta</label>
        <input
          id={`${id}-c6`}
          type="text"
          inputMode="decimal"
          value={borrador.importeMax}
          onChange={(e) => cambiar('importeMax', e.target.value)}
          placeholder="$ máximo"
          className={CAMPO}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1 text-sm sm:col-span-2">
        <label htmlFor={`${id}-c7`}>Producto</label>
        <input
          id={`${id}-c7`}
          type="text"
          value={borrador.producto}
          maxLength={MAX_LARGO_TEXTO_FILTRO}
          onChange={(e) => cambiar('producto', e.target.value)}
          placeholder="Contiene… (distingue acentos)"
          className={CAMPO}
        />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
        <button type="submit" className={BOTON}>
          Aplicar filtros
        </button>
        <button
          type="button"
          className={BOTON}
          onClick={() => {
            setBorrador(SIN_FILTROS);
            setError(null);
            onAplicar(SIN_FILTROS);
          }}
        >
          Limpiar filtros
        </button>
        {error && (
          <p role="alert" className="text-sm text-peligro">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
