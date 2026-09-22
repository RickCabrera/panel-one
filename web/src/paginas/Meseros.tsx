import { useState } from 'react';

import { useFiltroAlcance } from '../alertas/consultas';
import type {
  FilaRendimientoMesero,
  MeseroSinVentas,
  RendimientoMeseros,
  SucursalRendimiento,
} from '../api/tipos';
import { useAlcance } from '../filtros/alcance';
import { usePeriodo } from '../filtros/usePeriodo';
import { pesos } from '../dinero/dinero';
import { BotonCsv } from './analisis/Bloques';
import { paginar } from './analisis/reglas';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from './inicio/Tarjeta';
import { useRendimientoMeseros } from './meseros/consultas';
import { meserosACsv, nombreCsvMeseros } from './meseros/csv';
import {
  comparar,
  cuadra,
  estadoCatalogo,
  estadoFila,
  llaveFila,
  nombreFila,
  posicionTexto,
  sucursalDe,
} from './meseros/reglas';
import { fechaHoraEn, fechaParaTabla } from './tickets/formato';
import { Vista } from './Vista';

const ZONA_POR_DEFECTO = 'America/Mexico_City';
const TH = 'px-2 py-1 font-medium';
const TD = 'px-2 py-2';
const NUM = 'px-2 py-2 text-right tabular-nums whitespace-nowrap';
const BOTON =
  'rounded-md border border-linea-fuerte bg-superficie px-3 py-1 text-sm text-tinta-medio hover:bg-realce disabled:opacity-50';

const importe = (v: string | null) => (v === null ? '—' : pesos(v));
const minutos = (v: string | null) => (v === null ? '—' : `${v} min`);

/**
 * Meseros (F2-231): el rendimiento del periodo por mesero, ligado con el catálogo que el agente
 * lee del POS de cada sucursal. Las cifras son las de Análisis; la suma de la venta de todos los
 * meseros es la venta del periodo. Cancelaciones y descuentos van aparte, nunca dentro de la
 * venta.
 */
export function Meseros() {
  const filtro = useFiltroAlcance();
  const { rango } = usePeriodo();
  const { sucursal, sucursales } = useAlcance();
  const consulta = useRendimientoMeseros(filtro, rango);
  const [pagina, setPagina] = useState(1);
  const [elegida, setElegida] = useState<string | null>(null);
  // Otro alcance o periodo: primera página y sin ficha abierta.
  const llave = `${filtro?.empresaId ?? ''}|${filtro?.sucursalId ?? ''}|${rango?.desde ?? ''}|${rango?.hasta ?? ''}`;
  const [llavePrevia, setLlavePrevia] = useState(llave);
  if (llavePrevia !== llave) {
    setLlavePrevia(llave);
    setPagina(1);
    setElegida(null);
  }
  const zonas = new Map((sucursales.data ?? []).map((s) => [s.id, s.zonaHoraria]));
  const zonaDe = (id: string) => zonas.get(id) ?? ZONA_POR_DEFECTO;

  return (
    <Vista titulo="Meseros">
      <p className="mb-4 text-sm text-tinta-tenue">
        Quién atendió en el periodo y cómo le fue, contra el promedio de su sucursal. El ticket del
        POS sólo trae el nombre del mesero: se liga con el catálogo del POS por nombre. Las
        cancelaciones y los descuentos se muestran aparte, nunca dentro de la venta.
      </p>
      {rango === null ? (
        <Tarjeta titulo="Rendimiento">
          <Vacio>Elige un periodo válido para ver el rendimiento de los meseros.</Vacio>
        </Tarjeta>
      ) : (
        <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={6} />}>
          {(r) => {
            const elegidaFila = r.filas.find((f) => llaveFila(f) === elegida) ?? null;
            return (
              <>
                <Avisos r={r} />
                <Tarjeta titulo="Rendimiento del periodo" className="mt-4">
                  {r.filas.length > 0 && (
                    <div className="mb-2 flex justify-end">
                      <BotonCsv
                        nombre={nombreCsvMeseros(rango, sucursal?.nombre)}
                        generar={() => meserosACsv(r)}
                        testId="meseros-csv"
                      />
                    </div>
                  )}
                  {r.filas.length === 0 ? (
                    <Vacio>
                      No hubo cuentas ni cancelaciones en el periodo, así que no hay meseros que
                      comparar. Elige otro periodo o sucursal; si esperabas ventas, revisa que el
                      agente de la sucursal esté conectado.
                    </Vacio>
                  ) : (
                    <Tabla
                      r={r}
                      pagina={pagina}
                      cambiarPagina={setPagina}
                      elegida={elegida}
                      elegir={setElegida}
                    />
                  )}
                </Tarjeta>
                {elegidaFila && (
                  <Ficha
                    key={llaveFila(elegidaFila)}
                    f={elegidaFila}
                    s={sucursalDe(r, elegidaFila.sucursalId)}
                    zona={zonaDe(elegidaFila.sucursalId)}
                    onCerrar={() => setElegida(null)}
                  />
                )}
                <SinVentas filas={r.sinVentas} truncado={r.catalogoTruncado} />
              </>
            );
          }}
        </SegunEstado>
      )}
    </Vista>
  );
}

function Avisos({ r }: { r: RendimientoMeseros }) {
  const sinCatalogo = r.sucursales.filter((s) => !s.catalogoSincronizado);
  const ok = cuadra(r);
  return (
    <Tarjeta titulo="Periodo">
      <dl
        className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr_auto_1fr]"
        data-testid="meseros-totales"
      >
        <dt className="text-tinta-suave">Venta</dt>
        <dd className="tabular-nums">{pesos(r.venta)}</dd>
        <dt className="text-tinta-suave">Cuentas</dt>
        <dd className="tabular-nums">{r.cuentas}</dd>
        <dt className="text-tinta-suave">Descuentos</dt>
        <dd className="tabular-nums" data-testid="meseros-descuentos">
          {pesos(r.descuentos.monto)} en {r.descuentos.cuentas} cuenta
          {r.descuentos.cuentas === 1 ? '' : 's'}
        </dd>
        <dt className="text-tinta-suave">Cancelaciones</dt>
        <dd className="tabular-nums" data-testid="meseros-cancelados">
          {r.cancelados.cuentas} cuenta{r.cancelados.cuentas === 1 ? '' : 's'} por{' '}
          {pesos(r.cancelados.monto)} (no suman a la venta)
        </dd>
      </dl>
      {r.filas.length > 0 && (
        <p className="mt-2 text-xs text-tinta-tenue" data-testid="meseros-cuadre">
          {ok
            ? `La venta de todos los meseros (con “Sin mesero”) suma la venta del periodo: ${pesos(r.venta)}.`
            : `La venta de los meseros no cuadra con la venta del periodo (${pesos(r.venta)}): revisa la ingesta.`}
        </p>
      )}
      {sinCatalogo.length > 0 && (
        <p className="mt-2 text-sm text-aviso" role="status" data-testid="meseros-sin-catalogo">
          {sinCatalogo.map((s) => s.sucursal).join(', ')}{' '}
          {sinCatalogo.length === 1 ? 'no ha enviado' : 'no han enviado'} su catálogo de meseros:
          sus cifras salen de las cuentas, pero no se puede decir la clave ni si el mesero sigue
          activo. Hace falta el agente conectado con la lectura de catálogos del POS.
        </p>
      )}
      {r.catalogoTruncado && (
        <p className="mt-2 text-sm text-aviso" role="status">
          El catálogo de meseros es más grande de lo que se lee de una vez: algunos meseros pueden
          salir como “Catálogo incompleto” y la lista de meseros sin ventas puede faltar.
        </p>
      )}
    </Tarjeta>
  );
}

function Tabla({
  r,
  pagina,
  cambiarPagina,
  elegida,
  elegir,
}: {
  r: RendimientoMeseros;
  pagina: number;
  cambiarPagina: (p: number) => void;
  elegida: string | null;
  elegir: (llave: string) => void;
}) {
  const p = paginar(r.filas, pagina);
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm" data-testid="tabla-meseros">
          <thead className="text-left text-xs text-tinta-suave">
            <tr>
              <th className={TH}>Posición</th>
              <th className={TH}>Clave</th>
              <th className={TH}>Mesero</th>
              <th className={TH}>Sucursal</th>
              <th className={TH}>Estado</th>
              <th className={`${TH} text-right`}>Venta</th>
              <th className={`${TH} text-right`}>Cuentas</th>
              <th className={`${TH} text-right`}>Ticket prom.</th>
              <th className={`${TH} text-right`}>Comensales</th>
              <th className={`${TH} text-right`}>Propina</th>
              <th className={`${TH} text-right`}>Min. de mesa</th>
              <th className={`${TH} text-right`}>Descuentos</th>
              <th className={`${TH} text-right`}>Cancelaciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-linea">
            {p.filas.map((f) => {
              const llave = llaveFila(f);
              const de = sucursalDe(r, f.sucursalId)?.meserosEnRanking ?? 0;
              return (
                <tr
                  key={llave}
                  className={elegida === llave ? 'bg-realce' : undefined}
                  data-testid="fila-mesero"
                >
                  <td className={NUM}>{posicionTexto(f.posicion, de) ?? '—'}</td>
                  <td className={`${TD} text-tinta-medio`}>{f.catalogo?.clave ?? '—'}</td>
                  <td className={TD}>
                    <button
                      type="button"
                      className={`text-left underline-offset-2 hover:underline ${f.mesero === null ? 'italic text-tinta-tenue' : 'text-acento-texto'}`}
                      onClick={() => elegir(llave)}
                    >
                      {nombreFila(f)}
                    </button>
                  </td>
                  <td className={TD}>{f.sucursal}</td>
                  <td className={TD}>{estadoFila(f)}</td>
                  <td className={NUM} data-testid="mesero-venta">
                    {pesos(f.venta)}
                  </td>
                  <td className={NUM}>{f.cuentas}</td>
                  <td className={NUM}>{importe(f.ticketPromedio)}</td>
                  <td className={NUM}>{f.comensales}</td>
                  <td className={NUM}>{pesos(f.propina)}</td>
                  <td className={NUM}>{minutos(f.minutosPromedio)}</td>
                  <td className={NUM} data-testid="mesero-descuentos">
                    {pesos(f.descuentos.monto)} · {f.descuentos.cuentas}
                  </td>
                  <td className={NUM} data-testid="mesero-cancelados">
                    {f.cancelados.cuentas} · {pesos(f.cancelados.monto)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-tinta-tenue">
        Posición: por venta, dentro de su sucursal. Descuentos: importe · cuentas con descuento.
        Cancelaciones: cuentas · importe; ninguna de las dos se suma a la venta.
      </p>
      {p.paginas > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            className={BOTON}
            disabled={p.pagina <= 1}
            onClick={() => cambiarPagina(p.pagina - 1)}
          >
            Anterior
          </button>
          <span>
            Página {p.pagina} de {p.paginas} · {p.total} filas
          </span>
          <button
            type="button"
            className={BOTON}
            disabled={p.pagina >= p.paginas}
            onClick={() => cambiarPagina(p.pagina + 1)}
          >
            Siguiente
          </button>
        </div>
      )}
    </>
  );
}

function Renglon({
  etiqueta,
  valor,
  promedio,
  crudoValor,
  crudoPromedio,
}: {
  etiqueta: string;
  valor: string;
  promedio: string;
  crudoValor: string | null;
  crudoPromedio: string | null;
}) {
  const c = comparar(crudoValor, crudoPromedio);
  const leyenda =
    c.sentido === 'arriba'
      ? 'arriba del promedio'
      : c.sentido === 'abajo'
        ? 'abajo del promedio'
        : c.sentido === 'igual'
          ? 'igual al promedio'
          : 'sin promedio para comparar';
  return (
    <tr>
      <th scope="row" className="py-1 pr-3 text-left font-normal text-tinta-suave">
        {etiqueta}
      </th>
      <td className="py-1 pr-3 text-right tabular-nums">{valor}</td>
      <td className="py-1 pr-3 text-right tabular-nums text-tinta-medio">{promedio}</td>
      <td className="py-1 text-tinta-medio">
        {c.texto && <span className="tabular-nums">{c.texto} </span>}
        {leyenda}
      </td>
    </tr>
  );
}

function Ficha({
  f,
  s,
  zona,
  onCerrar,
}: {
  f: FilaRendimientoMesero;
  s: SucursalRendimiento | undefined;
  zona: string;
  onCerrar: () => void;
}) {
  const p = s?.promedio;
  const vistoAt = f.catalogo ? fechaHoraEn(zona, f.catalogo.vistoAt) : null;
  return (
    <Tarjeta titulo="Ficha del mesero" className="mt-4">
      <div className="text-sm" data-testid="ficha-mesero">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h3 className="text-base font-semibold">{nombreFila(f)}</h3>
          <span className="text-tinta-medio">
            {f.catalogo?.clave ?? 'Sin clave'} · {f.sucursal} · {estadoFila(f)}
          </span>
          <button type="button" className={`${BOTON} ml-auto`} onClick={onCerrar}>
            Cerrar
          </button>
        </div>
        <p className="mt-1 text-tinta-medio" data-testid="ficha-posicion">
          {f.posicion === null
            ? f.mesero === null
              ? 'Las cuentas sin mesero no entran al ranking.'
              : 'Sin cuentas cobradas en el periodo: no entra al ranking.'
            : `Lugar ${posicionTexto(f.posicion, s?.meserosEnRanking ?? 0)} por venta en ${f.sucursal}.`}
        </p>
        {f.textosPos.length > 1 && (
          <p className="mt-1 text-xs text-tinta-tenue">
            En el POS aparece escrito de {f.textosPos.length} formas ({f.textosPos.join(' · ')});
            aquí se suman.
          </p>
        )}
        {vistoAt && (
          <p className="mt-1 text-xs text-tinta-tenue">
            Visto en el catálogo del POS por última vez: {fechaParaTabla(vistoAt.fecha)}{' '}
            {vistoAt.hora}.
          </p>
        )}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-max text-sm" data-testid="ficha-comparacion">
            <thead className="text-xs text-tinta-suave">
              <tr>
                <th className="py-1 pr-3 text-left font-medium">Cifra</th>
                <th className="py-1 pr-3 text-right font-medium">Este mesero</th>
                <th className="py-1 pr-3 text-right font-medium">Promedio de la sucursal</th>
                <th className="py-1 text-left font-medium">Comparación</th>
              </tr>
            </thead>
            <tbody>
              <Renglon
                etiqueta="Venta"
                valor={pesos(f.venta)}
                promedio={importe(p?.ventaPorMesero ?? null)}
                crudoValor={f.venta}
                crudoPromedio={p?.ventaPorMesero ?? null}
              />
              <Renglon
                etiqueta="Cuentas"
                valor={String(f.cuentas)}
                promedio={p?.cuentasPorMesero ?? '—'}
                crudoValor={String(f.cuentas)}
                crudoPromedio={p?.cuentasPorMesero ?? null}
              />
              <Renglon
                etiqueta="Ticket promedio"
                valor={importe(f.ticketPromedio)}
                promedio={importe(p?.ticketPromedio ?? null)}
                crudoValor={f.ticketPromedio}
                crudoPromedio={p?.ticketPromedio ?? null}
              />
              <Renglon
                etiqueta="Comensales"
                valor={String(f.comensales)}
                promedio={p?.comensalesPorMesero ?? '—'}
                crudoValor={String(f.comensales)}
                crudoPromedio={p?.comensalesPorMesero ?? null}
              />
              <Renglon
                etiqueta="Propina"
                valor={pesos(f.propina)}
                promedio={importe(p?.propinaPorMesero ?? null)}
                crudoValor={f.propina}
                crudoPromedio={p?.propinaPorMesero ?? null}
              />
              <Renglon
                etiqueta="Tiempo promedio de mesa"
                valor={minutos(f.minutosPromedio)}
                promedio={minutos(p?.minutosPromedio ?? null)}
                crudoValor={f.minutosPromedio}
                crudoPromedio={p?.minutosPromedio ?? null}
              />
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-tinta-tenue">
          Venta, cuentas, comensales y propina se comparan contra el promedio por mesero de la
          sucursal ({s?.meserosEnRanking ?? 0} con cuentas en el periodo). Ticket y tiempo de mesa,
          contra los de toda la sucursal, incluidas las cuentas sin mesero.
        </p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-tinta-suave">Descuentos aplicados</dt>
          <dd className="tabular-nums" data-testid="ficha-descuentos">
            {pesos(f.descuentos.monto)} en {f.descuentos.cuentas} cuenta
            {f.descuentos.cuentas === 1 ? '' : 's'}
          </dd>
          <dt className="text-tinta-suave">Cancelaciones</dt>
          <dd className="tabular-nums" data-testid="ficha-cancelados">
            {f.cancelados.cuentas} cuenta{f.cancelados.cuentas === 1 ? '' : 's'} por{' '}
            {pesos(f.cancelados.monto)} (no suman a su venta)
          </dd>
        </dl>
      </div>
    </Tarjeta>
  );
}

function SinVentas({ filas, truncado }: { filas: MeseroSinVentas[]; truncado: boolean }) {
  if (filas.length === 0 && !truncado) return null;
  return (
    <Tarjeta titulo="En el catálogo, sin ventas en el periodo" className="mt-4">
      {filas.length === 0 ? (
        <Vacio>No se pudo revisar el catálogo completo.</Vacio>
      ) : (
        <ul className="divide-y divide-linea text-sm" data-testid="meseros-sin-ventas">
          {filas.map((m) => (
            <li key={m.id} className="flex flex-wrap gap-x-3 py-2">
              <span className="text-tinta-medio">{m.clave ?? 'Sin clave'}</span>
              <span className="font-medium">{m.nombre}</span>
              <span>{m.sucursal}</span>
              <span className="text-tinta-medio">{estadoCatalogo(m)}</span>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}
