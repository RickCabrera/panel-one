import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';

import { useFiltroAlcance } from '../alertas/consultas';
import type { FilaResumenCliente, ResumenClientes } from '../api/tipos';
import { descargar, ErrorCsv } from '../csv/csv';
import { useAlcance } from '../filtros/alcance';
import { usePeriodo } from '../filtros/usePeriodo';
import type { Rango } from '../filtros/periodo';
import { pesos } from '../dinero/dinero';
import { Paginador } from './analisis/Bloques';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from './inicio/Tarjeta';
import type { Filtro } from './inicio/consultas';
import { todasLasFilas, useFichaCliente, useResumenClientes } from './clientes/consultas';
import { clientesACsv, nombreCsvClientes } from './clientes/csv';
import {
  enlaceTickets,
  estadoFila,
  nombreFila,
  participacion,
  sinCuentasConCliente,
  vacio,
} from './clientes/reglas';
import { cantidad, fechaHoraEn, fechaParaTabla } from './tickets/formato';
import { Vista } from './Vista';

const ZONA_POR_DEFECTO = 'America/Mexico_City';
const TH = 'px-2 py-1 font-medium';
const TD = 'px-2 py-2';
const NUM = 'px-2 py-2 text-right tabular-nums whitespace-nowrap';
const BOTON =
  'rounded-md border border-linea-fuerte bg-superficie px-3 py-1 text-sm text-tinta-medio hover:bg-realce disabled:opacity-50';
const CONTROL =
  'min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-1 text-sm focus:border-acento-borde focus:outline-none';

const importe = (v: string | null) => (v === null ? '—' : pesos(v));

/**
 * Clientes (F2-232): lo que el POS registra de cada cliente más lo que se deriva de sus cuentas
 * del periodo (visitas, ticket promedio, última visita, lo que más pide). Si la instalación no
 * usa clientes, lo dice y explica qué haría falta; no se inventa una ficha por cada cuenta.
 */
export function Clientes() {
  const filtro = useFiltroAlcance();
  const { rango } = usePeriodo();
  const { sucursal, sucursales } = useAlcance();
  const [parametros] = useSearchParams();
  // La búsqueda NO va a la URL del navegador: puede ser un nombre (historial, referer).
  const [q, setQ] = useState('');
  const [pagina, setPagina] = useState(1);
  const [elegido, setElegido] = useState<string | null>(null);
  const consulta = useResumenClientes(filtro, rango, q, pagina);
  const llave = `${filtro?.empresaId ?? ''}|${filtro?.sucursalId ?? ''}|${rango?.desde ?? ''}|${rango?.hasta ?? ''}`;
  const [llavePrevia, setLlavePrevia] = useState(llave);
  if (llavePrevia !== llave) {
    setLlavePrevia(llave);
    setPagina(1);
    setElegido(null);
  }
  const zonas = new Map((sucursales.data ?? []).map((s) => [s.id, s.zonaHoraria]));
  const zonaDe = (id: string) => zonas.get(id) ?? ZONA_POR_DEFECTO;
  const buscar = (texto: string) => {
    setQ(texto.trim().slice(0, 100));
    setPagina(1);
  };

  return (
    <Vista titulo="Clientes">
      <p className="mb-4 text-sm text-tinta-tenue">
        Los clientes que registra el POS de cada sucursal y lo que se sabe de ellos por sus
        cuentas del periodo. Una visita es una cuenta cobrada con ese cliente; las canceladas se
        muestran aparte y no suman a su venta.
      </p>
      {rango === null || filtro === null ? (
        <Tarjeta titulo="Clientes">
          <Vacio>Elige un periodo válido para ver a los clientes.</Vacio>
        </Tarjeta>
      ) : (
        <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={6} />}>
          {(r) => {
            const v = vacio(r);
            if (v.tipo === 'sin-clientes') {
              return (
                <Tarjeta titulo="Clientes">
                  <div className="space-y-2 text-sm" data-testid="clientes-vacio">
                    <p>{v.porque}</p>
                    <p className="text-tinta-medio">{v.falta}</p>
                  </div>
                </Tarjeta>
              );
            }
            return (
              <>
                <Periodo r={r} />
                <Tarjeta titulo="Clientes del periodo" className="mt-4">
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                    <Busqueda inicial={q} buscar={buscar} />
                    <Exportar filtro={filtro} rango={rango} q={q} sucursal={sucursal?.nombre} />
                  </div>
                  {r.filas.length === 0 ? (
                    <Vacio>
                      {q
                        ? 'Ningún cliente coincide con la búsqueda.'
                        : 'No hay clientes que mostrar en el periodo.'}
                    </Vacio>
                  ) : (
                    <Tabla r={r} elegido={elegido} elegir={setElegido} zonaDe={zonaDe} />
                  )}
                  <Paginador
                    pagina={r.pagina}
                    paginas={Math.max(1, Math.ceil(r.total / r.porPagina))}
                    total={r.total}
                    cambiar={setPagina}
                    etiqueta="clientes"
                  />
                </Tarjeta>
                {elegido && (
                  <Ficha
                    key={elegido}
                    id={elegido}
                    empresaId={filtro.empresaId}
                    rango={rango}
                    parametros={parametros}
                    zonaDe={zonaDe}
                    onCerrar={() => setElegido(null)}
                  />
                )}
              </>
            );
          }}
        </SegunEstado>
      )}
    </Vista>
  );
}

function Periodo({ r }: { r: ResumenClientes }) {
  const sinSincronizar = r.sucursales.filter((s) => s.catalogo === 'sin-sincronizar');
  const vacias = r.sucursales.filter((s) => s.catalogo === 'vacio');
  const sinCuentas = sinCuentasConCliente(r);
  return (
    <Tarjeta titulo="Periodo">
      <dl
        className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
        data-testid="clientes-totales"
      >
        <dt className="text-tinta-suave">Cuentas con cliente</dt>
        <dd className="tabular-nums">{participacion(r.cuentasConCliente, r.cuentas)}</dd>
        <dt className="text-tinta-suave">Venta de esas cuentas</dt>
        <dd className="tabular-nums">{pesos(r.ventaConCliente)}</dd>
      </dl>
      {sinCuentas.length > 0 && (
        <p className="mt-2 text-sm text-aviso" role="status" data-testid="clientes-sin-cuentas">
          Ninguna cuenta del periodo trae cliente en {sinCuentas.map((s) => s.sucursal).join(', ')}:
          sus clientes salen con 0 visitas porque las cuentas no lo capturan, no porque no hayan
          venido.
        </p>
      )}
      {sinSincronizar.length > 0 && (
        <p className="mt-2 text-sm text-aviso" role="status" data-testid="clientes-sin-catalogo">
          {sinSincronizar.map((s) => s.sucursal).join(', ')}{' '}
          {sinSincronizar.length === 1 ? 'no ha enviado' : 'no han enviado'} su catálogo de
          clientes: sus cuentas con cliente salen por el id del POS, sin nombre ni datos. Hace falta
          el agente conectado con la lectura de catálogos.
        </p>
      )}
      {vacias.length > 0 && (
        <p className="mt-2 text-sm text-tinta-medio" role="status">
          El catálogo de clientes de {vacias.map((s) => s.sucursal).join(', ')} llegó vacío.
        </p>
      )}
      {r.catalogoTruncado && (
        <p className="mt-2 text-sm text-aviso" role="status">
          El catálogo de clientes es más grande de lo que se lee de una vez: pueden faltar clientes
          sin visitas en el periodo. Los que sí vinieron salen todos.
        </p>
      )}
    </Tarjeta>
  );
}

function Busqueda({ inicial, buscar }: { inicial: string; buscar: (q: string) => void }) {
  const [texto, setTexto] = useState(inicial);
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    buscar(texto);
  };
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={enviar} role="search">
      <label className="text-sm text-tinta-suave" htmlFor="clientes-q">
        Buscar
      </label>
      <input
        id="clientes-q"
        type="search"
        className={CONTROL}
        value={texto}
        maxLength={100}
        placeholder="Nombre, clave o id del POS"
        onChange={(e) => setTexto(e.target.value)}
      />
      <button type="submit" className={BOTON}>
        Buscar
      </button>
    </form>
  );
}

function Exportar({
  filtro,
  rango,
  q,
  sucursal,
}: {
  filtro: Filtro;
  rango: Rango;
  q: string;
  sucursal?: string;
}) {
  const [contacto, setContacto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exportar = async () => {
    setOcupado(true);
    setError(null);
    try {
      const filas = await todasLasFilas(filtro, rango, q, contacto);
      descargar(nombreCsvClientes(rango, sucursal), clientesACsv(filas, contacto));
    } catch (e) {
      setError(e instanceof ErrorCsv ? e.message : 'No se pudo generar el archivo.');
    } finally {
      setOcupado(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="flex items-center gap-1 text-tinta-medio">
        <input
          type="checkbox"
          checked={contacto}
          onChange={(e) => setContacto(e.target.checked)}
          data-testid="clientes-csv-contacto"
        />
        Incluir nombre y datos de contacto (teléfono, correo, RFC)
      </label>
      <button
        type="button"
        className={BOTON}
        disabled={ocupado}
        onClick={() => void exportar()}
        data-testid="clientes-csv"
      >
        {ocupado ? 'Exportando…' : 'Exportar CSV'}
      </button>
      {error && (
        <span role="alert" className="text-peligro">
          {error}
        </span>
      )}
    </div>
  );
}

function Tabla({
  r,
  elegido,
  elegir,
  zonaDe,
}: {
  r: ResumenClientes;
  elegido: string | null;
  elegir: (id: string) => void;
  zonaDe: (sucursalId: string) => string;
}) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm" data-testid="tabla-clientes">
          <thead className="text-left text-xs text-tinta-suave">
            <tr>
              <th className={TH}>Cliente</th>
              <th className={TH}>Clave</th>
              <th className={TH}>Sucursal</th>
              <th className={TH}>Estado</th>
              <th className={`${TH} text-right`}>Visitas</th>
              <th className={`${TH} text-right`}>Venta</th>
              <th className={`${TH} text-right`}>Ticket prom.</th>
              <th className={TH}>Última visita</th>
              <th className={`${TH} text-right`}>Canceladas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-linea">
            {r.filas.map((f) => (
              <FilaTabla
                key={`${f.sucursalId}|${f.origenSrId}`}
                f={f}
                elegida={f.id !== null && f.id === elegido}
                elegir={elegir}
                zona={zonaDe(f.sucursalId)}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-tinta-tenue">
        Canceladas: cuentas · importe; no se suman a la venta. Un cliente sin ficha es un id que
        traen las cuentas y que el catálogo del POS no tiene: no hay datos que mostrar de él.
      </p>
    </>
  );
}

function FilaTabla({
  f,
  elegida,
  elegir,
  zona,
}: {
  f: FilaResumenCliente;
  elegida: boolean;
  elegir: (id: string) => void;
  zona: string;
}) {
  const ultima = f.ultimaVisita ? fechaHoraEn(zona, f.ultimaVisita) : null;
  return (
    <tr className={elegida ? 'bg-realce' : undefined} data-testid="fila-cliente">
      <td className={TD}>
        {f.id === null ? (
          <span className="italic text-tinta-tenue">{nombreFila(f)}</span>
        ) : (
          <button
            type="button"
            className="text-left text-acento-texto underline-offset-2 hover:underline"
            onClick={() => elegir(f.id!)}
          >
            {nombreFila(f)}
          </button>
        )}
      </td>
      <td className={`${TD} text-tinta-medio`}>{f.clave ?? '—'}</td>
      <td className={TD}>{f.sucursal}</td>
      <td className={TD}>{estadoFila(f)}</td>
      <td className={NUM}>{f.visitas}</td>
      <td className={NUM}>{pesos(f.venta)}</td>
      <td className={NUM}>{importe(f.ticketPromedio)}</td>
      <td className={`${TD} whitespace-nowrap`}>
        {ultima ? `${fechaParaTabla(ultima.fecha)} ${ultima.hora}` : '—'}
      </td>
      <td className={NUM}>
        {f.canceladas.cuentas} · {pesos(f.canceladas.monto)}
      </td>
    </tr>
  );
}

function Ficha({
  id,
  empresaId,
  rango,
  parametros,
  zonaDe,
  onCerrar,
}: {
  id: string;
  empresaId: string;
  rango: Rango;
  parametros: URLSearchParams;
  zonaDe: (sucursalId: string) => string;
  onCerrar: () => void;
}) {
  const consulta = useFichaCliente(empresaId, id, rango);
  return (
    <Tarjeta titulo="Ficha del cliente" className="mt-4">
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={5} />}>
        {(f) => {
          const c = f.cliente;
          const ultima = f.periodo.ultimaVisita
            ? fechaHoraEn(zonaDe(c.sucursalId), f.periodo.ultimaVisita)
            : null;
          return (
            <div className="text-sm" data-testid="ficha-cliente">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h3 className="text-base font-semibold">{c.nombre}</h3>
                <span className="text-tinta-medio">
                  {c.clave ?? 'Sin clave'} · {c.sucursal}
                </span>
                <button type="button" className={`${BOTON} ml-auto`} onClick={onCerrar}>
                  Cerrar
                </button>
              </div>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-tinta-suave">Teléfono</dt>
                <dd>{c.telefono ?? 'El POS no lo tiene'}</dd>
                <dt className="text-tinta-suave">Correo</dt>
                <dd>{c.correo ?? 'El POS no lo tiene'}</dd>
                <dt className="text-tinta-suave">RFC</dt>
                <dd>{c.rfc ?? 'El POS no lo tiene'}</dd>
              </dl>
              <dl
                className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1"
                data-testid="ficha-cliente-periodo"
              >
                <dt className="text-tinta-suave">Visitas en el periodo</dt>
                <dd className="tabular-nums">{f.periodo.visitas}</dd>
                <dt className="text-tinta-suave">Venta</dt>
                <dd className="tabular-nums">{pesos(f.periodo.venta)}</dd>
                <dt className="text-tinta-suave">Ticket promedio</dt>
                <dd className="tabular-nums">{importe(f.periodo.ticketPromedio)}</dd>
                <dt className="text-tinta-suave">Última visita</dt>
                <dd>{ultima ? `${fechaParaTabla(ultima.fecha)} ${ultima.hora}` : '—'}</dd>
                <dt className="text-tinta-suave">Canceladas</dt>
                <dd className="tabular-nums">
                  {f.periodo.canceladas.cuentas} cuenta
                  {f.periodo.canceladas.cuentas === 1 ? '' : 's'} por{' '}
                  {pesos(f.periodo.canceladas.monto)} (aparte: no suman a su venta)
                </dd>
              </dl>
              <p className="mt-2">
                <Link
                  to={enlaceTickets(parametros, c.id)}
                  className="text-acento-texto underline-offset-2 hover:underline"
                  data-testid="ficha-cliente-tickets"
                >
                  Ver sus {f.periodo.visitas} visitas en Tickets
                </Link>{' '}
                <span className="text-xs text-tinta-tenue">(sin las canceladas)</span>
              </p>
              <h4 className="mt-4 text-xs font-medium text-tinta-suave">Lo que más pide</h4>
              {f.productos.length === 0 ? (
                <p className="text-tinta-tenue">Sin visitas en el periodo.</p>
              ) : (
                <ol className="mt-1 divide-y divide-linea" data-testid="ficha-cliente-productos">
                  {f.productos.map((p) => (
                    <li key={p.producto} className="flex flex-wrap gap-x-3 py-1">
                      <span className="font-medium">{p.producto}</span>
                      <span className="tabular-nums text-tinta-medio">
                        {cantidad(p.cantidad)} · {pesos(p.importe)} · en {p.cuentas} visita
                        {p.cuentas === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        }}
      </SegunEstado>
    </Tarjeta>
  );
}
