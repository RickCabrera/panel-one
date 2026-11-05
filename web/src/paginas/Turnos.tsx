import { Calculator, Clock3, FileText } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';

import { useFiltroAlcance } from '../alertas/consultas';
import type { DetalleCorte, ResumenCorte } from '../api/tipos';
import { pesos } from '../dinero/dinero';
import { usePeriodo } from '../filtros/usePeriodo';
import { MEDIA_HASTA_LG, useEsMovil, useMedia } from '../layout/useEsMovil';
import {
  useCortes,
  useCortesEnCurso,
  useDetalleCorte,
  useTiempoRealCortes,
} from './cortes/consultas';
import {
  duracionTurno,
  elegirTurno,
  leerTurno,
  leerVista,
  momento,
  nombreCorte,
  PARAM_VISTA,
  TEXTO_INCOMPLETO,
  sentidoDiferencia,
  TEXTO_CONCEPTO,
  VISTA_ABIERTOS,
  type VistaTurnos,
} from './cortes/reglas';
import { useAhora } from './mesas/consultas';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from './inicio/Tarjeta';
import { BOTON_SECUNDARIO, CARRIL_SEGMENTOS, OPCION_CARRIL } from './botones';
import { Latido } from './inicio/Sparkline';
import { Vista } from './Vista';

const TH = 'px-3 py-2 font-medium';
const TD = 'px-3 py-2.5';
const NUM = 'px-3 py-2.5 text-right tabular-nums whitespace-nowrap';
const BOTON = BOTON_SECUNDARIO;

const importe = (v: string | null) => (v === null ? '—' : pesos(v));

const TEXTO_FORMA: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  otro: 'Otro',
};

/**
 * Turnos (UI-01; antes "Cortes", el MVP): los turnos de SoftRestaurant (cortes de caja) con lo
 * cobrado en cada uno, y el detalle de uno (`?turno=<id>`; el viejo `?corte=` también abre):
 * venta, cuentas, formas de pago y lo que el cajero declaró contra lo cobrado. Un turno abierto
 * es el acumulado en curso y se refresca solo.
 *
 * Dos vistas (`?ver=`): "Del periodo" (los que caen en el periodo de la cabecera, el default) y
 * "Abiertos ahora" (`?ver=abiertos`): los turnos SIN cierre de todas las sucursales del alcance,
 * sin importar el periodo (`GET /cortes/en-curso`, el mismo dato que "Turno en curso" del Panel).
 *
 * Sólo cambia la INTERFAZ: la API y el modelo siguen llamándose `cortes`.
 */
export function Turnos() {
  const filtro = useFiltroAlcance();
  const { rango } = usePeriodo();
  const [parametros, setParametros] = useSearchParams();
  const elegido = leerTurno(parametros);
  const vista = leerVista(parametros);
  useTiempoRealCortes(filtro);

  const elegir = (id: string | null) => setParametros((previos) => elegirTurno(previos, id));
  const cambiarVista = (nueva: VistaTurnos) =>
    setParametros((previos) => {
      const nuevos = new URLSearchParams(previos);
      if (nueva === VISTA_ABIERTOS) nuevos.set(PARAM_VISTA, VISTA_ABIERTOS);
      else nuevos.delete(PARAM_VISTA);
      return nuevos;
    });

  return (
    <Vista titulo="Turnos">
      <p className="mb-4 text-sm text-tinta-tenue">
        Los turnos (cortes de caja) de SoftRestaurant. La venta de cada turno es lo COBRADO en él:
        la cuenta se cuenta en el turno donde se pagó, como en el Corte X del POS. Un turno abierto
        es el acumulado en curso.
      </p>
      <div role="group" aria-label="Qué turnos ver" className={`mb-4 ${CARRIL_SEGMENTOS}`}>
        {(
          [
            ['periodo', 'Del periodo'],
            [VISTA_ABIERTOS, 'Abiertos ahora'],
          ] as const
        ).map(([valor, texto]) => (
          <button
            key={valor}
            type="button"
            aria-pressed={vista === valor}
            onClick={() => cambiarVista(valor)}
            className={OPCION_CARRIL}
          >
            {texto}
          </button>
        ))}
      </div>
      {vista === VISTA_ABIERTOS ? (
        <TurnosAbiertos filtro={filtro} elegido={elegido} elegir={elegir} />
      ) : (
        <TurnosDelPeriodo filtro={filtro} rango={rango} elegido={elegido} elegir={elegir} />
      )}
      {elegido !== null && <Detalle id={elegido} onCerrar={() => elegir(null)} />}
    </Vista>
  );
}

type Alcance = ReturnType<typeof useFiltroAlcance>;

function TurnosDelPeriodo({
  filtro,
  rango,
  elegido,
  elegir,
}: {
  filtro: Alcance;
  rango: ReturnType<typeof usePeriodo>['rango'];
  elegido: string | null;
  elegir: (id: string) => void;
}) {
  const lista = useCortes(filtro, rango);
  if (rango === null) {
    return (
      <Tarjeta titulo="Turnos del periodo" icono={Calculator}>
        <Vacio>Elige un periodo válido para ver los turnos.</Vacio>
      </Tarjeta>
    );
  }
  return (
    <Tarjeta titulo="Turnos del periodo" icono={Calculator}>
      <SegunEstado consulta={lista} esqueleto={<Esqueleto lineas={5} />}>
        {(r) =>
          r.cortes.length === 0 ? (
            <Vacio>
              No hubo turnos abiertos en el periodo. Si esperabas turnos, revisa que el agente de la
              sucursal esté conectado y actualizado.
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
  );
}

/**
 * "Abiertos ahora": los turnos sin cierre de todas las sucursales del alcance, con su acumulado
 * en curso. No depende del periodo (un turno abierto desde ayer también sale). Se refresca solo
 * (60 s y con cada aviso de ingesta), como la tarjeta del Panel.
 */
function TurnosAbiertos({
  filtro,
  elegido,
  elegir,
}: {
  filtro: Alcance;
  elegido: string | null;
  elegir: (id: string) => void;
}) {
  const consulta = useCortesEnCurso(filtro);
  return (
    <Tarjeta titulo="Turnos abiertos ahora" icono={Clock3}>
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={3} />}>
        {(turnos) =>
          turnos.length === 0 ? (
            <Vacio>
              No hay turnos abiertos en SoftRestaurant (o el agente de la sucursal no los ha
              reportado).
            </Vacio>
          ) : (
            <>
              <p className="mb-2 text-xs text-tinta-tenue">
                Acumulado en curso: lo cobrado hasta ahora en cada turno, sin importar el periodo
                elegido. Se actualiza solo.
              </p>
              <ListaDeCortes cortes={turnos} truncado={false} elegido={elegido} elegir={elegir} />
            </>
          )
        }
      </SegunEstado>
    </Tarjeta>
  );
}

function ListaDeCortes({
  cortes,
  truncado,
  elegido,
  elegir,
}: {
  cortes: readonly ResumenCorte[];
  truncado: boolean;
  elegido: string | null;
  elegir: (id: string) => void;
}) {
  const ahora = useAhora();
  // UI-04: tarjetas hasta lg (en tableta, de dos en dos); la tabla, desde lg.
  const conTarjetas = useMedia(MEDIA_HASTA_LG);
  return (
    <>
      {conTarjetas ? (
        // UI-04: en el celular, una tarjeta por turno con la venta a la vista (en la tabla
        // quedaba fuera de la pantalla, a la derecha).
        <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2" data-testid="tabla-cortes">
          {cortes.map((c) => (
            <TarjetaCorte
              key={c.id}
              corte={c}
              elegido={elegido === c.id}
              ahora={ahora}
              onElegir={() => elegir(c.id)}
            />
          ))}
        </ul>
      ) : (
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
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full bg-exito-fondo px-2 py-0.5 text-xs font-semibold text-exito"
                        data-testid="corte-abierto"
                      >
                        <Latido />
                        Abierto
                      </span>
                    ) : (
                      momento(c.zonaHoraria, c.cierreAt)
                    )}
                  </td>
                  <td className={TD}>{duracionTurno(c.aperturaAt, c.cierreAt, ahora)}</td>
                  <td className={NUM}>{pesos(c.fondo)}</td>
                  <td className={`${NUM} font-semibold`} data-testid="corte-venta">
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
      )}
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

/**
 * UI-04: un turno como tarjeta (celular y tableta). El nombre del botón es el del turno
 * (`aria-labelledby`) y todo lo demás (venta, estado, horas, cuentas) se lee como su
 * descripción (`aria-describedby`): ningún `aria-label` tapa el contenido.
 */
function TarjetaCorte({
  corte: c,
  elegido,
  ahora,
  onElegir,
}: {
  corte: ResumenCorte;
  elegido: boolean;
  ahora: number;
  onElegir: () => void;
}) {
  const idNombre = `corte-${c.id}-nombre`;
  const idDatos = `corte-${c.id}-datos`;
  return (
    <li data-testid="fila-corte">
      <button
        type="button"
        onClick={onElegir}
        aria-pressed={elegido}
        aria-labelledby={idNombre}
        aria-describedby={idDatos}
        className={`block w-full min-w-0 rounded-xl border px-3.5 py-3 text-left shadow-tarjeta transition-[background-color,box-shadow] duration-150 ${
          elegido
            ? 'border-acento-borde bg-realce'
            : 'border-linea-suave bg-superficie vidrio-falso hover:shadow-tarjeta-alta'
        }`}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span id={idNombre} className="min-w-0 flex-1 truncate font-semibold text-acento-texto">
            {nombreCorte(c)}
          </span>
          {c.cierreAt === null && (
            <span
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-exito-fondo px-2 py-0.5 text-xs font-semibold text-exito"
              data-testid="corte-abierto"
            >
              <Latido />
              Abierto
            </span>
          )}
        </span>
        <span id={idDatos} className="block">
          <span className="mt-0.5 flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-tinta-suave">{c.sucursal}</span>
            <span
              className="shrink-0 text-xl font-semibold tracking-tight tabular-nums"
              data-testid="corte-venta"
            >
              <span className="sr-only">Venta </span>
              {pesos(c.venta)}
              {c.posiblementeIncompleto && (
                <span className="ml-0.5 text-aviso" data-testid="corte-incompleto">
                  <span aria-hidden="true">*</span>
                  <span className="sr-only"> ({TEXTO_INCOMPLETO})</span>
                </span>
              )}
            </span>
          </span>
          <span className="mt-0.5 block text-xs text-tinta-suave">
            Abrió {momento(c.zonaHoraria, c.aperturaAt)}
            {c.cierreAt === null ? (
              <> · acumulado en curso</>
            ) : (
              <>
                {' '}
                · cerró {momento(c.zonaHoraria, c.cierreAt)} (
                {duracionTurno(c.aperturaAt, c.cierreAt, ahora)})
              </>
            )}
          </span>
          <span className="mt-2.5 grid grid-cols-3 gap-2 border-t border-linea-suave pt-2 text-xs">
            <span>
              <span className="block text-tinta-tenue">Cuentas</span>
              <span className="tabular-nums">{c.cuentas}</span>
            </span>
            <span>
              <span className="block text-tinta-tenue">Ticket prom.</span>
              <span className="tabular-nums">{importe(c.ticketPromedio)}</span>
            </span>
            <span>
              <span className="block text-tinta-tenue">Fondo</span>
              <span className="tabular-nums">{pesos(c.fondo)}</span>
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

function Detalle({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const consulta = useDetalleCorte(id);
  const esMovil = useEsMovil();
  const caja = useRef<HTMLDivElement>(null);
  // UI-04: en el celular el detalle queda bajo la lista, fuera de la pantalla: al elegir un
  // turno se lleva a la vista (con `scroll-mt` para no quedar bajo la cabecera fija).
  useEffect(() => {
    if (esMovil) caja.current?.scrollIntoView?.({ block: 'start' });
  }, [id, esMovil]);
  return (
    <div ref={caja} className="scroll-mt-20">
      <Tarjeta titulo="Detalle del turno" icono={FileText} className="mt-4">
        <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={6} />}>
          {(d) => <ContenidoDetalle d={d} onCerrar={onCerrar} />}
        </SegunEstado>
      </Tarjeta>
    </div>
  );
}

function Cifra({ etiqueta, valor, testId }: { etiqueta: string; valor: string; testId?: string }) {
  return (
    <div>
      <dt className="text-xs text-tinta-suave">{etiqueta}</dt>
      <dd className="text-xl font-semibold tracking-tight tabular-nums" data-testid={testId}>
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
