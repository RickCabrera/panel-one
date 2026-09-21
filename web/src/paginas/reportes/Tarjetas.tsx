import { lazy, Suspense, useState, type ReactNode } from 'react';

import type { ProductoTop, VentaDia, VentaSucursal } from '../../api/tipos';
import { descargar, ErrorCsv } from '../../csv/csv';
import { aCentavos, formatearPesos, paraGrafica, pesos } from '../../dinero/dinero';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from '../inicio/Tarjeta';
import {
  cantidadLegible,
  etiquetaDia,
  totalComparativo,
  totalPorDia,
  type Totales,
} from './calculos';
import { LIMITES_TOP, type LimiteTop, type OrdenTop } from './consultas';
import type { Barra } from './graficas';

interface Consulta<T> {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: T | undefined;
}

// Recharts va en su propio chunk (como en el Panel de ventas).
const GraficaPorDia = lazy(() => import('./graficas').then((m) => ({ default: m.GraficaPorDia })));
const GraficaTop = lazy(() => import('./graficas').then((m) => ({ default: m.GraficaTop })));

const BOTON =
  'rounded-md border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50';
const TH = 'px-2 py-1 font-medium';
const NUM = 'px-2 py-1 text-right tabular-nums';

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Un total en centavos, o "Sin dato" si alguna fila traía un importe ilegible. */
const textoTotal = (centavos: bigint | null) =>
  centavos === null ? 'Sin dato' : formatearPesos(centavos);

/** Barra de un importe de la API: ilegible = sin barra, nunca una de $0.00. */
function barraDe(etiqueta: string, importe: string, detalle?: string): Barra {
  const centavos = aCentavos(importe);
  return {
    etiqueta,
    valor: centavos === null ? null : paraGrafica(centavos),
    texto: pesos(importe),
    detalle,
  };
}

/**
 * "Exportar CSV" de un reporte. Arma el archivo con los MISMOS datos que se ven en
 * pantalla; si alguno es ilegible, lo dice y no descarga nada.
 */
function BotonCsv({ nombre, generar }: { nombre: string; generar: () => string }) {
  const [error, setError] = useState<string | null>(null);
  const exportar = () => {
    try {
      descargar(nombre, generar());
      setError(null);
    } catch (e) {
      setError(e instanceof ErrorCsv ? e.message : 'No se pudo generar el archivo.');
    }
  };
  return (
    <div className="flex min-w-0 flex-col items-end gap-1">
      <button type="button" onClick={exportar} className={BOTON}>
        Exportar CSV
      </button>
      {error && (
        <p role="alert" className="text-right text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function Encabezado({ children, acciones }: { children?: ReactNode; acciones?: ReactNode }) {
  return (
    <div className="mb-3 flex min-w-0 flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 text-sm text-slate-500">{children}</div>
      {acciones}
    </div>
  );
}

function FilaTotal({ totales, children }: { totales: Totales; children?: ReactNode }) {
  return (
    <tr className="border-t-2 border-slate-300 font-semibold" data-testid="fila-total">
      <th scope="row" className="px-2 py-1 text-left">
        Total
      </th>
      <td className={NUM}>{textoTotal(totales.venta)}</td>
      <td className={NUM}>{totales.cuentas}</td>
      {children}
    </tr>
  );
}

// ---------------------------------------------------------------------------

export function ReportePorDia({
  consulta,
  nombreCsv,
  csv,
}: {
  consulta: Consulta<VentaDia[]>;
  nombreCsv: string;
  csv: (filas: VentaDia[]) => string;
}) {
  return (
    <Tarjeta titulo="Ventas por día" className="lg:col-span-2">
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={1} grafica />}>
        {(filas) => {
          const total = totalPorDia(filas);
          if (total.cuentas === 0 && total.venta === 0n) {
            return <Vacio>Sin ventas en este periodo.</Vacio>;
          }
          return (
            <>
              <Encabezado acciones={<BotonCsv nombre={nombreCsv} generar={() => csv(filas)} />}>
                <span
                  className="block text-2xl font-semibold text-slate-900 tabular-nums"
                  data-testid="total-por-dia"
                >
                  {textoTotal(total.venta)}
                </span>
                {plural(total.cuentas, 'cuenta cerrada', 'cuentas cerradas')} en{' '}
                {plural(filas.length, 'día', 'días')}. Cada cuenta cuenta en el día de cierre de su
                sucursal.
              </Encabezado>
              <Suspense fallback={<Esqueleto lineas={0} grafica />}>
                <GraficaPorDia
                  barras={filas.map((f) =>
                    barraDe(etiquetaDia(f.dia), f.venta, plural(f.cuentas, 'cuenta', 'cuentas')),
                  )}
                />
              </Suspense>
              <div className="mt-3 max-h-80 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white text-left text-slate-500">
                    <tr>
                      <th scope="col" className={TH}>
                        Día
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Venta
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Cuentas
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f) => (
                      <tr
                        key={f.dia}
                        className="border-t border-slate-100"
                        data-testid={`dia-${f.dia}`}
                      >
                        <td className="px-2 py-1">
                          {etiquetaDia(f.dia)}{' '}
                          <span className="text-xs text-slate-400">{f.dia}</span>
                        </td>
                        <td className={NUM}>{pesos(f.venta)}</td>
                        <td className={NUM}>{f.cuentas}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <FilaTotal totales={total} />
                  </tfoot>
                </table>
              </div>
            </>
          );
        }}
      </SegunEstado>
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------

export function ReporteComparativo({
  consulta,
  nombreCsv,
  csv,
}: {
  consulta: Consulta<VentaSucursal[]>;
  nombreCsv: string;
  csv: (filas: VentaSucursal[]) => string;
}) {
  return (
    <Tarjeta titulo="Comparativo entre sucursales" className="lg:col-span-2">
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={3} />}>
        {(filas) => {
          if (filas.length === 0) return <Vacio>No hay sucursales en este alcance.</Vacio>;
          const total = totalComparativo(filas);
          return (
            <>
              <Encabezado acciones={<BotonCsv nombre={nombreCsv} generar={() => csv(filas)} />}>
                Tickets = cuentas cerradas; las canceladas no cuentan ni suman.
              </Encabezado>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th scope="col" className={TH}>
                        Sucursal
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Venta
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Tickets
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Ticket promedio
                      </th>
                      <th scope="col" className={`${TH} hidden text-right sm:table-cell`}>
                        Comensales
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f) => (
                      <tr
                        key={f.sucursalId}
                        className="border-t border-slate-100"
                        data-testid={`sucursal-${f.sucursalId}`}
                      >
                        <td className="max-w-[12rem] truncate px-2 py-1">{f.nombre}</td>
                        <td className={NUM}>{pesos(f.venta)}</td>
                        <td className={NUM}>{f.cuentas}</td>
                        {/* Sin cuentas no hay promedio: "—", nunca $0.00. */}
                        <td className={NUM}>
                          {f.ticketPromedio === null ? '—' : pesos(f.ticketPromedio)}
                        </td>
                        <td className={`${NUM} hidden sm:table-cell`}>{f.comensales}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <FilaTotal totales={total}>
                      <td className={NUM} data-testid="total-ticket-promedio">
                        {total.ticketPromedio === null ? '—' : formatearPesos(total.ticketPromedio)}
                      </td>
                      <td className={`${NUM} hidden sm:table-cell`}>{total.comensales}</td>
                    </FilaTotal>
                  </tfoot>
                </table>
              </div>
            </>
          );
        }}
      </SegunEstado>
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------

export function ReporteTop({
  consulta,
  por,
  limite,
  onCambiarPor,
  onCambiarLimite,
  nombreCsv,
  csv,
}: {
  consulta: Consulta<ProductoTop[]>;
  por: OrdenTop;
  limite: LimiteTop;
  onCambiarPor: (por: OrdenTop) => void;
  onCambiarLimite: (limite: LimiteTop) => void;
  nombreCsv: string;
  csv: (filas: ProductoTop[]) => string;
}) {
  const controles = (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <div role="group" aria-label="Ordenar por" className="flex gap-1">
        {(['importe', 'cantidad'] as const).map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={por === o}
            onClick={() => onCambiarPor(o)}
            className={
              por === o
                ? 'rounded-md border border-acento bg-acento px-3 py-1 text-sm text-white'
                : BOTON
            }
          >
            {o === 'importe' ? 'Por importe' : 'Por cantidad'}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-1">
        Mostrar
        <select
          value={limite}
          onChange={(e) => onCambiarLimite(Number(e.target.value) as LimiteTop)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
        >
          {LIMITES_TOP.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  return (
    <Tarjeta titulo="Top productos" className="lg:col-span-2">
      <div className="mb-3">{controles}</div>
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={3} grafica />}>
        {(filas) => {
          if (filas.length === 0) return <Vacio>Sin productos vendidos en este periodo.</Vacio>;
          return (
            <>
              <Encabezado acciones={<BotonCsv nombre={nombreCsv} generar={() => csv(filas)} />}>
                El importe es el de las partidas antes del descuento de la cuenta: no se compara con
                la venta.
              </Encabezado>
              <Suspense fallback={<Esqueleto lineas={0} grafica />}>
                <GraficaTop
                  dinero={por === 'importe'}
                  barras={filas.map((f) =>
                    por === 'importe'
                      ? barraDe(f.producto, f.importe, `${cantidadLegible(f.cantidad)} vendidos`)
                      : {
                          etiqueta: f.producto,
                          valor: /^-?\d+(\.\d+)?$/.test(f.cantidad) ? Number(f.cantidad) : null,
                          texto: `${cantidadLegible(f.cantidad)} vendidos`,
                          detalle: pesos(f.importe),
                        },
                  )}
                />
              </Suspense>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th scope="col" className={`${TH} w-8`}>
                        #
                      </th>
                      <th scope="col" className={TH}>
                        Producto
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Importe
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        Cantidad
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f, i) => (
                      <tr
                        key={f.producto}
                        className="border-t border-slate-100"
                        data-testid={`top-${i + 1}`}
                      >
                        <td className="px-2 py-1 text-slate-400 tabular-nums">{i + 1}</td>
                        <td className="max-w-[14rem] truncate px-2 py-1">{f.producto}</td>
                        <td className={NUM}>{pesos(f.importe)}</td>
                        <td className={NUM}>{cantidadLegible(f.cantidad)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          );
        }}
      </SegunEstado>
    </Tarjeta>
  );
}
