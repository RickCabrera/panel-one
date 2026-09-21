import { lazy, Suspense } from 'react';

import type { FormaPago, FormasPago, MesasSucursal, Resumen, VentaHora } from '../../api/tipos';
import {
  aCentavos,
  formatearPesos,
  paraGrafica,
  pesos,
  porcentaje,
  sumar,
} from '../../dinero/dinero';
import type { Rango } from '../../filtros/periodo';
import { COLORES_FORMA, datosPorHora } from './puntosHora';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from './Tarjeta';
import { edadLegible, ventaEnVivo } from './ventaEnVivo';

interface Consulta<T> {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: T | undefined;
}

// Recharts pesa más que todo el resto del panel: va en su propio chunk y sólo se
// descarga al abrir el dashboard.
const GraficaPorHora = lazy(() =>
  import('./graficas').then((m) => ({ default: m.GraficaPorHora })),
);
const Dona = lazy(() => import('./graficas').then((m) => ({ default: m.Dona })));

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

function Cifra({ children, testId }: { children: string; testId: string }) {
  return (
    <div className="truncate text-2xl font-semibold tabular-nums" data-testid={testId}>
      {children}
    </div>
  );
}

const MS_DIA = 86_400_000;

function diasDe(rango: Rango): number {
  return (Date.parse(rango.hasta) - Date.parse(rango.desde)) / MS_DIA + 1;
}

export function TarjetaVentaTotal({
  resumen,
  porHora,
  rango,
}: {
  resumen: Consulta<Resumen>;
  porHora: Consulta<VentaHora[]>;
  rango: Rango;
}) {
  const dias = diasDe(rango);
  return (
    <Tarjeta titulo="Venta total" className="lg:col-span-2">
      <SegunEstado consulta={resumen} esqueleto={<Esqueleto lineas={1} grafica />}>
        {(r) =>
          r.cuentas === 0 ? (
            <Vacio>Sin ventas en este periodo.</Vacio>
          ) : (
            <>
              <Cifra testId="venta-total">{pesos(r.venta)}</Cifra>
              <p className="text-sm text-slate-500">
                {plural(r.cuentas, 'cuenta cerrada', 'cuentas cerradas')}
                {r.cancelados.cuentas > 0 &&
                  ` · ${plural(r.cancelados.cuentas, 'cancelada', 'canceladas')} (no suman)`}
              </p>
              <h3 className="mt-4 text-xs font-medium text-slate-500">
                {dias === 1
                  ? 'Venta por hora de cierre'
                  : `Venta por hora de cierre (suma de los ${dias} días)`}
              </h3>
              <SegunEstado consulta={porHora} esqueleto={<Esqueleto lineas={0} grafica />}>
                {(filas) => (
                  <Suspense fallback={<Esqueleto lineas={0} grafica />}>
                    <GraficaPorHora puntos={datosPorHora(filas)} />
                  </Suspense>
                )}
              </SegunEstado>
            </>
          )
        }
      </SegunEstado>
    </Tarjeta>
  );
}

const NOMBRE_FORMA: Record<FormaPago, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  otro: 'Otro',
};

export function TarjetaFormasPago({ consulta }: { consulta: Consulta<FormasPago> }) {
  return (
    <Tarjeta titulo="Formas de pago">
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={4} />}>
        {(datos) => {
          const formas = datos.formas.map((f, i) => ({
            ...f,
            centavos: aCentavos(f.monto) ?? 0n,
            color: COLORES_FORMA[i % COLORES_FORMA.length],
          }));
          // El % es sobre lo PAGADO (Σ formas, `otro` incluido), no sobre la venta:
          // los pagos traen la propina y no tienen por qué coincidir con ella.
          const total = sumar(formas.map((f) => f.centavos));
          if (total === 0n) return <Vacio>Sin pagos en este periodo.</Vacio>;
          return (
            <>
              <div className="flex flex-col items-center gap-4 sm:flex-row">
                <Suspense fallback={<div className="h-44 w-44 shrink-0" />}>
                  <Dona
                    datos={formas
                      .filter((f) => f.centavos > 0n)
                      .map((f) => ({
                        nombre: NOMBRE_FORMA[f.forma],
                        valor: paraGrafica(f.centavos),
                        color: f.color,
                      }))}
                  />
                </Suspense>
                <ul className="w-full min-w-0 space-y-1 text-sm">
                  {formas.map((f) => (
                    <li
                      key={f.forma}
                      className="flex items-center gap-2"
                      data-testid={`forma-${f.forma}`}
                    >
                      <span
                        aria-hidden="true"
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: f.color }}
                      />
                      <span className="min-w-0 flex-1 truncate">{NOMBRE_FORMA[f.forma]}</span>
                      <span className="tabular-nums">{formatearPesos(f.centavos)}</span>
                      <span className="w-16 text-right text-slate-500 tabular-nums">
                        {porcentaje(f.centavos, total)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {datos.sinCatalogo.length > 0 && (
                <p className="mt-3 text-xs text-slate-500">
                  "Otro" incluye formas del POS sin catálogo:{' '}
                  {datos.sinCatalogo.map((s) => `${s.formaRaw} (${pesos(s.monto)})`).join(', ')}.
                </p>
              )}
            </>
          );
        }}
      </SegunEstado>
    </Tarjeta>
  );
}

export function TarjetaVentaEnVivo({ consulta }: { consulta: Consulta<MesasSucursal[]> }) {
  return (
    <Tarjeta titulo="Venta en vivo">
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto />}>
        {(filas) => {
          const vivo = ventaEnVivo(filas);
          if (vivo.reportando === 0) {
            return <Vacio>Ninguna sucursal ha reportado sus mesas todavía.</Vacio>;
          }
          return (
            <>
              <Cifra testId="venta-en-vivo">
                {vivo.total === null ? 'Sin dato' : formatearPesos(vivo.total)}
              </Cifra>
              <p className="text-sm text-slate-500">
                {plural(vivo.mesas, 'mesa abierta', 'mesas abiertas')}
                {vivo.edadMaximaSegundos !== null &&
                  ` · dato de ${edadLegible(vivo.edadMaximaSegundos)}`}
              </p>
              {vivo.total === null && (
                <p className="mt-1 text-xs text-slate-500">
                  Alguna mesa no trae un importe legible; no se muestra una suma incompleta.
                </p>
              )}
              {vivo.sinReporte.length > 0 && (
                <p className="mt-1 text-xs text-amber-700">
                  Sin reporte todavía: {vivo.sinReporte.join(', ')}.
                </p>
              )}
            </>
          );
        }}
      </SegunEstado>
    </Tarjeta>
  );
}

export function TarjetaTicketPromedio({ consulta }: { consulta: Consulta<Resumen> }) {
  return (
    <Tarjeta titulo="Ticket promedio">
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={2} />}>
        {(r) =>
          r.cuentas === 0 ? (
            <Vacio>Sin cuentas en este periodo.</Vacio>
          ) : (
            <>
              {/* Un promedio sin divisor es null en la API: se muestra "—", nunca $0.00. */}
              <Cifra testId="ticket-promedio">
                {r.ticketPromedio === null ? '—' : pesos(r.ticketPromedio)}
              </Cifra>
              <dl className="mt-1 space-y-0.5 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Comensales</dt>
                  <dd className="tabular-nums" data-testid="comensales">
                    {r.comensales.total}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Por comensal</dt>
                  <dd className="tabular-nums" data-testid="por-comensal">
                    {r.comensales.promedioPorComensal === null
                      ? '—'
                      : pesos(r.comensales.promedioPorComensal)}
                  </dd>
                </div>
              </dl>
              {r.comensales.cuentasConDato < r.cuentas && (
                <p className="mt-1 text-xs text-slate-500">
                  {r.comensales.cuentasConDato} de {r.cuentas} cuentas traían comensales.
                </p>
              )}
            </>
          )
        }
      </SegunEstado>
    </Tarjeta>
  );
}

export function TarjetaDescuentos({ consulta }: { consulta: Consulta<Resumen> }) {
  return (
    <Tarjeta titulo="Descuentos y cortesías">
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={2} />}>
        {(r) =>
          r.cuentas === 0 ? (
            <Vacio>Sin cuentas en este periodo.</Vacio>
          ) : (
            <>
              <Cifra testId="descuentos">{pesos(r.descuentos.monto)}</Cifra>
              <p className="text-sm text-slate-500">
                en {plural(r.descuentos.cuentas, 'cuenta', 'cuentas')}
              </p>
              <dl className="mt-2 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Cortesías</dt>
                  {/* La API siempre manda null: el modelo aún no distingue una cortesía. */}
                  <dd data-testid="cortesias">Sin dato</dd>
                </div>
              </dl>
              <p className="mt-1 text-xs text-slate-500">
                El POS todavía no nos dice qué cuenta fue cortesía.
              </p>
            </>
          )
        }
      </SegunEstado>
    </Tarjeta>
  );
}
