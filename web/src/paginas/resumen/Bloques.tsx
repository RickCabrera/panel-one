import { Link } from 'react-router';

import type { MesasSucursal, ProductoTop, Resumen, VentaSucursal } from '../../api/tipos';
import { aCentavos, pesos } from '../../dinero/dinero';
import { useAhora } from '../mesas/consultas';
import { armarMonitor } from '../mesas/reglas';
import { Esqueleto, ErrorTarjeta, SegunEstado, Tarjeta, Vacio } from '../inicio/Tarjeta';
import { edadLegible } from '../inicio/ventaEnVivo';
import type { Comparable } from './comparables';
import { delta, deltaImporte, diferenciaEnPesos, type Delta } from './delta';
import { avisoIncompleta, mejorYPeor } from './reglas';

/** Estado de una consulta de TanStack en su forma mínima. */
export interface Consulta<T> {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: T | undefined;
  dataUpdatedAt: number;
}

const SIN_VENTAS = 'Sin ventas en el periodo.';

function Cifra({ children, testId }: { children: string; testId: string }) {
  return (
    <div className="truncate text-2xl font-semibold tabular-nums" data-testid={testId}>
      {children}
    </div>
  );
}

/**
 * El Δ de una cifra contra su base, siempre con la base nombrada. Sin base, "—" y el porqué.
 * El signo va en el texto (no sólo en el color): se lee igual sin distinguir colores.
 */
export function Cambio({
  d,
  base,
  testId,
  dinero = true,
}: {
  d: Delta;
  base: string;
  testId: string;
  dinero?: boolean;
}) {
  if (d.tipo === 'sinBase') {
    return (
      <p className="mt-1 text-sm text-tinta-tenue" data-testid={testId}>
        <span className="font-medium">—</span> vs {base}: {d.razon}
      </p>
    );
  }
  const color =
    d.diferencia > 0n ? 'text-exito' : d.diferencia < 0n ? 'text-peligro' : 'text-tinta-suave';
  const diferencia = dinero
    ? diferenciaEnPesos(d.diferencia)
    : `${d.diferencia > 0n ? '+' : ''}${d.diferencia}`;
  return (
    <p className="mt-1 text-sm" data-testid={testId}>
      <span className={`font-medium tabular-nums ${color}`}>
        {d.porcentaje} ({diferencia})
      </span>{' '}
      <span className="text-tinta-tenue">vs {base}</span>
    </p>
  );
}

const sinVentasEn = (c: Comparable) => `sin ventas en ${c.etiqueta}.`;

/**
 * Venta de un tramo contra su base: "Hoy" y "Este mes". La venta del tramo actual es la MISMA
 * consulta que la tarjeta "Venta total" de Inicio (misma llave): nunca un segundo cálculo.
 */
export function TarjetaVentaComparada({
  titulo,
  testId,
  actual,
  base,
  comparable,
  mesas,
}: {
  titulo: string;
  testId: string;
  actual: Consulta<Resumen>;
  base: Consulta<Resumen>;
  comparable: Comparable;
  /** Con las mesas, avisa si la cifra puede venir incompleta (sucursales sin lectura). */
  mesas?: Consulta<MesasSucursal[]>;
}) {
  return (
    <Tarjeta titulo={titulo}>
      <SegunEstado consulta={actual} esqueleto={<Esqueleto lineas={1} />}>
        {(r) => (
          <>
            {r.cuentas === 0 ? (
              <Vacio>{SIN_VENTAS}</Vacio>
            ) : (
              <>
                <Cifra testId={testId}>{pesos(r.venta)}</Cifra>
                <p className="text-sm text-tinta-tenue">
                  {r.cuentas} {r.cuentas === 1 ? 'cuenta cerrada' : 'cuentas cerradas'}
                </p>
                <SegunEstado consulta={base} esqueleto={<Esqueleto lineas={0} />}>
                  {(b) => (
                    <Cambio
                      d={deltaImporte(r.venta, b.venta, b.cuentas, sinVentasEn(comparable))}
                      base={comparable.etiqueta}
                      testId={`${testId}-delta`}
                    />
                  )}
                </SegunEstado>
              </>
            )}
            {mesas && <AvisoIncompleta mesas={mesas} testId={`${testId}-aviso`} />}
          </>
        )}
      </SegunEstado>
    </Tarjeta>
  );
}

/** El reloj vive sólo aquí: envejece el dato cada 5 s sin volver a pintar la vista. */
function AvisoIncompleta({ mesas, testId }: { mesas: Consulta<MesasSucursal[]>; testId: string }) {
  const ahora = useAhora();
  const aviso = avisoIncompleta(mesas, ahora);
  if (!aviso) return null;
  return (
    <p className="mt-1 text-xs text-aviso" data-testid={testId}>
      {aviso}
    </p>
  );
}

/** Ticket promedio y comensales del periodo, cada uno con su base. */
export function TarjetaTicketComensales({
  actual,
  base,
  comparable,
}: {
  actual: Consulta<Resumen>;
  base: Consulta<Resumen>;
  comparable: Comparable;
}) {
  return (
    <Tarjeta titulo="Ticket promedio y comensales">
      <SegunEstado consulta={actual} esqueleto={<Esqueleto lineas={3} />}>
        {(r) =>
          r.cuentas === 0 ? (
            <Vacio>{SIN_VENTAS}</Vacio>
          ) : (
            <>
              {/* Mismo campo y mismo formato que "Ticket promedio" de Inicio. */}
              <Cifra testId="resumen-ticket-promedio">
                {r.ticketPromedio === null ? '—' : pesos(r.ticketPromedio)}
              </Cifra>
              <SegunEstado consulta={base} esqueleto={<Esqueleto lineas={0} />}>
                {(b) => (
                  <Cambio
                    d={deltaImporte(
                      r.ticketPromedio,
                      b.ticketPromedio,
                      b.cuentas,
                      sinVentasEn(comparable),
                    )}
                    base={comparable.etiqueta}
                    testId="resumen-ticket-promedio-delta"
                  />
                )}
              </SegunEstado>
              <h3 className="mt-3 text-xs font-medium text-tinta-tenue">Comensales</h3>
              <div className="text-lg font-semibold tabular-nums" data-testid="resumen-comensales">
                {r.comensales.total}
              </div>
              {r.comensales.cuentasConDato < r.cuentas && (
                <p className="text-xs text-tinta-tenue">
                  {r.comensales.cuentasConDato} de {r.cuentas} cuentas traían comensales.
                </p>
              )}
              <SegunEstado consulta={base} esqueleto={<Esqueleto lineas={0} />}>
                {(b) => (
                  <Cambio
                    d={
                      b.cuentas === 0
                        ? { tipo: 'sinBase', razon: sinVentasEn(comparable) }
                        : delta(
                            BigInt(r.comensales.total),
                            BigInt(b.comensales.total),
                            `sin comensales registrados en ${comparable.etiqueta}.`,
                          )
                    }
                    base={comparable.etiqueta}
                    testId="resumen-comensales-delta"
                    dinero={false}
                  />
                )}
              </SegunEstado>
            </>
          )
        }
      </SegunEstado>
    </Tarjeta>
  );
}

export function TarjetaSucursales({
  actual,
  base,
  comparable,
  sucursalElegida,
}: {
  actual: Consulta<VentaSucursal[]>;
  base: Consulta<VentaSucursal[]>;
  comparable: Comparable;
  sucursalElegida: boolean;
}) {
  return (
    <Tarjeta titulo="Mejor y peor sucursal">
      <SegunEstado consulta={actual} esqueleto={<Esqueleto lineas={3} />}>
        {(filas) => {
          if (sucursalElegida) {
            return <Vacio>Estás viendo una sola sucursal. Elige “Todas” para compararlas.</Vacio>;
          }
          if (filas.length < 2) {
            return <Vacio>La empresa tiene una sola sucursal: no hay contra quién comparar.</Vacio>;
          }
          const { mejor, peor, sinVenta, ilegibles } = mejorYPeor(filas);
          if (mejor === null) return <Vacio>{SIN_VENTAS}</Vacio>;
          const renglon = (titulo: string, f: VentaSucursal, id: string) => (
            <div className="mt-2" data-testid={id} data-sucursal={f.sucursalId}>
              <div className="text-xs font-medium text-tinta-tenue">{titulo}</div>
              <div className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="truncate">{f.nombre}</span>
                <span className="font-semibold tabular-nums" data-testid={`${id}-venta`}>
                  {pesos(f.venta)}
                </span>
              </div>
              <SegunEstado consulta={base} esqueleto={<Esqueleto lineas={0} />}>
                {(b) => {
                  const previa = b.find((x) => x.sucursalId === f.sucursalId);
                  return (
                    <Cambio
                      d={deltaImporte(
                        f.venta,
                        previa?.venta ?? null,
                        previa?.cuentas ?? 0,
                        `${f.nombre} no tuvo ventas en ${comparable.etiqueta}.`,
                      )}
                      base={comparable.etiqueta}
                      testId={`${id}-delta`}
                    />
                  );
                }}
              </SegunEstado>
            </div>
          );
          return (
            <>
              {renglon('Mejor', mejor, 'resumen-mejor')}
              {peor ? (
                renglon('Peor', peor, 'resumen-peor')
              ) : (
                <p className="mt-2 text-sm text-tinta-tenue">
                  Sólo una sucursal vendió en el periodo.
                </p>
              )}
              {sinVenta.length > 0 && (
                <p className="mt-2 text-xs text-aviso" data-testid="resumen-sin-venta">
                  Sin ventas en el periodo: {sinVenta.join(', ')}.
                </p>
              )}
              {ilegibles.length > 0 && (
                <p className="mt-1 text-xs text-tinta-tenue">
                  Sin importe legible, fuera del ranking: {ilegibles.join(', ')}.
                </p>
              )}
            </>
          );
        }}
      </SegunEstado>
    </Tarjeta>
  );
}

/** Top 5 por importe, con el importe de cada producto en la base. */
export function TarjetaTop5({
  actual,
  base,
  resumenBase,
  comparable,
}: {
  actual: Consulta<ProductoTop[]>;
  /** El top 50 de la base: de ahí sale el importe previo de cada uno de los 5. */
  base: Consulta<ProductoTop[]>;
  resumenBase: Consulta<Resumen>;
  comparable: Comparable;
}) {
  return (
    <Tarjeta titulo="Top 5 productos">
      <SegunEstado consulta={actual} esqueleto={<Esqueleto lineas={5} />}>
        {(filas) =>
          filas.length === 0 ? (
            <Vacio>{SIN_VENTAS}</Vacio>
          ) : (
            <>
              <ol className="space-y-2">
                {filas.map((f, i) => (
                  <li key={f.producto} data-testid={`resumen-top-${i + 1}`} className="min-w-0">
                    <div className="flex min-w-0 items-baseline justify-between gap-2">
                      <span className="truncate">
                        <span className="text-tinta-tenue tabular-nums">{i + 1}.</span> {f.producto}
                      </span>
                      <span className="tabular-nums">{pesos(f.importe)}</span>
                    </div>
                    <SegunEstado consulta={base} esqueleto={null}>
                      {(b) => (
                        <SegunEstado consulta={resumenBase} esqueleto={null}>
                          {(rb) => {
                            const previo = b.find((x) => x.producto === f.producto);
                            let d: Delta;
                            if (rb.cuentas === 0) {
                              d = { tipo: 'sinBase', razon: sinVentasEn(comparable) };
                            } else if (!previo) {
                              // Vendió o no, no está entre los 50 primeros: no hay cifra, no es cero.
                              d = {
                                tipo: 'sinBase',
                                razon: `fuera de los 50 más vendidos de ${comparable.etiqueta}.`,
                              };
                            } else {
                              d = delta(
                                aCentavos(f.importe),
                                aCentavos(previo.importe),
                                `sin importe en ${comparable.etiqueta}.`,
                              );
                            }
                            return (
                              <Cambio
                                d={d}
                                base={comparable.etiqueta}
                                testId={`resumen-top-${i + 1}-delta`}
                              />
                            );
                          }}
                        </SegunEstado>
                      )}
                    </SegunEstado>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs text-tinta-tenue">
                Importe de las partidas antes del descuento de la cuenta: no suma la venta.
              </p>
            </>
          )
        }
      </SegunEstado>
    </Tarjeta>
  );
}

/** Minutos a partir de los cuales una mesa abierta es alerta (backlog F2-220). */
export const MINUTOS_ALERTA_MESA = 60;

/**
 * Las alertas activas mientras no exista el centro de alertas (F2-224): sucursales que no
 * reportan y mesas con MÁS de 60 minutos. Se filtra por minutos, no por color del semáforo,
 * aunque hoy coincidan (`semaforo()` da rojo en > 60).
 */
export function TarjetaAlertas({
  mesas,
  enlaceMonitor,
}: {
  mesas: Consulta<MesasSucursal[]>;
  enlaceMonitor: string;
}) {
  const ahora = useAhora();
  return (
    <Tarjeta titulo="Alertas activas">
      {mesas.isError ? (
        <ErrorTarjeta error={mesas.error} />
      ) : mesas.isPending || mesas.data === undefined ? (
        <Esqueleto lineas={2} />
      ) : (
        <ListaAlertas
          filas={mesas.data}
          respuestaAt={mesas.dataUpdatedAt}
          ahora={ahora}
          enlaceMonitor={enlaceMonitor}
        />
      )}
    </Tarjeta>
  );
}

function ListaAlertas({
  filas,
  respuestaAt,
  ahora,
  enlaceMonitor,
}: {
  filas: MesasSucursal[];
  respuestaAt: number;
  ahora: number;
  enlaceMonitor: string;
}) {
  const monitor = armarMonitor(filas, respuestaAt, ahora);
  const alertas: { clave: string; texto: string }[] = [];
  for (const s of monitor.sucursales) {
    if (s.estado === 'desconectada') {
      alertas.push({
        clave: `suc-${s.sucursalId}`,
        texto: `${s.nombre}: desconectada, última lectura ${s.edadSegundos === null ? 'sin fecha' : edadLegible(s.edadSegundos)}.`,
      });
    } else if (s.estado === 'sin-reporte') {
      alertas.push({ clave: `suc-${s.sucursalId}`, texto: `${s.nombre}: nunca ha reportado.` });
    }
  }
  const largas = monitor.mesas
    .filter((m) => m.minutos !== null && m.minutos > MINUTOS_ALERTA_MESA)
    .sort((a, b) => (b.minutos ?? 0) - (a.minutos ?? 0));
  for (const m of largas) {
    alertas.push({
      clave: `mesa-${m.clave}`,
      texto: `Mesa ${m.mesa ?? 'sin nombre'} (${m.sucursal}): ${m.minutos} min abierta.`,
    });
  }
  return (
    <>
      {alertas.length === 0 ? (
        <Vacio>Sin alertas: todas las sucursales reportan y ninguna mesa pasa de 60 min.</Vacio>
      ) : (
        <ul className="space-y-1 text-sm" data-testid="resumen-alertas">
          {alertas.map((a) => (
            <li key={a.clave}>{a.texto}</li>
          ))}
        </ul>
      )}
      <Link
        to={enlaceMonitor}
        className="mt-3 inline-block text-sm text-acento-texto underline-offset-2 hover:underline"
      >
        Ver el monitor de mesas
      </Link>
    </>
  );
}
