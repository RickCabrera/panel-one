import { Fragment, useState } from 'react';

import type { Sucursal, Ticket } from '../../api/tipos';
import { pesos } from '../../dinero/dinero';
import { cantidad, fechaHoraDe, fechaParaTabla, formasDePago } from './formato';

const SIN_DATO = 'Sin dato';

/** Columnas que en móvil se esconden (siguen en el detalle de la fila). */
const SOLO_ESCRITORIO = 'hidden md:table-cell';
const CELDA = 'px-3 py-2 align-top';

export function TablaTickets({
  tickets,
  sucursales,
  mostrarSucursal,
  atenuada,
}: {
  tickets: readonly Ticket[];
  sucursales: ReadonlyMap<string, Sucursal>;
  /** Con "Todas las sucursales" cada fila dice de cuál es. */
  mostrarSucursal: boolean;
  /** Mientras llega la página nueva se ve la anterior, atenuada. */
  atenuada: boolean;
}) {
  const [abiertos, setAbiertos] = useState<ReadonlySet<string>>(new Set());
  const alternar = (id: string) =>
    setAbiertos((previos) => {
      const nuevos = new Set(previos);
      if (nuevos.has(id)) nuevos.delete(id);
      else nuevos.add(id);
      return nuevos;
    });

  const columnas = 6 + (mostrarSucursal ? 1 : 0) + 3;

  return (
    // La tabla desborda DENTRO de su caja: la página nunca tiene scroll horizontal.
    <div
      className={`min-w-0 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm ${atenuada ? 'opacity-60' : ''}`}
    >
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 uppercase">
          <tr>
            <th scope="col" className={CELDA}>
              <span className="sr-only">Detalle</span>
            </th>
            <th scope="col" className={CELDA}>
              Folio
            </th>
            <th scope="col" className={CELDA}>
              Hora
            </th>
            {mostrarSucursal && (
              <th scope="col" className={`${CELDA} ${SOLO_ESCRITORIO}`}>
                Sucursal
              </th>
            )}
            <th scope="col" className={CELDA}>
              Mesa
            </th>
            <th scope="col" className={`${CELDA} ${SOLO_ESCRITORIO}`}>
              Mesero
            </th>
            <th scope="col" className={`${CELDA} ${SOLO_ESCRITORIO} text-right`}>
              Comensales
            </th>
            <th scope="col" className={`${CELDA} text-right`}>
              Total
            </th>
            <th scope="col" className={`${CELDA} ${SOLO_ESCRITORIO}`}>
              Forma de pago
            </th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => {
            const abierto = abiertos.has(t.id);
            const fechaHora = fechaHoraDe(t, sucursales);
            const idDetalle = `detalle-${t.id}`;
            return (
              <Fragment key={t.id}>
                <tr
                  data-testid={`ticket-${t.folio}`}
                  className={`border-b border-slate-100 ${t.cancelado ? 'bg-slate-50 text-slate-400' : ''}`}
                >
                  <td className={CELDA}>
                    <button
                      type="button"
                      aria-expanded={abierto}
                      aria-controls={idDetalle}
                      aria-label={`${abierto ? 'Ocultar' : 'Ver'} detalle del folio ${t.folio}`}
                      onClick={() => alternar(t.id)}
                      className="rounded px-1 text-slate-500 hover:bg-slate-100"
                    >
                      {abierto ? '▾' : '▸'}
                    </button>
                  </td>
                  <td className={`${CELDA} font-medium whitespace-nowrap`}>
                    {t.folio}
                    {t.cancelado && (
                      <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs font-normal text-slate-600">
                        Cancelado
                      </span>
                    )}
                  </td>
                  <td className={`${CELDA} whitespace-nowrap`}>
                    {fechaHora ? `${fechaParaTabla(fechaHora.fecha)} ${fechaHora.hora}` : SIN_DATO}
                  </td>
                  {mostrarSucursal && (
                    <td className={`${CELDA} ${SOLO_ESCRITORIO}`}>
                      {sucursales.get(t.sucursalId)?.nombre ?? SIN_DATO}
                    </td>
                  )}
                  <td className={CELDA}>{t.mesa ?? '—'}</td>
                  <td className={`${CELDA} ${SOLO_ESCRITORIO}`}>{t.mesero ?? '—'}</td>
                  <td className={`${CELDA} ${SOLO_ESCRITORIO} text-right`}>
                    {t.comensales ?? '—'}
                  </td>
                  <td
                    className={`${CELDA} text-right whitespace-nowrap tabular-nums ${t.cancelado ? 'line-through' : ''}`}
                  >
                    {pesos(t.total)}
                  </td>
                  <td className={`${CELDA} ${SOLO_ESCRITORIO}`}>{formasDePago(t.pagos) || '—'}</td>
                </tr>
                {abierto && (
                  <tr id={idDetalle} className="border-b border-slate-200 bg-slate-50">
                    <td colSpan={columnas} className="px-3 py-3">
                      <Detalle
                        ticket={t}
                        sucursal={sucursales.get(t.sucursalId)?.nombre ?? SIN_DATO}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** La fila expandida: partidas con modificadores, pagos y el desglose del ticket. */
function Detalle({ ticket: t, sucursal }: { ticket: Ticket; sucursal: string }) {
  return (
    <div
      role="region"
      aria-label={`Detalle del folio ${t.folio}`}
      className="flex min-w-0 flex-col gap-4 text-slate-700 lg:flex-row"
    >
      <div className="min-w-0 flex-1">
        <h3 className="text-xs font-medium text-slate-500 uppercase">Partidas</h3>
        {t.partidas.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">Sin partidas.</p>
        ) : (
          <ul className="mt-1 divide-y divide-slate-200">
            {t.partidas.map((p, i) => (
              <li key={i} className="py-1.5">
                <div className="flex gap-3">
                  <span className="w-12 shrink-0 text-right tabular-nums">
                    {cantidad(p.cantidad)}
                  </span>
                  <span className="min-w-0 flex-1 break-words">
                    {p.producto}
                    <span className="block text-xs text-slate-500">{pesos(p.precioUnit)} c/u</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{pesos(p.total)}</span>
                </div>
                {p.modificadores.length > 0 && (
                  <ul className="mt-0.5 ml-15 text-xs text-slate-500">
                    {p.modificadores.map((m, j) => (
                      <li key={j} className="flex gap-3">
                        <span className="min-w-0 flex-1 break-words">+ {m.nombre}</span>
                        <span className="shrink-0 tabular-nums">{pesos(m.precio)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4 lg:w-72">
        <div>
          <h3 className="text-xs font-medium text-slate-500 uppercase">Pagos</h3>
          {t.pagos.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">Sin pagos registrados.</p>
          ) : (
            <ul className="mt-1">
              {t.pagos.map((p, i) => (
                <li key={i} className="flex gap-3 py-0.5">
                  <span className="min-w-0 flex-1 break-words">{p.formaRaw}</span>
                  <span className="shrink-0 tabular-nums">{pesos(p.monto)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
          <dt className="md:hidden">Sucursal</dt>
          <dd className="text-right md:hidden">{sucursal}</dd>
          <dt className="md:hidden">Mesero</dt>
          <dd className="text-right md:hidden">{t.mesero ?? '—'}</dd>
          <dt className="md:hidden">Comensales</dt>
          <dd className="text-right md:hidden">{t.comensales ?? '—'}</dd>
          <dt>Subtotal</dt>
          <dd className="text-right tabular-nums">{pesos(t.subtotal)}</dd>
          <dt>Impuestos</dt>
          <dd className="text-right tabular-nums">{pesos(t.impuestos)}</dd>
          <dt>Descuentos</dt>
          <dd className="text-right tabular-nums">{pesos(t.descuentos)}</dd>
          <dt>Propina</dt>
          <dd className="text-right tabular-nums">{pesos(t.propina)}</dd>
          <dt className="font-medium">Total</dt>
          <dd className="text-right font-medium tabular-nums">{pesos(t.total)}</dd>
        </dl>
        {t.cancelado && (
          <p className="text-xs text-slate-500">Cancelado: se lista, pero no suma a la venta.</p>
        )}
      </div>
    </div>
  );
}
