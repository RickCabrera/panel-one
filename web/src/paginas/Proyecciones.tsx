import { useState } from 'react';

import { useFiltroAlcance } from '../alertas/consultas';
import type { FilaProyeccion, Proyecciones as DatosProyecciones } from '../api/tipos';
import { descargar, ErrorCsv, slug } from '../csv/csv';
import { Paginador } from './analisis/Bloques';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from './inicio/Tarjeta';
import { useProyecciones } from './proyecciones/consultas';
import {
  almacenesDe,
  ATAJOS_HORIZONTE,
  cant,
  conSugerido,
  filtrar,
  HORIZONTE_DEFECTO,
  HORIZONTE_MAX,
  HORIZONTE_MIN,
  leerHorizonte,
  motivoSucursal,
  nombreAlmacen,
  nombreInsumo,
  ordenDeCompraCsv,
  TEXTO_AVISO,
  textoRango,
  textoSinHistorial,
  vacio,
  valorAlmacen,
} from './proyecciones/reglas';
import { Vista } from './Vista';

const POR_PAGINA = 50;
const TH = 'px-2 py-1 font-medium';
const TD = 'px-2 py-2';
const NUM = 'px-2 py-2 text-right tabular-nums whitespace-nowrap';
const BOTON =
  'rounded-md border border-linea-fuerte bg-superficie px-3 py-1 text-sm text-tinta-medio hover:bg-realce disabled:opacity-50';
const BOTON_ACTIVO =
  'rounded-md border border-acento-borde bg-realce px-3 py-1 text-sm font-medium text-tinta';
const CONTROL =
  'min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-1 text-sm focus:border-acento-borde focus:outline-none disabled:opacity-50';

/**
 * Proyecciones y sugerido de compra (F2-127): cuánto va a salir de cada almacén en los próximos
 * días según las 4 semanas anteriores (promedio ponderado por día de la semana, sin ML) y cuánto
 * comprar para cubrirlo sin bajar del mínimo. Un artículo sin 4 semanas de historial dice "sin
 * datos", nunca sugiere 0 a ciegas. La orden de compra se descarga en CSV; nada se escribe a
 * SoftRestaurant.
 */
export function Proyecciones() {
  const filtro = useFiltroAlcance();
  const [horizonte, setHorizonte] = useState(HORIZONTE_DEFECTO);
  const [escrito, setEscrito] = useState(String(HORIZONTE_DEFECTO));
  const [almacen, setAlmacen] = useState('');
  const [q, setQ] = useState('');
  const [soloSugerido, setSoloSugerido] = useState(false);
  const [pagina, setPagina] = useState(1);
  const llave = `${filtro?.empresaId ?? ''}|${filtro?.sucursalId ?? ''}`;
  const [llavePrevia, setLlavePrevia] = useState(llave);
  if (llavePrevia !== llave) {
    setLlavePrevia(llave);
    setAlmacen('');
    setPagina(1);
  }
  const consulta = useProyecciones(filtro, horizonte);
  const elegirHorizonte = (n: number) => {
    setHorizonte(n);
    setEscrito(String(n));
    setPagina(1);
  };
  const escritoValido = leerHorizonte(escrito);

  return (
    <Vista titulo="Proyecciones">
      <p className="mb-4 text-sm text-tinta-tenue">
        Cuánto va a salir de cada almacén en los próximos días, según lo que salió las últimas 4
        semanas, y cuánto comprar para cubrirlo sin bajar del mínimo. Es una guía transparente, no
        un pronóstico mágico: abajo se explica cada número.
      </p>
      <Tarjeta titulo="Horizonte">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Atajos de horizonte">
            {ATAJOS_HORIZONTE.map((n) => (
              <button
                key={n}
                type="button"
                className={horizonte === n ? BOTON_ACTIVO : BOTON}
                aria-pressed={horizonte === n}
                onClick={() => elegirHorizonte(n)}
              >
                {n} días
              </button>
            ))}
          </div>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (escritoValido !== null) elegirHorizonte(escritoValido);
            }}
          >
            <label className="flex flex-col gap-1 text-sm text-tinta-suave">
              Días a cubrir ({HORIZONTE_MIN}–{HORIZONTE_MAX})
              <input
                className={`${CONTROL} w-24`}
                inputMode="numeric"
                value={escrito}
                onChange={(e) => setEscrito(e.target.value)}
                aria-invalid={escritoValido === null}
              />
            </label>
            <button type="submit" className={BOTON} disabled={escritoValido === null}>
              Aplicar
            </button>
          </form>
        </div>
        {escritoValido === null && (
          <p role="alert" className="mt-2 text-sm text-peligro">
            Escribe un número entero de días entre {HORIZONTE_MIN} y {HORIZONTE_MAX}.
          </p>
        )}
      </Tarjeta>
      <div className="mt-4">
        {filtro === null ? (
          <Tarjeta titulo="Sugerido de compra">
            <Esqueleto lineas={4} />
          </Tarjeta>
        ) : (
          <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={6} />}>
            {(r) => {
              const v = vacio(r);
              if (v.tipo === 'sin-datos') {
                return (
                  <Tarjeta titulo="Sugerido de compra">
                    <div className="space-y-2 text-sm" data-testid="proyecciones-vacio">
                      <p>{v.porque}</p>
                      <p className="text-tinta-medio">{v.falta}</p>
                    </div>
                  </Tarjeta>
                );
              }
              const filas = filtrar(r.filas, { almacen, q, soloSugerido });
              const paginas = Math.max(1, Math.ceil(filas.length / POR_PAGINA));
              const actual = Math.min(pagina, paginas);
              return (
                <Contenido
                  r={r}
                  filas={filas}
                  pagina={actual}
                  paginas={paginas}
                  cambiarPagina={setPagina}
                  almacen={almacen}
                  elegirAlmacen={(a) => {
                    setAlmacen(a);
                    setPagina(1);
                  }}
                  q={q}
                  buscar={(t) => {
                    setQ(t.slice(0, 100));
                    setPagina(1);
                  }}
                  soloSugerido={soloSugerido}
                  cambiarSoloSugerido={(s) => {
                    setSoloSugerido(s);
                    setPagina(1);
                  }}
                  nombreArchivo={`orden-compra_${r.sucursales.find((s) => s.calculada)?.hoy ?? ''}_${r.horizonte}d${
                    filtro.sucursalId ? `_${slug(r.sucursales[0]?.sucursal ?? '')}` : ''
                  }.csv`}
                />
              );
            }}
          </SegunEstado>
        )}
      </div>
    </Vista>
  );
}

function Contenido(p: {
  r: DatosProyecciones;
  filas: FilaProyeccion[];
  pagina: number;
  paginas: number;
  cambiarPagina: (n: number) => void;
  almacen: string;
  elegirAlmacen: (a: string) => void;
  q: string;
  buscar: (t: string) => void;
  soloSugerido: boolean;
  cambiarSoloSugerido: (s: boolean) => void;
  nombreArchivo: string;
}) {
  const { r } = p;
  const avisos = r.sucursales.map(motivoSucursal).filter((m): m is string => m !== null);
  const variasSucursales = r.sucursales.length > 1;
  const calculadas = r.sucursales.filter((s) => s.calculada);
  const [errorCsv, setErrorCsv] = useState<string | null>(null);
  const aComprar = p.filas.filter(conSugerido).length;
  const exportar = () => {
    try {
      descargar(p.nombreArchivo, ordenDeCompraCsv(r, p.filas));
      setErrorCsv(null);
    } catch (e) {
      setErrorCsv(e instanceof ErrorCsv ? e.message : 'No se pudo generar el archivo.');
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="kpis-proyecciones">
        <Kpi
          titulo="Artículos"
          valor={String(r.kpis.filas)}
          nota="Con movimientos, lectura o mínimo"
        />
        <Kpi
          titulo="Por comprar"
          valor={String(r.kpis.conSugerido)}
          nota="Con sugerido mayor que 0"
        />
        <Kpi
          titulo="Sin datos"
          valor={String(r.kpis.sinHistorial)}
          nota="Menos de 4 semanas de historial"
        />
      </div>
      {avisos.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-tinta-medio" data-testid="avisos-proyecciones">
          {avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      <Tarjeta titulo="Sugerido de compra" className="mt-4">
        <details className="mb-3 text-sm text-tinta-medio">
          <summary className="cursor-pointer">Cómo se calcula</summary>
          <div className="mt-2 space-y-2">
            <p>
              <strong>Demanda</strong>: lo que salió del almacén por pólizas de consumo, merma y
              traspaso a otro almacén (las canceladas no cuentan; los ajustes de conteo tampoco).
            </p>
            <p>
              <strong>Proyección</strong>: para cada día del horizonte se promedia lo que salió ese
              mismo día de la semana en las 4 semanas anteriores, con pesos {r.pesos.join(', ')} (la
              semana más reciente pesa más), y se suman los días. Hoy cuenta completo.
            </p>
            <p>
              <strong>Sugerido</strong> = proyección − existencia + mínimo (nunca negativo). La
              existencia es la última lectura del almacén; el mínimo, el que defines en Existencias.
            </p>
            {calculadas.map((s) => (
              <p key={s.sucursalId}>
                {variasSucursales ? `${s.sucursal}: ` : ''}historial{' '}
                {textoRango(s.ventanaDesde, s.ventanaHasta)} · horizonte{' '}
                {textoRango(s.horizonteDesde, s.horizonteHasta)}.
              </p>
            ))}
          </div>
        </details>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm text-tinta-suave">
              Buscar insumo
              <input
                className={CONTROL}
                type="search"
                value={p.q}
                onChange={(e) => p.buscar(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-tinta-suave">
              Almacén
              <select
                className={CONTROL}
                value={p.almacen}
                onChange={(e) => p.elegirAlmacen(e.target.value)}
              >
                <option value="">Todos los almacenes</option>
                {almacenesDe(r.filas).map((a) => (
                  <option key={valorAlmacen(a)} value={valorAlmacen(a)}>
                    {nombreAlmacen(a)}
                    {variasSucursales ? ` · ${a.sucursal}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-tinta-suave">
              <input
                type="checkbox"
                checked={p.soloSugerido}
                onChange={(e) => p.cambiarSoloSugerido(e.target.checked)}
              />
              Sólo lo que hay que comprar
            </label>
          </div>
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <button
              type="button"
              className={BOTON}
              onClick={exportar}
              disabled={aComprar === 0}
              data-testid="csv-orden-compra"
            >
              Orden de compra (CSV)
            </button>
            {aComprar === 0 && (
              <span className="text-sm text-tinta-tenue">Nada que comprar en esta vista.</span>
            )}
            {errorCsv && (
              <span role="alert" className="text-sm text-peligro">
                {errorCsv}
              </span>
            )}
          </span>
        </div>
        {p.filas.length === 0 ? (
          <Vacio>
            {r.filas.length === 0
              ? 'Las sucursales con pólizas todavía no tienen artículos que proyectar.'
              : 'Ningún artículo coincide con el filtro.'}
          </Vacio>
        ) : (
          <Tabla
            filas={p.filas.slice((p.pagina - 1) * POR_PAGINA, p.pagina * POR_PAGINA)}
            variasSucursales={variasSucursales}
          />
        )}
        <Paginador
          pagina={p.pagina}
          paginas={p.paginas}
          total={p.filas.length}
          cambiar={p.cambiarPagina}
          etiqueta="artículos"
        />
      </Tarjeta>
    </>
  );
}

function Kpi({ titulo, valor, nota }: { titulo: string; valor: string; nota: string }) {
  return (
    <div className="rounded-lg border border-linea bg-superficie p-3">
      <p className="text-sm text-tinta-suave">{titulo}</p>
      <p className="text-2xl font-semibold tabular-nums">{valor}</p>
      <p className="text-xs text-tinta-tenue">{nota}</p>
    </div>
  );
}

function Tabla({
  filas,
  variasSucursales,
}: {
  filas: FilaProyeccion[];
  variasSucursales: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] text-sm">
        <thead className="text-left text-tinta-suave">
          <tr>
            <th className={TH}>Insumo</th>
            <th className={TH}>Almacén</th>
            <th className={`${TH} text-right`} title="De la más antigua a la más reciente">
              4 semanas
            </th>
            <th className={`${TH} text-right`}>Proyección</th>
            <th className={`${TH} text-right`}>Existencia</th>
            <th className={`${TH} text-right`}>Mínimo</th>
            <th className={`${TH} text-right`}>Sugerido</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr
              key={`${f.sucursalId}|${f.almacenOrigenSrId}|${f.insumoOrigenSrId}`}
              className="border-t border-linea align-top"
              data-testid="fila-proyeccion"
            >
              <td className={TD}>
                <span className="font-medium">{nombreInsumo(f)}</span>
                {f.unidad && <span className="text-tinta-tenue"> · {f.unidad}</span>}
                {f.avisos.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-tinta-medio">
                    {f.avisos.map((a) => (
                      <li key={a}>{TEXTO_AVISO[a]}</li>
                    ))}
                  </ul>
                )}
              </td>
              <td className={TD}>
                {nombreAlmacen(f)}
                {variasSucursales && <span className="text-tinta-tenue"> · {f.sucursal}</span>}
              </td>
              {f.estado === 'sin_historial' ? (
                <td className={`${TD} text-tinta-medio`} colSpan={2}>
                  {textoSinHistorial(f)}
                </td>
              ) : (
                <>
                  <td className={NUM}>
                    {/* El API las manda de la más reciente a la más vieja; se leen al revés. */}
                    {[...(f.semanas ?? [])].reverse().map(cant).join(' · ')}
                  </td>
                  <td className={NUM}>{cant(f.proyeccion)}</td>
                </>
              )}
              <td className={NUM}>{cant(f.existencia)}</td>
              <td className={NUM}>{cant(f.minimo)}</td>
              <td className={`${NUM} font-semibold`}>
                {f.estado === 'sin_historial' ? 'Sin datos' : cant(f.sugerido)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
