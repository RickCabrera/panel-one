import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CreditCard,
  Radio,
  ReceiptText,
  TicketPercent,
} from 'lucide-react';
import { lazy, Suspense } from 'react';

import type { FormasPago, MesasSucursal, Resumen, VentaHora } from '../../api/tipos';
import {
  aCentavos,
  formatearPesos,
  paraGrafica,
  pesos,
  porcentaje,
  sumar,
} from '../../dinero/dinero';
import type { Rango } from '../../filtros/periodo';
import { Isotipo } from '../../marca/Marca';
import { useTema } from '../../tema/contexto';
import { useAhora } from '../mesas/consultas';
import type { Comparable } from '../resumen/comparables';
import { deltaImporte, diferenciaEnPesos, type Delta } from '../resumen/delta';
import { CifraAnimada } from './CifraAnimada';
import { etiquetaForma } from './formasPago';
import { datosPorHora, SERIES_FORMA, ticketPorHora } from './puntosHora';
import { Latido, Sparkline } from './Sparkline';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from './Tarjeta';
import { edadLegible, ventaEnVivo } from './ventaEnVivo';

interface Consulta<T> {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: T | undefined;
  /** Cuándo llegó la última respuesta buena (TanStack Query). */
  dataUpdatedAt: number;
}

// Recharts pesa más que todo el resto del panel: va en su propio chunk y sólo se
// descarga al abrir el dashboard.
const GraficaPorHora = lazy(() =>
  import('./graficas').then((m) => ({ default: m.GraficaPorHora })),
);
const Dona = lazy(() => import('./graficas').then((m) => ({ default: m.Dona })));

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** UI-05: la cifra de una tarjeta KPI. Grande, tabular (no baila al contar) y apretada. */
export const CIFRA_KPI = 'truncate text-3xl font-semibold tracking-tight tabular-nums text-tinta';

/** Un importe de la API que cuenta al cambiar. Ilegible: lo que diga `pesos` ("Importe inválido"). */
function Pesos({ texto }: { texto: string }) {
  const centavos = aCentavos(texto);
  return <CifraAnimada valor={centavos} formato={formatearPesos} sinValor={pesos(texto)} />;
}

const MS_DIA = 86_400_000;

function diasDe(rango: Rango): number {
  return (Date.parse(rango.hasta) - Date.parse(rango.desde)) / MS_DIA + 1;
}

/**
 * El cambio contra la base, dentro del hero (UI-05): flecha, % y la diferencia en pesos, con
 * la base nombrada. El signo va en el texto y la flecha en el icono: no depende del color.
 * Sin base: "—" y el porqué (misma regla que el Resumen, F2-220).
 */
function CambioHero({ d, base, testId }: { d: Delta; base: string; testId: string }) {
  if (d.tipo === 'sinBase') {
    return (
      <p className="mt-3 text-sm text-hero-tenue" data-testid={testId}>
        <span className="font-medium text-hero-tinta">—</span> vs {base}: {d.razon}
      </p>
    );
  }
  const sube = d.diferencia > 0n;
  const baja = d.diferencia < 0n;
  const Flecha = sube ? ArrowUpRight : baja ? ArrowDownRight : ArrowRight;
  const color = sube ? 'text-hero-sube' : baja ? 'text-hero-baja' : 'text-hero-tinta';
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-testid={testId}>
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-hero-tinta/10 py-0.5 pr-2.5 pl-1.5 font-semibold tabular-nums ring-1 ring-hero-tinta/15 ring-inset ${color}`}
      >
        <Flecha
          aria-hidden="true"
          className="h-4 w-4"
          data-flecha={sube ? 'arriba' : baja ? 'abajo' : 'lado'}
        />
        {d.porcentaje} ({diferenciaEnPesos(d.diferencia)})
      </span>
      <span className="text-hero-tenue">vs {base}</span>
    </p>
  );
}

/**
 * El hero del Inicio (UI-05): la venta del periodo, grande, sobre el morado de la marca, con su
 * comparación (sólo "Hoy": contra el mismo día de la semana pasada a esta hora) y la gráfica
 * por hora. Sigue siendo la región "Venta total" de siempre.
 */
export function TarjetaVentaTotal({
  resumen,
  porHora,
  rango,
  horaTope,
  base,
  comparable,
  className = '',
}: {
  resumen: Consulta<Resumen>;
  porHora: Consulta<VentaHora[]>;
  rango: Rango;
  /** Hora en curso (0–23) cuando el rango es sólo hoy: la gráfica no dibuja el futuro. */
  horaTope?: number;
  /** La misma consulta con el rango de la base (y `alturaAl`); sin ella no hay comparación. */
  base?: Consulta<Resumen>;
  comparable?: Comparable | null;
  className?: string;
}) {
  const dias = diasDe(rango);
  return (
    <section
      aria-label="Venta total"
      className={`relative isolate min-w-0 overflow-hidden rounded-2xl border border-hero-borde bg-linear-135 from-hero to-hero-fin p-5 text-hero-tinta shadow-hero md:p-6 ${className}`}
    >
      {/* El ojo de la marca, enorme y apagado, vigilando la venta. Decorativo. */}
      <Isotipo
        variante="oscuro"
        decorativo
        className="pointer-events-none absolute -top-10 -right-14 -z-10 h-72 w-72 opacity-[0.07] md:-top-16 md:-right-10 md:h-96 md:w-96"
      />
      <h2 className="font-sans text-sm font-medium text-hero-tenue">Venta total</h2>
      <SegunEstado
        consulta={resumen}
        tono="hero"
        esqueleto={<Esqueleto lineas={1} grafica tono="hero" />}
      >
        {(r) =>
          r.cuentas === 0 ? (
            <Vacio tono="hero">Sin ventas en este periodo.</Vacio>
          ) : (
            <>
              <div
                className="mt-1 truncate text-[2.5rem] leading-none font-semibold tracking-tight text-hero-cifra tabular-nums md:text-5xl"
                data-testid="venta-total"
              >
                <Pesos texto={r.venta} />
              </div>
              {base && comparable && (
                <SegunEstado
                  consulta={base}
                  tono="hero"
                  esqueleto={<div className="mt-3 h-6 w-56 rounded-full bg-hero-tinta/10" />}
                >
                  {(b) => (
                    <CambioHero
                      d={deltaImporte(
                        r.venta,
                        b.venta,
                        b.cuentas,
                        `sin ventas en ${comparable.etiqueta}.`,
                      )}
                      base={comparable.etiqueta}
                      testId="venta-total-delta"
                    />
                  )}
                </SegunEstado>
              )}
              <p className="mt-2 text-sm text-hero-tenue">
                {plural(r.cuentas, 'cuenta cerrada', 'cuentas cerradas')}
                {r.cancelados.cuentas > 0 &&
                  ` · ${plural(r.cancelados.cuentas, 'cancelada', 'canceladas')} (no suman)`}
              </p>
              <h3 className="mt-6 font-sans text-xs font-medium text-hero-tenue">
                {dias === 1
                  ? 'Venta por hora de cierre'
                  : `Venta por hora de cierre (suma de los ${dias} días)`}
              </h3>
              <SegunEstado
                consulta={porHora}
                tono="hero"
                esqueleto={<Esqueleto lineas={0} grafica tono="hero" />}
              >
                {(filas) => {
                  const puntos = datosPorHora(filas, horaTope);
                  return (
                    <>
                      <div
                        className="-mx-1 mt-2"
                        data-testid="grafica-por-hora"
                        data-horas={puntos.length}
                      >
                        <Suspense fallback={<Esqueleto lineas={0} grafica tono="hero" />}>
                          <GraficaPorHora puntos={puntos} sobreHero />
                        </Suspense>
                      </div>
                      {puntos.some((p) => p.valor === null) && (
                        <p className="mt-1 text-xs text-hero-tenue" data-testid="horas-sin-dato">
                          Alguna hora no trae un importe legible; la línea se corta ahí.
                        </p>
                      )}
                    </>
                  );
                }}
              </SegunEstado>
            </>
          )
        }
      </SegunEstado>
    </section>
  );
}

export function TarjetaFormasPago({
  consulta,
  className = '',
}: {
  consulta: Consulta<FormasPago>;
  className?: string;
}) {
  const { colores } = useTema();
  return (
    <Tarjeta titulo="Formas de pago" icono={CreditCard} className={className}>
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={4} />}>
        {(datos) => {
          const formas = datos.formas.map((f, i) => ({
            ...f,
            // `null` = importe ilegible: se dice "Sin dato", nunca $0.00 (F1-094).
            centavos: aCentavos(f.monto),
            color: colores[SERIES_FORMA[i % SERIES_FORMA.length]],
          }));
          const legibles = formas.flatMap((f) =>
            f.centavos === null ? [] : [{ ...f, centavos: f.centavos }],
          );
          // Con UNA forma ilegible la base está incompleta: ni % ni dona, que son
          // proporciones sobre esa base y se leerían como completas.
          const completa = legibles.length === formas.length;
          // El % es sobre lo PAGADO (Σ formas, `otro` incluido), no sobre la venta:
          // los pagos traen la propina y no tienen por qué coincidir con ella.
          const total = completa ? sumar(legibles.map((f) => f.centavos)) : null;
          if (total === 0n) return <Vacio>Sin pagos en este periodo.</Vacio>;
          return (
            <>
              {/* La dona va al lado de la lista según el ancho de la TARJETA
                  (container query), no el de la pantalla: en la rejilla de 3 y 4
                  columnas la tarjeta mide ~220–360 px aunque la pantalla sea ancha, y
                  al lado de la dona la leyenda se quedaba en 0–84 px (F2-203). */}
              <div className="@container">
                <div className="flex flex-col items-center gap-5 @md:flex-row">
                  {total !== null && (
                    <div data-testid="dona-formas" className="shrink-0">
                      <Suspense fallback={<div className="h-44 w-44 shrink-0" />}>
                        <Dona
                          datos={legibles
                            .filter((f) => f.centavos > 0n)
                            .map((f) => ({
                              nombre: etiquetaForma(f.forma),
                              valor: paraGrafica(f.centavos),
                              color: f.color,
                            }))}
                          centro={{ etiqueta: 'Pagado', valor: formatearPesos(total) }}
                        />
                      </Suspense>
                    </div>
                  )}
                  <ul className="w-full min-w-0 divide-y divide-linea-suave text-sm">
                    {formas.map((f) => (
                      <li
                        key={f.forma}
                        className="flex flex-wrap items-center gap-x-2.5 py-1.5"
                        data-testid={`forma-${f.forma}`}
                      >
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-superficie"
                          style={{ backgroundColor: f.color }}
                        />
                        {/* Sin `truncate` ni `min-w-0`: a lo angosto el nombre salía `E…`/`T…`
                          y no se distinguía tarjeta de transferencia (F2-203). Su ancho mínimo
                          es el de la palabra: si no cabe junto al importe, el importe baja de
                          renglón (`flex-wrap`); el nombre nunca se recorta. */}
                        <span
                          className="flex-1 whitespace-nowrap text-tinta-medio"
                          data-testid="nombre-forma"
                        >
                          {etiquetaForma(f.forma)}
                        </span>
                        <span className="font-medium tabular-nums">
                          {f.centavos === null ? 'Sin dato' : formatearPesos(f.centavos)}
                        </span>
                        {total !== null && f.centavos !== null && (
                          <span className="w-14 text-right text-xs text-tinta-tenue tabular-nums">
                            {porcentaje(f.centavos, total)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              {total === null && (
                <p className="mt-3 text-xs text-tinta-tenue" data-testid="formas-incompletas">
                  Alguna forma de pago no trae un importe legible; no se muestran porcentajes sobre
                  una suma incompleta.
                </p>
              )}
              {datos.sinCatalogo.length > 0 && (
                <p className="mt-3 text-xs text-tinta-tenue">
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

export function TarjetaVentaEnVivo({
  consulta,
  className = '',
}: {
  consulta: Consulta<MesasSucursal[]>;
  className?: string;
}) {
  return (
    <Tarjeta titulo="Venta en vivo" icono={Radio} className={className}>
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto />}>
        {(filas) => <VentaEnVivoCifras filas={filas} respuestaAt={consulta.dataUpdatedAt} />}
      </SegunEstado>
    </Tarjeta>
  );
}

/**
 * La misma cifra que "En curso" del Monitor (`ventaEnVivo`, F1-094). El reloj vive
 * sólo aquí: envejece el dato cada 5 s sin volver a pintar las gráficas del Panel.
 */
function VentaEnVivoCifras({
  filas,
  respuestaAt,
}: {
  filas: MesasSucursal[];
  respuestaAt: number;
}) {
  const ahora = useAhora();
  const vivo = ventaEnVivo(filas, respuestaAt, ahora);
  if (vivo.reportando === 0) {
    return <Vacio>Ninguna sucursal ha reportado sus mesas todavía.</Vacio>;
  }
  const fuera = (
    <>
      {vivo.desconectadas.length > 0 && (
        <p className="mt-2 text-xs text-aviso" data-testid="vivo-desconectadas">
          Desconectadas, sin contar: {vivo.desconectadas.join(', ')}.
        </p>
      )}
      {vivo.sinReporte.length > 0 && (
        <p className="mt-2 text-xs text-aviso">
          Sin reporte todavía: {vivo.sinReporte.join(', ')}.
        </p>
      )}
    </>
  );
  if (vivo.conectadas === 0) {
    // Igual que el Monitor: sin ninguna conectada no hay cifra, ni siquiera $0.00.
    return (
      <>
        <Vacio>No hay datos en vivo que mostrar.</Vacio>
        {fuera}
      </>
    );
  }
  return (
    <>
      <div className="flex min-w-0 items-center gap-3">
        <div className={CIFRA_KPI} data-testid="venta-en-vivo">
          <CifraAnimada valor={vivo.total} formato={formatearPesos} sinValor="Sin dato" />
        </div>
        <Latido />
      </div>
      <p className="mt-1 text-sm text-tinta-suave">
        {plural(vivo.mesas, 'mesa abierta', 'mesas abiertas')}
        {vivo.edadMaximaSegundos !== null && ` · dato de ${edadLegible(vivo.edadMaximaSegundos)}`}
      </p>
      {vivo.total === null && (
        <p className="mt-1 text-xs text-tinta-tenue">
          Alguna mesa no trae un importe legible; no se muestra una suma incompleta.
        </p>
      )}
      {fuera}
    </>
  );
}

export function TarjetaTicketPromedio({
  consulta,
  porHora,
  className = '',
}: {
  consulta: Consulta<Resumen>;
  /** UI-05: con la venta por hora, la tendencia del ticket a lo largo del día. */
  porHora?: Consulta<VentaHora[]>;
  className?: string;
}) {
  const tendencia = porHora?.data ? ticketPorHora(porHora.data) : [];
  return (
    <Tarjeta
      titulo="Ticket promedio"
      icono={ReceiptText}
      className={className}
      accion={
        <Sparkline
          valores={tendencia}
          etiqueta="Tendencia del ticket promedio por hora de cierre"
          className="h-7 w-20 text-serie-1"
        />
      }
    >
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={2} />}>
        {(r) =>
          r.cuentas === 0 ? (
            <Vacio>Sin cuentas en este periodo.</Vacio>
          ) : (
            <>
              {/* Un promedio sin divisor es null en la API: se muestra "—", nunca $0.00. */}
              <div className={CIFRA_KPI} data-testid="ticket-promedio">
                {r.ticketPromedio === null ? '—' : <Pesos texto={r.ticketPromedio} />}
              </div>
              <dl className="mt-3 space-y-1 border-t border-linea-suave pt-3 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-tinta-suave">Comensales</dt>
                  <dd className="font-medium tabular-nums" data-testid="comensales">
                    {r.comensales.total}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-tinta-suave">Por comensal</dt>
                  <dd className="font-medium tabular-nums" data-testid="por-comensal">
                    {r.comensales.promedioPorComensal === null
                      ? '—'
                      : pesos(r.comensales.promedioPorComensal)}
                  </dd>
                </div>
              </dl>
              {r.comensales.cuentasConDato < r.cuentas && (
                <p className="mt-2 text-xs text-tinta-tenue">
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

export function TarjetaDescuentos({
  consulta,
  className = '',
}: {
  consulta: Consulta<Resumen>;
  className?: string;
}) {
  return (
    <Tarjeta titulo="Descuentos y cortesías" icono={TicketPercent} className={className}>
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={2} />}>
        {(r) =>
          r.cuentas === 0 ? (
            <Vacio>Sin cuentas en este periodo.</Vacio>
          ) : (
            <>
              <div className={CIFRA_KPI} data-testid="descuentos">
                <Pesos texto={r.descuentos.monto} />
              </div>
              <p className="mt-1 text-sm text-tinta-suave">
                en {plural(r.descuentos.cuentas, 'cuenta', 'cuentas')}
              </p>
              <dl className="mt-3 border-t border-linea-suave pt-3 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-tinta-suave">Cortesías</dt>
                  {/* La API siempre manda null: el modelo aún no distingue una cortesía. */}
                  <dd className="font-medium" data-testid="cortesias">
                    Sin dato
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-tinta-tenue">
                El POS todavía no nos dice qué cuenta fue cortesía.
              </p>
            </>
          )
        }
      </SegunEstado>
    </Tarjeta>
  );
}
