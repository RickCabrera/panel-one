import { Fragment, useState } from 'react';

import type { EstadoCodigoFacturacion, Sucursal, Ticket } from '../../api/tipos';
import { pesos } from '../../dinero/dinero';
import { siguienteOrden, type Orden, type OrdenTickets } from '../../filtros/tickets';
import {
  cantidad,
  fechaHoraDe,
  fechaHoraEn,
  fechaParaTabla,
  formasDePago,
  textoTiempoMesa,
  tiempoMesa,
} from './formato';

const SIN_DATO = 'Sin dato';

/** Lo que el panel NO recibe del POS; dicho como límite del panel, no como hecho de SR. */
export const NOTA_DESCUENTOS =
  'El panel no recibe descuentos ni cortesías por partida: el descuento es el de la cuenta completa.';
export const NOTA_HORA_CANCELACION = 'El panel no recibe la hora de la cancelación';

/** Columnas que en móvil se esconden (siguen en el detalle de la fila). */
const SOLO_ESCRITORIO = 'hidden md:table-cell';
const CELDA = 'px-3 py-2 align-top';

export function TablaTickets({
  tickets,
  sucursales,
  mostrarSucursal,
  atenuada,
  orden,
  onOrdenar,
}: {
  tickets: readonly Ticket[];
  sucursales: ReadonlyMap<string, Sucursal>;
  /** Con "Todas las sucursales" cada fila dice de cuál es. */
  mostrarSucursal: boolean;
  /**
   * Mientras llega la página nueva se ve la anterior, atenuada: fondo `realce` y
   * `aria-busy`, NO opacidad, que bajaba el texto de 4.5:1 (F2-211).
   */
  atenuada: boolean;
  /** El orden actual (F2-222): el encabezado de esa columna lo marca con `aria-sort`. */
  orden: OrdenTickets;
  onOrdenar: (orden: OrdenTickets) => void;
}) {
  const [abiertos, setAbiertos] = useState<ReadonlySet<string>>(new Set());
  const alternar = (id: string) =>
    setAbiertos((previos) => {
      const nuevos = new Set(previos);
      if (nuevos.has(id)) nuevos.delete(id);
      else nuevos.add(id);
      return nuevos;
    });

  const columnas = 8 + (mostrarSucursal ? 1 : 0) + 3;
  const encabezado = (columna: Orden, texto: string, clase = '') => (
    <Encabezado columna={columna} texto={texto} clase={clase} orden={orden} onOrdenar={onOrdenar} />
  );

  return (
    // La tabla desborda DENTRO de su caja: la página nunca tiene scroll horizontal.
    <div
      className={`min-w-0 overflow-x-auto rounded-lg border border-linea shadow-sm ${atenuada ? 'bg-realce' : 'bg-superficie'}`}
      aria-busy={atenuada}
    >
      <table className="w-full text-left text-sm">
        <thead className="border-b border-linea bg-fondo text-xs text-tinta-suave uppercase">
          <tr>
            <th scope="col" className={CELDA}>
              <span className="sr-only">Detalle</span>
            </th>
            {encabezado('folio', 'Folio')}
            {encabezado('momento', 'Hora')}
            {mostrarSucursal && (
              <th scope="col" className={`${CELDA} ${SOLO_ESCRITORIO}`}>
                Sucursal
              </th>
            )}
            {encabezado('mesa', 'Mesa')}
            {encabezado('mesero', 'Mesero', SOLO_ESCRITORIO)}
            {encabezado('comensales', 'Comensales', `${SOLO_ESCRITORIO} text-right`)}
            {encabezado('duracion', 'Tiempo', `${SOLO_ESCRITORIO} text-right`)}
            {encabezado('propina', 'Propina', `${SOLO_ESCRITORIO} text-right`)}
            {encabezado('total', 'Total', 'text-right')}
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
                  className={`border-b border-linea-suave ${t.cancelado ? 'bg-fondo text-tinta-tenue' : ''}`}
                >
                  <td className={CELDA}>
                    <button
                      type="button"
                      aria-expanded={abierto}
                      aria-controls={idDetalle}
                      aria-label={`${abierto ? 'Ocultar' : 'Ver'} detalle del folio ${t.folio}`}
                      onClick={() => alternar(t.id)}
                      className="rounded px-1 text-tinta-tenue hover:bg-realce"
                    >
                      {abierto ? '▾' : '▸'}
                    </button>
                  </td>
                  <td className={`${CELDA} font-medium whitespace-nowrap`}>
                    {t.folio}
                    {t.cancelado && (
                      <span className="ml-2 rounded bg-realce-fuerte px-1.5 py-0.5 text-xs font-normal text-tinta-suave">
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
                  <td className={`${CELDA} ${SOLO_ESCRITORIO} text-right whitespace-nowrap`}>
                    {textoTiempoMesa(tiempoMesa(t))}
                  </td>
                  <td
                    className={`${CELDA} ${SOLO_ESCRITORIO} text-right whitespace-nowrap tabular-nums`}
                  >
                    {pesos(t.propina)}
                  </td>
                  <td
                    className={`${CELDA} text-right whitespace-nowrap tabular-nums ${t.cancelado ? 'line-through' : ''}`}
                  >
                    {pesos(t.total)}
                  </td>
                  <td className={`${CELDA} ${SOLO_ESCRITORIO}`}>{formasDePago(t.pagos) || '—'}</td>
                </tr>
                {abierto && (
                  <tr id={idDetalle} className="border-b border-linea bg-fondo">
                    <td colSpan={columnas} className="px-3 py-3">
                      <Detalle ticket={t} sucursal={sucursales.get(t.sucursalId)} />
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

/**
 * Un encabezado ordenable: el botón cambia el orden y `aria-sort` dice cuál está activo. Las
 * demás columnas no llevan `aria-sort` (ARIA: sólo la que ordena).
 */
function Encabezado({
  columna,
  texto,
  clase,
  orden,
  onOrdenar,
}: {
  columna: Orden;
  texto: string;
  clase: string;
  orden: OrdenTickets;
  onOrdenar: (orden: OrdenTickets) => void;
}) {
  const activo = orden.orden === columna;
  const sentido = orden.dir === 'asc' ? 'ascending' : 'descending';
  return (
    <th scope="col" className={`${CELDA} ${clase}`} aria-sort={activo ? sentido : undefined}>
      <button
        type="button"
        onClick={() => onOrdenar(siguienteOrden(orden, columna))}
        className="inline-flex items-center gap-1 rounded uppercase hover:text-tinta-medio"
      >
        {texto}
        <span aria-hidden="true" className={activo ? '' : 'invisible'}>
          {orden.dir === 'asc' ? '▲' : '▼'}
        </span>
      </button>
    </th>
  );
}

/** `DD/MM/AAAA HH:MM` en la zona de la sucursal; "Sin dato" sin zona confiable; `—` sin instante. */
function enSucursal(sucursal: Sucursal | undefined, instante: string | null): string {
  if (instante === null) return '—';
  if (!sucursal) return SIN_DATO;
  const { fecha, hora } = fechaHoraEn(sucursal.zonaHoraria, instante);
  return `${fechaParaTabla(fecha)} ${hora}`;
}

/**
 * Qué se canceló y cuándo (F2-222). DECISION PROVISIONAL (nocturno): el panel sólo recibe la
 * cancelación de la cuenta COMPLETA (`cancelado`), sin la hora en que se hizo ni partidas
 * canceladas sueltas (docs/esquema-sr.md §2). Se dice eso, y se da el instante por el que la
 * cuenta está ubicada, que es lo que sí se sabe.
 */
function Cancelacion({ ticket: t, sucursal }: { ticket: Ticket; sucursal: Sucursal | undefined }) {
  const partidas = t.partidas.length;
  const ubicada = t.cerradoAt === null ? 'su apertura' : 'su cierre';
  return (
    <div
      role="note"
      aria-label="Cancelación"
      className="rounded-md border border-linea-fuerte bg-realce px-3 py-2 text-sm text-tinta-medio"
    >
      <p className="font-medium">Cuenta cancelada completa</p>
      <p>
        Se canceló la cuenta entera: {partidas} {partidas === 1 ? 'partida' : 'partidas'} por{' '}
        {pesos(t.total)}. No suma a la venta.
      </p>
      <p>
        {NOTA_HORA_CANCELACION}; la cuenta está ubicada por {ubicada}:{' '}
        {enSucursal(sucursal, t.cerradoAt ?? t.abiertoAt)}.
      </p>
    </div>
  );
}

const ETIQUETA_ESTADO_CODIGO: Record<EstadoCodigoFacturacion, string> = {
  pendiente: 'Se puede facturar',
  facturado: 'Ya facturado',
  en_global: 'En la factura global',
  expirado: 'Plazo vencido',
  cancelado: 'Cuenta cancelada',
};

/**
 * El código de facturación del ticket (F2-103): lo que la caja le dicta al cliente si el ticket
 * no salió con el QR (respaldo de F2-102). Sin código, se dice por qué puede faltar.
 */
function CodigoFacturacion({ ticket: t }: { ticket: Ticket }) {
  const c = t.codigoFacturacion;
  return (
    <div>
      <h3 className="text-xs font-medium text-tinta-tenue uppercase">Código de facturación</h3>
      {c === null ? (
        <p className="mt-1 text-sm text-tinta-tenue">
          Sin código: la cuenta no es facturable (cancelada o en $0) o llegó antes de que existieran
          los códigos.
        </p>
      ) : (
        <p className="mt-1 text-sm">
          <span className="font-mono text-base font-medium tracking-wider text-tinta">
            {c.codigo}
          </span>{' '}
          <span className="text-xs text-tinta-tenue">· {ETIQUETA_ESTADO_CODIGO[c.estado]}</span>
          {c.estado !== 'pendiente' && (
            <span className="block text-xs text-tinta-tenue">{c.mensaje}</span>
          )}
        </p>
      )}
    </div>
  );
}

/** La fila expandida: partidas con modificadores, pagos y el desglose del ticket. */
function Detalle({ ticket: t, sucursal }: { ticket: Ticket; sucursal: Sucursal | undefined }) {
  const tiempo = tiempoMesa(t);
  return (
    <div
      role="region"
      aria-label={`Detalle del folio ${t.folio}`}
      className="flex min-w-0 flex-col gap-4 text-tinta-medio lg:flex-row"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {t.cancelado && <Cancelacion ticket={t} sucursal={sucursal} />}
        <div>
          <h3 className="text-xs font-medium text-tinta-tenue uppercase">Partidas</h3>
          {t.partidas.length === 0 ? (
            <p className="mt-1 text-sm text-tinta-tenue">Sin partidas.</p>
          ) : (
            <ul className="mt-1 divide-y divide-linea">
              {t.partidas.map((p, i) => (
                <li key={i} className="py-1.5">
                  <div className="flex gap-3">
                    <span className="w-12 shrink-0 text-right tabular-nums">
                      {cantidad(p.cantidad)}
                    </span>
                    <span
                      className={`min-w-0 flex-1 break-words ${t.cancelado ? 'line-through' : ''}`}
                    >
                      {p.producto}
                      <span className="block text-xs text-tinta-tenue">
                        {pesos(p.precioUnit)} c/u
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">{pesos(p.total)}</span>
                  </div>
                  {p.modificadores.length > 0 && (
                    <ul className="mt-0.5 ml-15 text-xs text-tinta-tenue">
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
          <p className="mt-2 text-xs text-tinta-tenue">{NOTA_DESCUENTOS}</p>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-4 lg:w-72">
        <div>
          <h3 className="text-xs font-medium text-tinta-tenue uppercase">Pagos</h3>
          {t.pagos.length === 0 ? (
            <p className="mt-1 text-sm text-tinta-tenue">Sin pagos registrados.</p>
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
        <CodigoFacturacion ticket={t} />
        <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
          <dt className="md:hidden">Sucursal</dt>
          <dd className="text-right md:hidden">{sucursal?.nombre ?? SIN_DATO}</dd>
          <dt>Apertura</dt>
          <dd className="text-right">{enSucursal(sucursal, t.abiertoAt)}</dd>
          <dt>Cierre</dt>
          <dd className="text-right">{enSucursal(sucursal, t.cerradoAt)}</dd>
          <dt>Tiempo de mesa</dt>
          <dd className="text-right">
            {textoTiempoMesa(tiempo)}
            {tiempo.tipo === 'invalido' && (
              <span className="block text-xs text-tinta-tenue">
                El cierre es anterior a la apertura.
              </span>
            )}
          </dd>
          <dt className="md:hidden">Mesero</dt>
          <dd className="text-right md:hidden">{t.mesero ?? '—'}</dd>
          <dt className="md:hidden">Comensales</dt>
          <dd className="text-right md:hidden">{t.comensales ?? '—'}</dd>
          <dt>Subtotal</dt>
          <dd className="text-right tabular-nums">{pesos(t.subtotal)}</dd>
          <dt>Impuestos</dt>
          <dd className="text-right tabular-nums">{pesos(t.impuestos)}</dd>
          <dt>Descuento de la cuenta</dt>
          <dd className="text-right tabular-nums">{pesos(t.descuentos)}</dd>
          <dt>Propina</dt>
          <dd className="text-right tabular-nums">{pesos(t.propina)}</dd>
          <dt className="font-medium">Total</dt>
          <dd className="text-right font-medium tabular-nums">{pesos(t.total)}</dd>
        </dl>
      </div>
    </div>
  );
}
