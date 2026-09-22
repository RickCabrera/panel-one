import { useState } from 'react';

import { useFiltroAlcance } from '../alertas/consultas';
import type { FilaKardex, FilaMovimiento, Kardex } from '../api/tipos';
import { pesos } from '../dinero/dinero';
import { usePeriodo } from '../filtros/usePeriodo';
import { Paginador } from './analisis/Bloques';
import { horaLectura, leerValorAlmacen, nombreAlmacen, valorAlmacen } from './existencias/reglas';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from './inicio/Tarjeta';
import { POR_PAGINA, useKardex, useMovimientos, usePoliza } from './movimientos/consultas';
import {
  cantidadConSigno,
  cuadreDe,
  leerTipo,
  nombreInsumo,
  sentido,
  sucursalesSinMovimientos,
  TEXTO_TIPO,
  TIPOS,
  vacio,
  type Articulo,
} from './movimientos/reglas';
import { cantidad } from './tickets/formato';
import { Vista } from './Vista';

const TH = 'px-2 py-1 font-medium';
const TD = 'px-2 py-2';
const NUM = 'px-2 py-2 text-right tabular-nums whitespace-nowrap';
const BOTON =
  'rounded-md border border-linea-fuerte bg-superficie px-3 py-1 text-sm text-tinta-medio hover:bg-realce disabled:opacity-50';
const ENLACE = 'text-left text-acento-texto underline-offset-2 hover:underline';
const CONTROL =
  'min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-1 text-sm focus:border-acento-borde focus:outline-none disabled:opacity-50';

const cant = (v: string | null) => (v === null ? '—' : cantidad(v));

/**
 * Movimientos (F2-122): la línea de tiempo de las pólizas de inventario que manda el agente, el
 * detalle de una póliza con sus partidas y el kardex de un artículo con su saldo corrido y el
 * cuadre contra la existencia leída. Las horas van en la zona de la sucursal. Si no hay
 * movimientos, lo dice y explica qué falta; nunca una tabla vacía sin explicación.
 */
export function Movimientos() {
  const filtro = useFiltroAlcance();
  const { rango } = usePeriodo();
  const [almacenElegido, setAlmacenElegido] = useState('');
  const [tipoElegido, setTipoElegido] = useState('');
  const [articulo, setArticulo] = useState<Articulo | null>(null);
  const [polizaId, setPolizaId] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  // Otro alcance: lo elegido era de otra empresa o sucursal. Otro periodo: vuelve a la página 1.
  const alcance = `${filtro?.empresaId ?? ''}|${filtro?.sucursalId ?? ''}`;
  const periodo = `${rango?.desde ?? ''}|${rango?.hasta ?? ''}`;
  const [previos, setPrevios] = useState({ alcance, periodo });
  if (previos.alcance !== alcance || previos.periodo !== periodo) {
    setPrevios({ alcance, periodo });
    setPagina(1);
    if (previos.alcance !== alcance) {
      setAlmacenElegido('');
      setArticulo(null);
      setPolizaId(null);
    }
  }
  const almacen = leerValorAlmacen(almacenElegido);
  const tipo = leerTipo(tipoElegido);
  const consulta = useMovimientos(filtro, rango, { almacen, tipo, articulo, pagina });

  return (
    <Vista titulo="Movimientos">
      <p className="mb-4 text-sm text-tinta-tenue">
        Las pólizas de inventario del POS (entradas, salidas, mermas, ajustes) en el periodo
        elegido, con el detalle de cada póliza y el kardex de cada artículo en su almacén.
      </p>
      {rango === null ? (
        <Tarjeta titulo="Movimientos">
          <Vacio>El rango de fechas no es válido: corrígelo en la cabecera para consultar.</Vacio>
        </Tarjeta>
      ) : filtro === null ? (
        <Tarjeta titulo="Movimientos">
          <Esqueleto lineas={4} />
        </Tarjeta>
      ) : (
        <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={6} />}>
          {(r) => {
            const v = vacio(r, almacen !== null || tipo !== null || articulo !== null);
            if (v.tipo === 'sin-movimientos') {
              return (
                <Tarjeta titulo="Movimientos">
                  <div className="space-y-2 text-sm" data-testid="movimientos-vacio">
                    <p>{v.porque}</p>
                    <p className="text-tinta-medio">{v.falta}</p>
                  </div>
                </Tarjeta>
              );
            }
            const zonaDe = (sucursalId: string) =>
              r.sucursales.find((s) => s.sucursalId === sucursalId)?.zonaHoraria ?? null;
            const paginas = Math.max(1, Math.ceil(r.total / POR_PAGINA));
            const sinMovs = sucursalesSinMovimientos(r);
            return (
              <>
                {sinMovs.length > 0 && (
                  <p className="mb-3 text-sm text-tinta-medio" data-testid="aviso-sin-movimientos">
                    Sin movimientos recibidos todavía de: {sinMovs.join(', ')}.
                  </p>
                )}
                {articulo && (
                  <PanelKardex
                    empresaId={filtro.empresaId}
                    articulo={articulo}
                    rango={rango}
                    cerrar={() => {
                      setArticulo(null);
                      setPagina(1);
                    }}
                    verPoliza={setPolizaId}
                  />
                )}
                {polizaId && (
                  <PanelPoliza
                    empresaId={filtro.empresaId}
                    id={polizaId}
                    cerrar={() => setPolizaId(null)}
                  />
                )}
                <Tarjeta titulo="Línea de tiempo" className="mt-4">
                  <div className="mb-3 flex flex-wrap items-end gap-3">
                    <label className="flex flex-wrap items-center gap-2 text-sm text-tinta-suave">
                      Almacén
                      <select
                        className={CONTROL}
                        value={almacenElegido}
                        disabled={articulo !== null}
                        onChange={(e) => {
                          setAlmacenElegido(e.target.value);
                          setPagina(1);
                        }}
                      >
                        <option value="">Todos los almacenes</option>
                        {r.almacenes.map((a) => (
                          <option key={valorAlmacen(a)} value={valorAlmacen(a)}>
                            {nombreAlmacen(a)}
                            {r.sucursales.length > 1
                              ? ` · ${r.sucursales.find((s) => s.sucursalId === a.sucursalId)?.sucursal ?? ''}`
                              : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-wrap items-center gap-2 text-sm text-tinta-suave">
                      Tipo
                      <select
                        className={CONTROL}
                        value={tipoElegido}
                        onChange={(e) => {
                          setTipoElegido(e.target.value);
                          setPagina(1);
                        }}
                      >
                        <option value="">Todos los tipos</option>
                        {TIPOS.map((t) => (
                          <option key={t} value={t}>
                            {TEXTO_TIPO[t]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {v.tipo === 'periodo-vacio' ? (
                    <Vacio>{v.porque}</Vacio>
                  ) : (
                    <TablaMovimientos
                      filas={r.movimientos}
                      zonaDe={zonaDe}
                      variasSucursales={r.sucursales.length > 1}
                      verPoliza={setPolizaId}
                      verKardex={(m) => {
                        setArticulo({
                          sucursalId: m.sucursalId,
                          almacenOrigenSrId: m.almacenOrigenSrId,
                          insumoOrigenSrId: m.insumoOrigenSrId,
                        });
                        setPagina(1);
                      }}
                    />
                  )}
                  <Paginador
                    pagina={Math.min(pagina, paginas)}
                    paginas={paginas}
                    total={r.total}
                    cambiar={setPagina}
                    etiqueta="movimientos"
                  />
                </Tarjeta>
              </>
            );
          }}
        </SegunEstado>
      )}
    </Vista>
  );
}

function Fecha({ zona, instante }: { zona: string | null; instante: string }) {
  return <>{zona ? horaLectura(zona, instante) : 'Sin dato de zona'}</>;
}

function Tipo({ m }: { m: Pick<FilaMovimiento, 'poliza'> }) {
  return (
    <>
      {TEXTO_TIPO[m.poliza.tipo]}
      {m.poliza.cancelada && (
        <span className="ml-1 rounded bg-realce-fuerte px-1 text-xs text-tinta-medio">
          Cancelada
        </span>
      )}
    </>
  );
}

function TablaMovimientos({
  filas,
  zonaDe,
  variasSucursales,
  verPoliza,
  verKardex,
}: {
  filas: FilaMovimiento[];
  zonaDe: (sucursalId: string) => string | null;
  variasSucursales: boolean;
  verPoliza: (id: string) => void;
  verKardex: (m: FilaMovimiento) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] text-sm" data-testid="tabla-movimientos">
        <thead className="text-left text-tinta-suave">
          <tr>
            <th className={TH}>Fecha</th>
            <th className={TH}>Póliza</th>
            <th className={TH}>Tipo</th>
            <th className={TH}>Almacén</th>
            <th className={TH}>Artículo</th>
            <th className={`${TH} text-right`}>Cantidad</th>
            <th className={`${TH} text-right`}>Costo</th>
            <th className={`${TH} text-right`}>Importe</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((m) => (
            <tr
              key={m.id}
              className={`border-t border-linea ${m.poliza.cancelada ? 'text-tinta-tenue line-through' : ''}`}
            >
              <td className={`${TD} whitespace-nowrap`}>
                <Fecha zona={zonaDe(m.sucursalId)} instante={m.fecha} />
              </td>
              <td className={TD}>
                <button type="button" className={ENLACE} onClick={() => verPoliza(m.poliza.id)}>
                  {m.poliza.folio}
                </button>
              </td>
              <td className={TD}>
                <Tipo m={m} />
              </td>
              <td className={TD}>
                {nombreAlmacen(m)}
                {variasSucursales && <span className="text-tinta-tenue"> · {m.sucursal}</span>}
              </td>
              <td className={TD}>
                <button
                  type="button"
                  className={ENLACE}
                  title="Ver el kardex de este artículo en este almacén"
                  onClick={() => verKardex(m)}
                >
                  {nombreInsumo(m)}
                </button>
                {m.unidad && <span className="text-tinta-tenue"> · {m.unidad}</span>}
              </td>
              <td className={NUM} title={sentido(m.cantidad)}>
                {cantidadConSigno(m.cantidad)}
              </td>
              <td className={NUM}>{pesos(m.costoUnitario)}</td>
              <td className={NUM}>{pesos(m.importe)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PanelPoliza({
  empresaId,
  id,
  cerrar,
}: {
  empresaId: string;
  id: string;
  cerrar: () => void;
}) {
  const consulta = usePoliza(empresaId, id);
  return (
    <Tarjeta titulo="Detalle de póliza" className="mt-4">
      <div className="mb-2 flex justify-end">
        <button type="button" className={BOTON} onClick={cerrar}>
          Cerrar detalle
        </button>
      </div>
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={3} />}>
        {(p) => (
          <div data-testid="detalle-poliza">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <dt className="text-tinta-tenue">Folio</dt>
              <dd>{p.folio}</dd>
              <dt className="text-tinta-tenue">Tipo</dt>
              <dd>
                <Tipo m={{ poliza: p }} />
                {p.tipoSr && <span className="text-tinta-tenue"> (en SR: {p.tipoSr})</span>}
              </dd>
              <dt className="text-tinta-tenue">Fecha</dt>
              <dd>
                <Fecha zona={p.zonaHoraria} instante={p.fecha} />
              </dd>
              <dt className="text-tinta-tenue">Almacén</dt>
              <dd>
                {nombreAlmacen(p)} · {p.sucursal}
              </dd>
              <dt className="text-tinta-tenue">Referencia</dt>
              <dd>{p.referencia ?? 'Sin referencia'}</dd>
            </dl>
            {p.cancelada && (
              <p className="mt-2 text-sm text-aviso">
                Póliza cancelada en el POS: se muestra, pero no suma al kardex.
              </p>
            )}
            {p.partidas.length === 0 ? (
              <Vacio>Esta póliza no tiene partidas.</Vacio>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[32rem] text-sm" data-testid="partidas-poliza">
                  <thead className="text-left text-tinta-suave">
                    <tr>
                      <th className={TH}>#</th>
                      <th className={TH}>Artículo</th>
                      <th className={`${TH} text-right`}>Cantidad</th>
                      <th className={`${TH} text-right`}>Costo</th>
                      <th className={`${TH} text-right`}>Importe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.partidas.map((x) => (
                      <tr key={x.renglon} className="border-t border-linea">
                        <td className={TD}>{x.renglon + 1}</td>
                        <td className={TD}>
                          {nombreInsumo(x)}
                          {x.unidad && <span className="text-tinta-tenue"> · {x.unidad}</span>}
                        </td>
                        <td className={NUM}>{cantidadConSigno(x.cantidad)}</td>
                        <td className={NUM}>{pesos(x.costoUnitario)}</td>
                        <td className={NUM}>{pesos(x.importe)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-linea-fuerte font-medium">
                      <td className={TD} colSpan={4}>
                        Total de la póliza
                      </td>
                      <td className={NUM} data-testid="total-poliza">
                        {pesos(p.importeTotal)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}
      </SegunEstado>
    </Tarjeta>
  );
}

function PanelKardex({
  empresaId,
  articulo,
  rango,
  cerrar,
  verPoliza,
}: {
  empresaId: string;
  articulo: Articulo;
  rango: { desde: string; hasta: string };
  cerrar: () => void;
  verPoliza: (id: string) => void;
}) {
  const consulta = useKardex(empresaId, articulo, rango);
  return (
    <Tarjeta titulo="Kardex" className="mt-4">
      <div className="mb-2 flex justify-end">
        <button type="button" className={BOTON} onClick={cerrar}>
          Cerrar kardex
        </button>
      </div>
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={4} />}>
        {(k) => <ContenidoKardex k={k} verPoliza={verPoliza} />}
      </SegunEstado>
    </Tarjeta>
  );
}

function ContenidoKardex({ k, verPoliza }: { k: Kardex; verPoliza: (id: string) => void }) {
  const corte = k.corteExistencia ? horaLectura(k.zonaHoraria, k.corteExistencia) : null;
  const cuadre = cuadreDe(k, corte);
  const unidad = k.unidad ? ` ${k.unidad}` : '';
  return (
    <div data-testid="kardex">
      <p className="text-sm font-medium">
        {nombreInsumo(k)} · {nombreAlmacen(k)} · {k.sucursal}
      </p>
      <p
        className={`mt-2 text-sm ${
          cuadre.tipo === 'diferencia'
            ? 'text-peligro'
            : cuadre.tipo === 'cuadra'
              ? 'text-exito'
              : 'text-tinta-medio'
        }`}
        data-testid="kardex-cuadre"
      >
        {cuadre.texto}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <dt className="text-tinta-tenue">Saldo inicial</dt>
        <dd className="tabular-nums" data-testid="kardex-inicial">
          {cant(k.saldoInicial)}
          {unidad}
        </dd>
        <dt className="text-tinta-tenue">Saldo final</dt>
        <dd className="tabular-nums" data-testid="kardex-final">
          {cant(k.saldoFinal)}
          {unidad}
        </dd>
        <dt className="text-tinta-tenue">Entradas</dt>
        <dd className="tabular-nums">{cant(k.entradas)}</dd>
        <dt className="text-tinta-tenue">Salidas</dt>
        <dd className="tabular-nums">{cant(k.salidas)}</dd>
      </dl>
      {k.movimientos.length === 0 ? (
        <Vacio>Sin movimientos de este artículo en el periodo: el saldo no cambió.</Vacio>
      ) : (
        <TablaKardex filas={k.movimientos} zona={k.zonaHoraria} verPoliza={verPoliza} />
      )}
    </div>
  );
}

function TablaKardex({
  filas,
  zona,
  verPoliza,
}: {
  filas: FilaKardex[];
  zona: string;
  verPoliza: (id: string) => void;
}) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[36rem] text-sm" data-testid="tabla-kardex">
        <thead className="text-left text-tinta-suave">
          <tr>
            <th className={TH}>Fecha</th>
            <th className={TH}>Póliza</th>
            <th className={TH}>Tipo</th>
            <th className={`${TH} text-right`}>Movimiento</th>
            <th className={`${TH} text-right`}>Saldo</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((m) => (
            <tr
              key={m.id}
              className={`border-t border-linea ${m.poliza.cancelada ? 'text-tinta-tenue line-through' : ''}`}
            >
              <td className={`${TD} whitespace-nowrap`}>
                <Fecha zona={zona} instante={m.fecha} />
              </td>
              <td className={TD}>
                <button type="button" className={ENLACE} onClick={() => verPoliza(m.poliza.id)}>
                  {m.poliza.folio}
                </button>
              </td>
              <td className={TD}>
                <Tipo m={m} />
              </td>
              <td className={NUM}>{cantidadConSigno(m.cantidad)}</td>
              <td className={NUM}>{cant(m.saldo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
