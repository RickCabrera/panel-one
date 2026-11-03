import { useSearchParams } from 'react-router';

import { useFiltroAlcance } from '../alertas/consultas';
import type { DetalleCorte, ResumenCorte } from '../api/tipos';
import { pesos } from '../dinero/dinero';
import { usePeriodo } from '../filtros/usePeriodo';
import { useCortes, useDetalleCorte, useTiempoRealCortes } from './cortes/consultas';
import {
  duracionTurno,
  momento,
  nombreCorte,
  PARAM_CORTE,
  TEXTO_INCOMPLETO,
  sentidoDiferencia,
  TEXTO_CONCEPTO,
} from './cortes/reglas';
import { useAhora } from './mesas/consultas';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from './inicio/Tarjeta';
import { Vista } from './Vista';

const TH = 'px-2 py-1 font-medium';
const TD = 'px-2 py-2';
const NUM = 'px-2 py-2 text-right tabular-nums whitespace-nowrap';
const BOTON =
  'rounded-md border border-linea-fuerte bg-superficie px-3 py-1 text-sm text-tinta-medio hover:bg-realce disabled:opacity-50';

const importe = (v: string | null) => (v === null ? '—' : pesos(v));

const TEXTO_FORMA: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  otro: 'Otro',
};

/**
 * Cortes (MVP): los turnos de SoftRestaurant del periodo, con lo cobrado en cada uno, y el
 * detalle de un corte (`?corte=<id>`): venta, cuentas, formas de pago y lo que el cajero declaró
 * contra lo cobrado. Un turno abierto es el acumulado en curso y se refresca solo.
 */
export function Cortes() {
  const filtro = useFiltroAlcance();
  const { rango } = usePeriodo();
  const [parametros, setParametros] = useSearchParams();
  const elegido = parametros.get(PARAM_CORTE);
  useTiempoRealCortes(filtro);
  const lista = useCortes(filtro, rango);

  const elegir = (id: string | null) =>
    setParametros((previos) => {
      const nuevos = new URLSearchParams(previos);
      if (id === null) nuevos.delete(PARAM_CORTE);
      else nuevos.set(PARAM_CORTE, id);
      return nuevos;
    });

  return (
    <Vista titulo="Cortes">
      <p className="mb-4 text-sm text-tinta-tenue">
        Los turnos (cortes de caja) de SoftRestaurant. La venta de cada turno es lo COBRADO en él:
        la cuenta se cuenta en el turno donde se pagó, como en el Corte X del POS. Un turno abierto
        es el acumulado en curso.
      </p>
      {rango === null ? (
        <Tarjeta titulo="Cortes del periodo">
          <Vacio>Elige un periodo válido para ver los cortes.</Vacio>
        </Tarjeta>
      ) : (
        <Tarjeta titulo="Cortes del periodo">
          <SegunEstado consulta={lista} esqueleto={<Esqueleto lineas={5} />}>
            {(r) =>
              r.cortes.length === 0 ? (
                <Vacio>
                  No hubo turnos abiertos en el periodo. Si esperabas cortes, revisa que el agente
                  de la sucursal esté conectado y actualizado.
                </Vacio>
              ) : (
                <ListaDeCortes
                  cortes={r.cortes}
                  truncado={r.truncado}
                  elegido={elegido}
                  elegir={elegir}
                />
              )
            }
          </SegunEstado>
        </Tarjeta>
      )}
      {elegido !== null && <Detalle id={elegido} onCerrar={() => elegir(null)} />}
    </Vista>
  );
}

function ListaDeCortes({
  cortes,
  truncado,
  elegido,
  elegir,
}: {
  cortes: ResumenCorte[];
  truncado: boolean;
  elegido: string | null;
  elegir: (id: string) => void;
}) {
  const ahora = useAhora();
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm" data-testid="tabla-cortes">
          <thead className="text-left text-xs text-tinta-suave">
            <tr>
              <th className={TH}>Turno</th>
              <th className={TH}>Sucursal</th>
              <th className={TH}>Apertura</th>
              <th className={TH}>Cierre</th>
              <th className={TH}>Duración</th>
              <th className={`${TH} text-right`}>Fondo</th>
              <th className={`${TH} text-right`}>Venta</th>
              <th className={`${TH} text-right`}>Cuentas</th>
              <th className={`${TH} text-right`}>Ticket prom.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-linea">
            {cortes.map((c) => (
              <tr
                key={c.id}
                className={elegido === c.id ? 'bg-realce' : undefined}
                data-testid="fila-corte"
              >
                <td className={TD}>
                  <button
                    type="button"
                    className="text-left text-acento-texto underline-offset-2 hover:underline"
                    onClick={() => elegir(c.id)}
                  >
                    {nombreCorte(c)}
                  </button>
                </td>
                <td className={TD}>{c.sucursal}</td>
                <td className={`${TD} whitespace-nowrap`}>
                  {momento(c.zonaHoraria, c.aperturaAt)}
                </td>
                <td className={`${TD} whitespace-nowrap`}>
                  {c.cierreAt === null ? (
                    <span className="font-medium text-exito" data-testid="corte-abierto">
                      Abierto
                    </span>
                  ) : (
                    momento(c.zonaHoraria, c.cierreAt)
                  )}
                </td>
                <td className={TD}>{duracionTurno(c.aperturaAt, c.cierreAt, ahora)}</td>
                <td className={NUM}>{pesos(c.fondo)}</td>
                <td className={NUM} data-testid="corte-venta">
                  {pesos(c.venta)}
                  {c.posiblementeIncompleto && (
                    <span
                      className="ml-1 text-aviso"
                      title={TEXTO_INCOMPLETO}
                      data-testid="corte-incompleto"
                    >
                      *
                    </span>
                  )}
                </td>
                <td className={NUM}>{c.cuentas}</td>
                <td className={NUM}>{importe(c.ticketPromedio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cortes.some((c) => c.posiblementeIncompleto) && (
        <p className="mt-2 text-xs text-aviso" data-testid="cortes-incompletos">
          * {TEXTO_INCOMPLETO} Se cerró antes de que el agente empezara a mandar los turnos.
        </p>
      )}
      {truncado && (
        <p className="mt-2 text-sm text-aviso" role="status">
          Hay más turnos en el periodo de los que se muestran: acorta el rango para verlos todos.
        </p>
      )}
    </>
  );
}

function Detalle({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const consulta = useDetalleCorte(id);
  return (
    <Tarjeta titulo="Detalle del corte" className="mt-4">
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={6} />}>
        {(d) => <ContenidoDetalle d={d} onCerrar={onCerrar} />}
      </SegunEstado>
    </Tarjeta>
  );
}

function Cifra({ etiqueta, valor, testId }: { etiqueta: string; valor: string; testId?: string }) {
  return (
    <div>
      <dt className="text-xs text-tinta-suave">{etiqueta}</dt>
      <dd className="text-lg font-semibold tabular-nums" data-testid={testId}>
        {valor}
      </dd>
    </div>
  );
}

function ContenidoDetalle({ d, onCerrar }: { d: DetalleCorte; onCerrar: () => void }) {
  const ahora = useAhora();
  return (
    <div className="text-sm" data-testid="detalle-corte">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="text-base font-semibold">{nombreCorte(d)}</h3>
        <span className="text-tinta-medio">
          {d.sucursal} · abrió {momento(d.zonaHoraria, d.aperturaAt)} ·{' '}
          {d.cierreAt === null
            ? `abierto hace ${duracionTurno(d.aperturaAt, null, ahora)}`
            : `cerró ${momento(d.zonaHoraria, d.cierreAt)}`}
        </span>
        <button type="button" className={`${BOTON} ml-auto`} onClick={onCerrar}>
          Cerrar
        </button>
      </div>
      {d.posiblementeIncompleto && (
        <p className="mt-2 text-sm text-aviso" role="status" data-testid="detalle-incompleto">
          {TEXTO_INCOMPLETO} El turno se cerró antes de que el agente empezara a mandar los turnos,
          así que algunas de sus cuentas pueden no estar ligadas a él.
        </p>
      )}
      {d.abierto && (
        <p className="mt-2 text-sm text-info" role="status" data-testid="corte-en-curso">
          Turno abierto: las cifras son el acumulado en curso (lo cobrado hasta ahora) y se
          actualizan solas.
        </p>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cifra etiqueta="Venta cobrada" valor={pesos(d.venta)} testId="detalle-venta" />
        <Cifra etiqueta="Cuentas" valor={String(d.cuentas)} testId="detalle-cuentas" />
        <Cifra etiqueta="Ticket promedio" valor={importe(d.ticketPromedio)} />
        <Cifra
          etiqueta="Comensales"
          valor={
            d.comensales.cuentasConDato === 0 && d.cuentas > 0
              ? 'Sin dato'
              : String(d.comensales.total)
          }
        />
        <Cifra etiqueta="Fondo inicial" valor={pesos(d.fondo)} />
        <Cifra etiqueta="Propinas" valor={pesos(d.propina)} />
        <Cifra
          etiqueta={`Descuentos (${d.descuentos.cuentas} cuenta${d.descuentos.cuentas === 1 ? '' : 's'})`}
          valor={pesos(d.descuentos.monto)}
        />
        <Cifra
          etiqueta={`Canceladas (${d.cancelados.cuentas}, no suman)`}
          valor={pesos(d.cancelados.monto)}
          testId="detalle-canceladas"
        />
      </dl>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="text-xs font-medium text-tinta-suave">Cobrado por forma de pago</h4>
          <table className="mt-1 w-full text-sm" data-testid="detalle-formas">
            <tbody className="divide-y divide-linea">
              {d.formasPago.formas.map((f) => (
                <tr key={f.forma}>
                  <th scope="row" className="py-1 text-left font-normal">
                    {TEXTO_FORMA[f.forma] ?? f.forma}
                  </th>
                  <td className="py-1 text-right tabular-nums">{pesos(f.monto)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row" className="py-1 text-left font-medium">
                  Total cobrado
                </th>
                <td className="py-1 text-right font-medium tabular-nums">{pesos(d.cobrado)}</td>
              </tr>
            </tbody>
          </table>
          {d.formasPago.sinCatalogo.length > 0 && (
            <p className="mt-1 text-xs text-tinta-tenue">
              En “Otro” van formas del POS sin catálogo:{' '}
              {d.formasPago.sinCatalogo.map((s) => `${s.formaRaw} ${pesos(s.monto)}`).join(' · ')}.
            </p>
          )}
        </div>

        <div>
          <h4 className="text-xs font-medium text-tinta-suave">
            Declarado por el cajero vs. cobrado
          </h4>
          <table className="mt-1 w-full text-sm" data-testid="detalle-cuadre">
            <thead className="text-xs text-tinta-suave">
              <tr>
                <th className="py-1 text-left font-medium">Concepto</th>
                <th className="py-1 text-right font-medium">Declarado</th>
                <th className="py-1 text-right font-medium">Cobrado</th>
                <th className="py-1 text-right font-medium">Diferencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linea">
              {d.cuadre.map((r) => {
                const sentido = sentidoDiferencia(r.diferencia);
                return (
                  <tr key={r.concepto} data-testid={`cuadre-${r.concepto}`}>
                    <th scope="row" className="py-1 text-left font-normal">
                      {TEXTO_CONCEPTO[r.concepto]}
                    </th>
                    <td className="py-1 text-right tabular-nums">{pesos(r.declarado)}</td>
                    <td className="py-1 text-right tabular-nums">{importe(r.cobrado)}</td>
                    <td
                      className={`py-1 text-right tabular-nums ${
                        sentido === 'faltante'
                          ? 'text-peligro'
                          : sentido === 'sobrante'
                            ? 'text-aviso'
                            : ''
                      }`}
                    >
                      {r.diferencia === null
                        ? '—'
                        : `${pesos(r.diferencia)}${sentido === 'faltante' ? ' (faltante)' : sentido === 'sobrante' ? ' (sobrante)' : ''}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-tinta-tenue">
            {d.abierto
              ? 'Con el turno abierto no hay diferencias: el cajero declara al cerrar.'
              : 'Diferencia = declarado − cobrado (pagos sin propina ni fondo). Vales y crédito no tienen forma equivalente en el panel. Pendiente de validar contra un corte real de SR.'}
          </p>
        </div>
      </div>

      {d.topProductos.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-medium text-tinta-suave">Lo más vendido en el turno</h4>
          <ol className="mt-1 divide-y divide-linea" data-testid="detalle-top">
            {d.topProductos.map((p) => (
              <li key={p.producto} className="flex justify-between gap-3 py-1">
                <span>{p.producto}</span>
                <span className="tabular-nums text-tinta-medio">
                  {Number(p.cantidad).toLocaleString('es-MX')} · {pesos(p.importe)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
