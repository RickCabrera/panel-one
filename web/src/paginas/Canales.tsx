import { Link, useSearchParams } from 'react-router';

import { useFiltroAlcance } from '../alertas/consultas';
import type { VentaPorArea } from '../api/tipos';
import { useMinuto } from '../consultas/useMinuto';
import { pesos } from '../dinero/dinero';
import { useAlcance } from '../filtros/alcance';
import { errorDeRango, incluyeHoy, TIPOS_PERIODO, type Rango } from '../filtros/periodo';
import { usePeriodo } from '../filtros/usePeriodo';
import { queryVista } from '../filtros/vista';
import { BotonCsv, Cuadre } from './analisis/Bloques';
import { useAnalisis } from './analisis/consultas';
import { motivoVacio, SIN_CANAL, sinCatalogo, sumaCanales } from './areas/reglas';
import { canalesACsv, nombreCsvCanales } from './canales/csv';
import {
  decimasParaBarra,
  deltaTotal,
  filasMezcla,
  ladoTotal,
  type DeltaPp,
  type LadoCanal,
} from './canales/reglas';
import { escribirB, leerB, resolverB, type SeleccionB } from './comparativos/periodoB';
import { SelectorB } from './comparativos/SelectorB';
import { ErrorTarjeta, Esqueleto, Tarjeta } from './inicio/Tarjeta';
import { diferenciaEnPesos, type Delta } from './resumen/delta';
import { Vista } from './Vista';

const TH = 'px-2 py-1 font-medium';
const TD = 'px-2 py-1';
const NUM = 'px-2 py-1 text-right tabular-nums whitespace-nowrap';

const textoRango = (r: Rango) => (r.desde === r.hasta ? r.desde : `${r.desde} a ${r.hasta}`);

/**
 * Ventas por canal (F2-144): la mezcla de la venta por canal de negocio (comedor, mostrador,
 * domicilio, plataformas) del periodo A (el de la cabecera) contra un periodo B (el mismo
 * selector de Comparativos), con Δ de venta y Δ de mezcla en puntos porcentuales.
 *
 * No calcula ninguna cifra de venta: las dos columnas son `GET /ventas/por-area` (F2-233, misma
 * llave que Áreas y canales y Análisis), cuya Σ es la venta del periodo, y la vista lo afirma con
 * el cuadre. "Área sin canal asignado" y "sin clasificar" son renglones propios, nunca
 * repartidos. El canal de cada área se decide en `/areas`: esta vista es sólo lectura.
 *
 * DECISION PROVISIONAL (nocturno): los canales son el enum fijo de F2-233 y el mapeo es por área
 * de CADA sucursal. Las dos siguen abiertas para Ricardo (`docs/delivery.md` §5, esquema-sr §8);
 * la vista no depende de cómo se decidan.
 */
export function Canales() {
  const filtro = useFiltroAlcance();
  const { sucursal } = useAlcance();
  const { periodo, rango, hoy } = usePeriodo();
  const [parametros, setParametros] = useSearchParams();
  const ahora = useMinuto();

  const seleccionB = leerB(parametros);
  const b = rango === null ? null : resolverB(seleccionB, periodo.tipo, rango, hoy, ahora);
  const comparable = b?.ok ? b.comparable : null;
  const rangoB = comparable?.rango ?? null;
  const errorB =
    seleccionB.modo === 'rango'
      ? errorDeRango(seleccionB.desde ?? '', seleccionB.hasta ?? '')
      : null;

  const autoA = rango !== null && incluyeHoy(rango, hoy);
  const autoB = rangoB !== null && incluyeHoy(rangoB, hoy);
  const ventaA = useAnalisis('por-area', filtro, rango, autoA);
  const ventaB = useAnalisis('por-area', filtro, rangoB, autoB, comparable?.alturaAl);

  const cambiarB = (nueva: SeleccionB) => setParametros((previos) => escribirB(previos, nueva));
  const nombrePeriodo = TIPOS_PERIODO.find((t) => t.tipo === periodo.tipo)?.nombre ?? '';
  // A va hasta hoy y B no se corta a la misma altura: el Δ compara un periodo a medias.
  const aMedias = autoA && comparable !== null && comparable.alturaAl === undefined;
  const fallida = [ventaA, ventaB].find((c) => c.isError);
  const datosB = errorB ? null : (ventaB.data ?? null);
  const listas = ventaA.data !== undefined && (errorB !== null || ventaB.data !== undefined);

  return (
    <Vista titulo="Ventas por canal">
      <p className="mb-4 text-sm text-tinta-tenue">
        Cómo se reparte la venta entre comedor, mostrador, domicilio y plataformas. El canal de cada
        área del POS se decide en{' '}
        <Link
          to={{ pathname: '/areas', search: queryVista(parametros) }}
          className="text-acento underline"
        >
          Áreas y canales
        </Link>
        ; lo que no se puede clasificar se muestra aparte, nunca repartido a ojo.
      </p>
      {rango === null ? (
        <p className="text-sm text-tinta-tenue">
          Corrige el rango de fechas de la cabecera para ver la venta por canal.
        </p>
      ) : (
        <Tarjeta titulo="Mezcla por canal: periodo A contra periodo B">
          <div className="flex min-w-0 flex-col gap-2 text-sm">
            <p data-testid="canales-periodos">
              <span className="font-medium">A:</span> {nombrePeriodo} ({textoRango(rango)})
              {comparable && rangoB && (
                <>
                  {' · '}
                  <span className="font-medium">B:</span> {comparable.etiqueta} (
                  {textoRango(rangoB)})
                </>
              )}
            </p>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <SelectorB
                seleccion={seleccionB}
                rangoA={rango}
                rangoB={rangoB}
                onCambiar={cambiarB}
              />
              {listas && ventaA.data && ventaA.data.cuentas + (datosB?.cuentas ?? 0) > 0 && (
                <BotonCsv
                  nombre={nombreCsvCanales(rango, datosB ? rangoB : null, sucursal?.nombre)}
                  generar={() => canalesACsv(ventaA.data!, datosB)}
                  testId="canales-csv"
                />
              )}
            </div>
            {errorB && (
              <p role="alert" className="text-peligro">
                Periodo B: {errorB}
              </p>
            )}
            {aMedias && (
              <p className="text-aviso" data-testid="aviso-a-medias">
                El periodo A va en curso (incluye hoy) y el B está completo: el Δ compara un periodo
                a medias contra uno entero.
              </p>
            )}
          </div>

          <div className="mt-3">
            {fallida && !(fallida === ventaB && errorB) ? (
              <ErrorTarjeta error={fallida.error} />
            ) : !listas || !ventaA.data ? (
              <Esqueleto lineas={5} />
            ) : (
              <Mezcla a={ventaA.data} b={datosB} />
            )}
          </div>

          <p className="mt-3 text-xs text-tinta-tenue">
            Mezcla: la parte de la venta del periodo que entró por ese canal. “—”: sin cuentas de
            ese canal en el periodo, o sin base para el Δ (pasa el cursor para ver por qué). El Δ de
            mezcla va en puntos porcentuales (pp). Venta bruta del POS: las comisiones de las
            plataformas no están descontadas.
          </p>
        </Tarjeta>
      )}
    </Vista>
  );
}

function Mezcla({ a, b }: { a: VentaPorArea; b: VentaPorArea | null }) {
  const vacioA = motivoVacio(a);
  const faltan = sinCatalogo(a);
  const filas = filasMezcla(a, b);
  const hayB = b !== null && b.cuentas > 0;
  if (a.cuentas === 0 && !hayB) {
    return (
      <p className="py-2 text-sm text-tinta-tenue" data-testid="canales-vacio">
        {vacioA}
      </p>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {faltan.length > 0 && (
        <p className="text-sm text-aviso" data-testid="canales-sin-catalogo">
          {faltan.join(', ')}: el agente todavía no ha mandado su catálogo de áreas, así que su
          venta cuenta como "{SIN_CANAL}". Hace falta que el agente de la sucursal sincronice sus
          catálogos.
        </p>
      )}
      {vacioA !== null && (
        <p className="text-sm text-tinta-tenue" data-testid="canales-vacio-a">
          Periodo A: {vacioA}
        </p>
      )}
      {b !== null && b.cuentas === 0 && (
        <p className="text-sm text-tinta-tenue" data-testid="canales-sin-b">
          Sin cuentas en el periodo B: no hay contra qué comparar. Elige otro periodo de
          comparación.
        </p>
      )}
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-max text-sm" data-testid="tabla-mezcla">
          <thead className="text-left text-tinta-tenue">
            <tr>
              <th scope="col" className={TH}>
                Canal
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Venta A
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Mezcla A
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Cuentas A
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Ticket prom. A
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Venta B
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Mezcla B
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Δ venta
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Δ mezcla
              </th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.llave} className="border-t border-linea" data-canal={f.llave}>
                <th scope="row" className={`${TD} font-normal`}>
                  {f.nombre}
                </th>
                <CeldasA l={f.a} />
                <CeldasB l={f.b} />
                <CeldaDelta d={f.deltaVenta} />
                <CeldaPp d={f.deltaMezcla} />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-linea-fuerte font-medium" data-canal="total">
              <th scope="row" className={TD}>
                Venta del periodo
              </th>
              <CeldasA l={ladoTotal(a)} barra={false} />
              <CeldasB l={ladoTotal(b)} />
              <CeldaDelta d={deltaTotal(a, b)} />
              <td className={NUM} />
            </tr>
          </tfoot>
        </table>
      </div>
      {a.cuentas > 0 && <Cuadre suma={sumaCanales(a)} venta={a.venta} testId="cuadre-canales-a" />}
      {b !== null && b.cuentas > 0 && (
        <Cuadre suma={sumaCanales(b)} venta={b.venta} testId="cuadre-canales-b" />
      )}
    </div>
  );
}

function Guion() {
  return <td className={`${NUM} text-tinta-tenue`}>—</td>;
}

function CeldasA({ l, barra = true }: { l: LadoCanal | null; barra?: boolean }) {
  if (l === null) {
    return (
      <>
        <Guion />
        <Guion />
        <Guion />
        <Guion />
      </>
    );
  }
  return (
    <>
      <td className={NUM}>{pesos(l.venta)}</td>
      <td className={NUM}>
        <div className="flex items-center justify-end gap-2">
          {barra && (
            <span className="hidden h-1.5 w-16 overflow-hidden rounded bg-realce sm:block" aria-hidden>
              <span
                className="block h-full bg-acento"
                style={{ width: `${decimasParaBarra(l.mezcla) / 10}%` }}
              />
            </span>
          )}
          {l.mezcla ?? '—'}
        </div>
      </td>
      <td className={NUM}>{l.cuentas}</td>
      <td className={NUM}>{l.ticket ?? '—'}</td>
    </>
  );
}

function CeldasB({ l }: { l: LadoCanal | null }) {
  if (l === null) {
    return (
      <>
        <Guion />
        <Guion />
      </>
    );
  }
  return (
    <>
      <td className={NUM}>{pesos(l.venta)}</td>
      <td className={NUM}>{l.mezcla ?? '—'}</td>
    </>
  );
}

function SinBase({ razon }: { razon: string }) {
  return (
    <td className={`${NUM} text-tinta-tenue`} title={razon}>
      —<span className="sr-only"> ({razon})</span>
    </td>
  );
}

function CeldaDelta({ d }: { d: Delta }) {
  if (d.tipo === 'sinBase') return <SinBase razon={d.razon} />;
  const color =
    d.diferencia > 0n ? 'text-exito' : d.diferencia < 0n ? 'text-peligro' : 'text-tinta-suave';
  return (
    <td className={`${NUM} ${color}`}>
      <div className="font-medium">{d.porcentaje}</div>
      <div className="text-xs">{diferenciaEnPesos(d.diferencia)}</div>
    </td>
  );
}

function CeldaPp({ d }: { d: DeltaPp }) {
  if (d.tipo === 'sinBase') return <SinBase razon={d.razon} />;
  const color = d.texto.startsWith('+')
    ? 'text-exito'
    : d.texto.startsWith('-')
      ? 'text-peligro'
      : 'text-tinta-suave';
  return <td className={`${NUM} ${color}`}>{d.texto}</td>;
}
