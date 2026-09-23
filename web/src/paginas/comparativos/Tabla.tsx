import type { ReactNode } from 'react';

import { pesos } from '../../dinero/dinero';
import { puntosPorcentuales, tasaTexto } from '../facturacion/tablero/reglas';
import { diferenciaEnPesos, type Delta } from '../resumen/delta';
import {
  deltaDe,
  METRICAS,
  tieneDatos,
  type Cifras,
  type FilaComparada,
  type FilaOrdenada,
  type Metrica,
  UTILIDAD_SOBRESTIMADA,
} from './matriz';

const TH = 'px-2 py-1 font-medium';
const NUM = 'px-2 py-1 text-right tabular-nums whitespace-nowrap';

export const SIN_CUENTAS = 'Sin cuentas en el periodo.';
export const COMENSALES_CERO =
  'Cero comensales: el comparativo por sucursal no distingue “no se registraron” de “cero”.';

/** Una cifra de un periodo. Sin cuentas: "—", nunca $0.00 ni 0. */
function Cifra({ c, m, testId }: { c: Cifras | null; m: Metrica; testId: string }) {
  let contenido: ReactNode;
  let titulo: string | undefined;
  if (!tieneDatos(c)) {
    contenido = '—';
    titulo = SIN_CUENTAS;
  } else if (m === 'venta') {
    contenido = pesos(c.venta);
  } else if (m === 'ticketPromedio') {
    contenido = c.ticketPromedio === null ? '—' : pesos(c.ticketPromedio);
  } else if (m === 'utilidad') {
    // F2-126: nula = "—" con su porqué; costo incompleto = cifra con asterisco y la salvedad.
    if (c.utilidad.importe === null) {
      contenido = '—';
      titulo = c.utilidad.razon ?? undefined;
    } else if (c.utilidad.sobrestimada) {
      contenido = (
        <>
          {pesos(c.utilidad.importe)}*<span className="sr-only"> ({UTILIDAD_SOBRESTIMADA})</span>
        </>
      );
      titulo = UTILIDAD_SOBRESTIMADA;
    } else {
      contenido = pesos(c.utilidad.importe);
    }
  } else if (m === 'tasaFacturacion') {
    // F2-106: nula = "—" con su porqué (sin venta o sin lectura), nunca 0 %.
    contenido = tasaTexto(c.tasa.valor) ?? '—';
    if (c.tasa.valor === null) titulo = c.tasa.razon ?? undefined;
  } else if (m === 'cuentas') {
    contenido = c.cuentas;
  } else {
    contenido = c.comensales;
    if (c.comensales === 0) titulo = COMENSALES_CERO;
  }
  return (
    <td className={NUM} data-testid={testId} title={titulo}>
      {contenido}
    </td>
  );
}

/** Δ compacto para la celda: % arriba y diferencia abajo; sin base, "—" con el porqué. */
function CeldaDelta({
  d,
  dinero,
  puntos = false,
  testId,
  aviso,
}: {
  d: Delta;
  dinero: boolean;
  /** La diferencia viene en diezmilésimas (tasa): se pinta en puntos porcentuales. */
  puntos?: boolean;
  testId: string;
  /** Salvedad que el Δ no puede quitarse (comensales en 0 que quizá no se registraron). */
  aviso?: string;
}) {
  if (d.tipo === 'sinBase') {
    return (
      <td className={`${NUM} text-tinta-tenue`} data-testid={testId} title={d.razon}>
        —<span className="sr-only"> ({d.razon})</span>
      </td>
    );
  }
  const color =
    d.diferencia > 0n ? 'text-exito' : d.diferencia < 0n ? 'text-peligro' : 'text-tinta-suave';
  const diferencia = dinero
    ? diferenciaEnPesos(d.diferencia)
    : puntos
      ? `${d.diferencia > 0n ? '+' : ''}${puntosPorcentuales(d.diferencia)} pp`
      : `${d.diferencia > 0n ? '+' : ''}${d.diferencia}`;
  return (
    <td className={`${NUM} ${color}`} data-testid={testId} title={aviso}>
      <div className="font-medium">{d.porcentaje}</div>
      <div className="text-xs">{diferencia}</div>
    </td>
  );
}

function Celdas({ fila }: { fila: Pick<FilaComparada, 'a' | 'b'> }) {
  return (
    <>
      {METRICAS.map(({ metrica, dinero }) => (
        <MetricaCeldas key={metrica} fila={fila} m={metrica} dinero={dinero} />
      ))}
    </>
  );
}

function MetricaCeldas({
  fila,
  m,
  dinero,
}: {
  fila: Pick<FilaComparada, 'a' | 'b'>;
  m: Metrica;
  dinero: boolean;
}) {
  return (
    <>
      <Cifra c={fila.a} m={m} testId={`${m}-a`} />
      <Cifra c={fila.b} m={m} testId={`${m}-b`} />
      <CeldaDelta
        d={deltaDe(fila, m)}
        dinero={dinero}
        puntos={m === 'tasaFacturacion'}
        testId={`${m}-delta`}
        // Con 0 comensales en A el Δ sale −100 %, pero ese 0 puede ser "no se registraron".
        aviso={
          m === 'comensales' && tieneDatos(fila.a) && fila.a.comensales === 0
            ? COMENSALES_CERO
            : undefined
        }
      />
    </>
  );
}

/**
 * La matriz: la fila de total arriba (fuera del ranking) y una fila por sucursal en el orden
 * del ranking. Con scroll horizontal PROPIO: a 390 px la tabla se desliza dentro de su
 * tarjeta y la página no.
 */
export function TablaComparativos({
  total,
  etiquetaTotal,
  filas,
}: {
  total: Pick<FilaComparada, 'a' | 'b'>;
  etiquetaTotal: string;
  filas: readonly FilaOrdenada[];
}) {
  return (
    <div className="max-w-full overflow-x-auto" data-testid="tabla-comparativos">
      <table className="w-full min-w-max text-sm">
        <thead className="text-left text-tinta-tenue">
          <tr>
            <th scope="col" rowSpan={2} className={`${TH} text-right`}>
              #
            </th>
            <th scope="col" rowSpan={2} className={TH}>
              Sucursal
            </th>
            {METRICAS.map(({ metrica, nombre }) => (
              <th
                key={metrica}
                scope="colgroup"
                colSpan={3}
                className={`${TH} border-l border-linea-suave text-center`}
              >
                {nombre}
              </th>
            ))}
          </tr>
          <tr>
            {METRICAS.map(({ metrica }) => (
              <PeriodosEncabezado key={metrica} />
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t-2 border-linea-fuerte font-semibold" data-testid="fila-total">
            <td className={NUM} />
            <th scope="row" className="px-2 py-1 text-left">
              {etiquetaTotal}
            </th>
            <Celdas fila={total} />
          </tr>
          {filas.map(({ fila, posicion }) => (
            <tr
              key={fila.id}
              className="border-t border-linea-suave"
              data-testid={`fila-${fila.id}`}
            >
              <td className={NUM} data-testid="posicion">
                {posicion ?? '—'}
              </td>
              <th scope="row" className="px-2 py-1 text-left font-normal">
                {fila.nombre}
              </th>
              <Celdas fila={fila} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PeriodosEncabezado() {
  return (
    <>
      <th scope="col" className={`${TH} border-l border-linea-suave text-right`}>
        A
      </th>
      <th scope="col" className={`${TH} text-right`}>
        B
      </th>
      <th scope="col" className={`${TH} text-right`}>
        Δ
      </th>
    </>
  );
}
