import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ErrorApi } from '../../../api/cliente';
import type {
  CfdiFila,
  EstadoCfdiEmitido,
  OrigenCfdi,
  Sucursal,
  TableroFacturacion,
} from '../../../api/tipos';
import { descargar, ErrorCsv, nombreCsv } from '../../../csv/csv';
import { pesos, pesosCompactos } from '../../../dinero/dinero';
import type { Rango } from '../../../filtros/periodo';
import { useTema } from '../../../tema/contexto';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from '../../inicio/Tarjeta';
import type { Filtro } from '../../inicio/consultas';
import { fechaHoraEn, fechaParaTabla } from '../../tickets/formato';
import {
  bajarArchivoCfdi,
  LLAVE_TABLERO,
  POR_PAGINA_TABLA,
  reintentarEnvio,
  todosLosCfdis,
  useCfdis,
  useEnviosPendientes,
  usePorFacturar,
  useTablero,
} from './consultas';
import { DialogoRefacturar } from '../emision/DialogoRefacturar';
import { GraficaSerie } from './graficas';
import {
  cfdisACsv,
  motivoSinFacturas,
  puntosHora,
  puntosMes,
  puntosSucursal,
  tasaTexto,
} from './reglas';

const CONTROL =
  'min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-1 text-sm focus:border-acento-borde focus:outline-none disabled:opacity-50';
const BOTON =
  'rounded-md border border-linea-fuerte px-2 py-1 text-sm hover:bg-realce disabled:opacity-50';
const TH = 'px-2 py-1 text-left font-medium';
const NUM = 'px-2 py-1 text-right tabular-nums whitespace-nowrap';

const mensajeDe = (e: unknown) => (e instanceof ErrorApi ? e.message : 'Error inesperado.');

const facturas = (n: number) => `${n} ${n === 1 ? 'factura' : 'facturas'}`;

/**
 * Tablero de facturación (F2-106): KPIs, barras por sucursal / mes / hora, la tabla de CFDI con
 * búsqueda y CSV, las cuentas por facturar y los envíos por correo a reintentar. El periodo y la
 * sucursal son los globales de la cabecera. Ninguna cifra se calcula aquí.
 */
export function TableroFacturacion({
  filtro,
  rango,
  sucursales,
}: {
  filtro: Filtro | null;
  rango: Rango | null;
  sucursales: readonly Sucursal[];
}) {
  const tablero = useTablero(filtro, rango);
  if (rango === null) {
    return (
      <Tarjeta titulo="Tablero de facturación">
        <Vacio>El rango de fechas no es válido: corrígelo en la cabecera.</Vacio>
      </Tarjeta>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <SegunEstado consulta={tablero} esqueleto={<Esqueleto lineas={4} grafica />}>
        {(t) => <Resumen t={t} />}
      </SegunEstado>
      <TablaCfdis filtro={filtro} rango={rango} sucursales={sucursales} />
      <PorFacturar filtro={filtro} rango={rango} sucursales={sucursales} />
      <EnviosPendientes empresaId={filtro?.empresaId ?? null} />
    </div>
  );
}

function Kpi({
  titulo,
  valor,
  detalle,
  testId,
  ayuda,
}: {
  titulo: string;
  valor: string;
  detalle?: string;
  testId: string;
  ayuda?: string;
}) {
  return (
    <Tarjeta titulo={titulo}>
      <div className="text-2xl font-semibold tabular-nums" data-testid={testId} title={ayuda}>
        {valor}
      </div>
      {detalle && <div className="text-xs text-tinta-tenue">{detalle}</div>}
    </Tarjeta>
  );
}

export const AYUDA_TASA =
  'Facturado a clientes en el periodo (por fecha de emisión) entre la venta del periodo (por ' +
  'cierre). La factura global a público en general NO cuenta. Un ticket de otro periodo ' +
  'facturado en éste la puede llevar arriba de 100 %.';
export const AYUDA_GLOBAL =
  'Facturas globales a público en general emitidas en el periodo: amparan los tickets que ningún ' +
  'cliente facturó a tiempo. Van aparte de lo facturado y no suman a la tasa.';
export const SIN_TASA = 'Sin venta en el periodo: no hay tasa de facturación.';

function Resumen({ t }: { t: TableroFacturacion }) {
  const tasa = tasaTexto(t.tasa);
  const motivo = motivoSinFacturas(t);
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <Kpi
          titulo="Ventas del periodo"
          valor={pesos(t.ventas.venta)}
          detalle={`${t.ventas.cuentas} tickets sincronizados`}
          testId="kpi-ventas"
        />
        <Kpi
          titulo="Facturado"
          valor={pesos(t.facturado.monto)}
          detalle={`${facturas(t.facturado.cfdis)} vigentes a clientes`}
          testId="kpi-facturado"
        />
        <Kpi
          titulo="Factura global"
          valor={pesos(t.global.monto)}
          detalle={`${facturas(t.global.cfdis)} a público en general; no suma a la tasa`}
          testId="kpi-global"
          ayuda={AYUDA_GLOBAL}
        />
        <Kpi
          titulo="Cancelaciones"
          valor={pesos(t.cancelados.monto)}
          detalle={`${facturas(t.cancelados.cfdis)} emitidas en el periodo y hoy canceladas`}
          testId="kpi-cancelados"
        />
        <Kpi
          titulo="Tasa de facturación"
          valor={tasa ?? '—'}
          detalle={tasa === null ? SIN_TASA : 'facturado a clientes / venta'}
          testId="kpi-tasa"
          ayuda={AYUDA_TASA}
        />
        <Kpi
          titulo="Por facturar"
          valor={pesos(t.porFacturar.monto)}
          detalle={`${t.porFacturar.cuentas} tickets con código vigente sin factura`}
          testId="kpi-por-facturar"
        />
      </div>
      {motivo !== null ? (
        <Tarjeta titulo="Facturas del periodo">
          <Vacio>
            <span data-testid="sin-facturas">{motivo}</span>
          </Vacio>
        </Tarjeta>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Tarjeta titulo="Venta y facturado por sucursal">
            <GraficaSucursales t={t} />
          </Tarjeta>
          <Tarjeta titulo="Facturado a clientes por mes">
            <GraficaSerie puntos={puntosMes(t)} />
          </Tarjeta>
          <Tarjeta titulo="Facturado a clientes por hora de emisión">
            <GraficaSerie puntos={puntosHora(t)} />
          </Tarjeta>
        </div>
      )}
    </>
  );
}

function GraficaSucursales({ t }: { t: TableroFacturacion }) {
  const { colores } = useTema();
  const eje = { fontSize: 11, fill: colores['tinta-tenue'] };
  const puntos = puntosSucursal(t);
  return (
    <>
      <div className="h-56 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={puntos} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={colores.rejilla} vertical={false} />
            <XAxis dataKey="nombre" tick={eje} interval={0} />
            <YAxis width={44} tick={eje} tickFormatter={pesosCompactos} />
            <Tooltip
              cursor={{ fill: colores.realce }}
              formatter={(v) => pesosCompactos(Number(v))}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="venta" name="Venta" fill={colores['serie-2']} isAnimationActive={false} />
            <Bar
              dataKey="facturado"
              name="Facturado"
              fill={colores['serie-1']}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="mt-2 w-full text-xs">
        <thead className="text-tinta-tenue">
          <tr>
            <th className={TH}>Sucursal</th>
            <th className={`${NUM} font-medium`}>Facturado</th>
            <th className={`${NUM} font-medium`} title={AYUDA_GLOBAL}>
              Global
            </th>
            <th className={`${NUM} font-medium`}>Tasa</th>
          </tr>
        </thead>
        <tbody>
          {puntos.map((p) => (
            <tr key={p.sucursalId} className="border-t border-linea">
              <td className="px-2 py-1">{p.nombre}</td>
              <td className={NUM}>{pesos(p.facturadoTexto)}</td>
              <td className={NUM}>{pesos(p.globalTexto)}</td>
              <td className={NUM} title={p.tasa === null ? SIN_TASA : AYUDA_TASA}>
                {tasaTexto(p.tasa) ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Paginador({
  pagina,
  total,
  onPagina,
}: {
  pagina: number;
  total: number;
  onPagina: (p: number) => void;
}) {
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA_TABLA));
  return (
    <div className="mt-2 flex items-center justify-end gap-2 text-sm">
      <button
        type="button"
        className={BOTON}
        disabled={pagina <= 1}
        onClick={() => onPagina(pagina - 1)}
      >
        Anterior
      </button>
      <span className="text-tinta-tenue">
        Página {pagina} de {paginas}
      </span>
      <button
        type="button"
        className={BOTON}
        disabled={pagina >= paginas}
        onClick={() => onPagina(pagina + 1)}
      >
        Siguiente
      </button>
    </div>
  );
}

async function bajar(c: CfdiFila, extension: 'xml' | 'pdf') {
  const blob = await bajarArchivoCfdi(c.id, extension);
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = `${c.serieFolio}_${c.uuid}.${extension}`;
  enlace.style.display = 'none';
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const AYUDA_BUSQUEDA =
  'Busca por RFC del receptor, UUID, serie-folio o folio del ticket, sólo en las facturas del periodo seleccionado.';

function TablaCfdis({
  filtro,
  rango,
  sucursales,
}: {
  filtro: Filtro | null;
  rango: Rango;
  sucursales: readonly Sucursal[];
}) {
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState<EstadoCfdiEmitido | null>(null);
  const [origen, setOrigen] = useState<OrigenCfdi | null>(null);
  const [pagina, setPagina] = useState(1);
  const [aviso, setAviso] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);
  const [refacturando, setRefacturando] = useState<CfdiFila | null>(null);
  const consulta = useCfdis(filtro, rango, { q, estado, origen, pagina });
  const porId = new Map(sucursales.map((s) => [s.id, s]));

  function buscar(e: FormEvent) {
    e.preventDefault();
    setQ(texto.trim());
    setPagina(1);
  }

  async function exportar() {
    if (!filtro) return;
    setExportando(true);
    setAviso(null);
    try {
      const todos = await todosLosCfdis(filtro, rango, { q, estado, origen });
      const sucursal = filtro.sucursalId ? porId.get(filtro.sucursalId)?.nombre : undefined;
      descargar(nombreCsv('facturas', rango.desde, rango.hasta, sucursal), cfdisACsv(todos, porId));
    } catch (e) {
      setAviso(e instanceof ErrorCsv ? e.message : `No se pudo exportar. ${mensajeDe(e)}`);
    } finally {
      setExportando(false);
    }
  }

  async function descargarArchivo(c: CfdiFila, extension: 'xml' | 'pdf') {
    setAviso(null);
    try {
      await bajar(c, extension);
    } catch (e) {
      setAviso(`No se pudo descargar el ${extension.toUpperCase()}. ${mensajeDe(e)}`);
    }
  }

  return (
    <Tarjeta titulo="Facturas emitidas">
      <form className="flex flex-wrap items-end gap-2" onSubmit={buscar} role="search">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          Buscar
          <input
            className={CONTROL}
            value={texto}
            maxLength={64}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="RFC, UUID, serie-folio o folio del ticket"
            aria-describedby="ayuda-busqueda-cfdi"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Estado
          <select
            className={CONTROL}
            value={estado ?? ''}
            onChange={(e) => {
              setEstado((e.target.value || null) as EstadoCfdiEmitido | null);
              setPagina(1);
            }}
          >
            <option value="">Todas</option>
            <option value="vigente">Vigentes</option>
            <option value="cancelado">Canceladas</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Origen
          <select
            className={CONTROL}
            value={origen ?? ''}
            onChange={(e) => {
              setOrigen((e.target.value || null) as OrigenCfdi | null);
              setPagina(1);
            }}
          >
            <option value="">Todas</option>
            <option value="ticket">De ticket</option>
            <option value="manual">Sin ticket (manual)</option>
            <option value="global">Factura global</option>
          </select>
        </label>
        <button type="submit" className={BOTON}>
          Buscar
        </button>
        <button
          type="button"
          className={BOTON}
          disabled={exportando || !consulta.data || consulta.data.total === 0}
          onClick={() => void exportar()}
        >
          {exportando ? 'Exportando…' : 'Exportar CSV'}
        </button>
      </form>
      <p id="ayuda-busqueda-cfdi" className="mt-1 text-xs text-tinta-tenue">
        {AYUDA_BUSQUEDA}
      </p>
      {aviso && (
        <p role="alert" className="mt-2 text-sm text-peligro">
          {aviso}
        </p>
      )}
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={4} />}>
        {(p) =>
          p.total === 0 ? (
            <Vacio>
              {q || estado || origen
                ? 'Ninguna factura del periodo coincide con la búsqueda.'
                : 'No se emitió ninguna factura en este periodo.'}
            </Vacio>
          ) : (
            <>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm" data-testid="tabla-cfdis">
                  <thead className="text-tinta-tenue">
                    <tr>
                      <th className={TH}>Serie-folio</th>
                      <th className={TH}>UUID</th>
                      <th className={TH}>Emitida</th>
                      <th className={TH}>Sucursal</th>
                      <th className={TH}>Receptor</th>
                      <th className={`${NUM} font-medium`}>Total</th>
                      <th className={TH}>Estado</th>
                      <th className={TH}>Ticket</th>
                      <th className={TH}>Descargas</th>
                      <th className={TH}>
                        <span className="sr-only">Acciones</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.cfdis.map((c) => {
                      const zona = porId.get(c.sucursalId)?.zonaHoraria;
                      const fh = zona ? fechaHoraEn(zona, c.emitidoAt) : null;
                      return (
                        <tr key={c.id} className="border-t border-linea">
                          <td className="px-2 py-1 whitespace-nowrap">
                            {c.serieFolio}
                            {c.origen === 'manual' && (
                              <span
                                className="ml-1 rounded border border-linea-fuerte px-1 text-xs text-tinta-suave"
                                title="Factura sin ticket, capturada a mano (F2-107)."
                              >
                                Manual
                              </span>
                            )}
                            {c.origen === 'global' && (
                              <span
                                className="ml-1 rounded border border-linea-fuerte px-1 text-xs text-tinta-suave"
                                title="Factura global a público en general de los tickets que nadie facturó (F2-108)."
                              >
                                Global
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1 font-mono text-xs">{c.uuid}</td>
                          <td className="px-2 py-1 whitespace-nowrap">
                            {fh ? `${fechaParaTabla(fh.fecha)} ${fh.hora}` : 'Sin dato'}
                          </td>
                          <td className="px-2 py-1">{c.sucursal}</td>
                          <td className="px-2 py-1">
                            <div>{c.receptorRfc}</div>
                            <div className="text-xs text-tinta-tenue">{c.receptorNombre}</div>
                          </td>
                          <td className={NUM}>{pesos(c.total)}</td>
                          <td className="px-2 py-1">
                            <EstadoFila c={c} />
                          </td>
                          <td className="px-2 py-1">{c.folioTicket ?? '—'}</td>
                          <td className="px-2 py-1 whitespace-nowrap">
                            {c.xml || c.pdf ? (
                              <span className="flex gap-1">
                                {c.xml && (
                                  <button
                                    type="button"
                                    className={BOTON}
                                    onClick={() => void descargarArchivo(c, 'xml')}
                                  >
                                    XML
                                  </button>
                                )}
                                {c.pdf && (
                                  <button
                                    type="button"
                                    className={BOTON}
                                    onClick={() => void descargarArchivo(c, 'pdf')}
                                  >
                                    PDF
                                  </button>
                                )}
                              </span>
                            ) : (
                              <span
                                className="text-xs text-tinta-tenue"
                                title="Los archivos no se guardaron al timbrar; se pueden recuperar del PAC (F2-110)."
                              >
                                Sin archivos
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1 whitespace-nowrap">
                            {/* Una global no se refactura: su receptor es público en general. */}
                            {c.estado === 'vigente' &&
                              c.origen !== 'global' &&
                              (c.sustituidoPor === null || c.sustitucionPendiente) && (
                                <button
                                  type="button"
                                  className={BOTON}
                                  onClick={() => setRefacturando(c)}
                                >
                                  {c.sustitucionPendiente ? 'Reintentar cancelación' : 'Refacturar'}
                                </button>
                              )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Paginador pagina={pagina} total={p.total} onPagina={setPagina} />
            </>
          )
        }
      </SegunEstado>
      {refacturando && (
        <DialogoRefacturar cfdi={refacturando} onCerrar={() => setRefacturando(null)} />
      )}
    </Tarjeta>
  );
}

const corto = (uuid: string) => uuid.slice(0, 8);

/**
 * El estado de una factura en la tabla, con la sustitución (F2-107): a quién sustituye, quién la
 * sustituye, y si su cancelación 01 sigue pendiente (entonces NO suma a lo facturado).
 */
function EstadoFila({ c }: { c: CfdiFila }) {
  return (
    <div className="flex flex-col">
      {c.estado === 'vigente' ? (
        <span>Vigente</span>
      ) : (
        <span className="text-peligro">
          Cancelada{c.motivoCancelacion ? ` (motivo ${c.motivoCancelacion})` : ''}
        </span>
      )}
      {c.sustituyeA && (
        <span className="text-xs text-tinta-tenue" title={c.sustituyeA}>
          Sustituye a {corto(c.sustituyeA)}…
        </span>
      )}
      {c.sustituidoPor && (
        <span className="text-xs text-tinta-tenue" title={c.sustituidoPor}>
          Sustituida por {corto(c.sustituidoPor)}…
        </span>
      )}
      {c.sustitucionPendiente && (
        <span className="text-xs text-peligro">Cancelación pendiente: no suma a lo facturado</span>
      )}
    </div>
  );
}

function PorFacturar({
  filtro,
  rango,
  sucursales,
}: {
  filtro: Filtro | null;
  rango: Rango;
  sucursales: readonly Sucursal[];
}) {
  const [pagina, setPagina] = useState(1);
  const consulta = usePorFacturar(filtro, rango, pagina);
  const zonas = new Map(sucursales.map((s) => [s.id, s.zonaHoraria]));
  return (
    <Tarjeta titulo="Por facturar">
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={3} />}>
        {(p) =>
          p.total === 0 ? (
            <Vacio>
              Ningún ticket del periodo tiene un código de facturación vigente sin factura.
            </Vacio>
          ) : (
            <>
              <p className="text-sm text-tinta-suave">
                {p.total} tickets por {pesos(p.monto)} todavía se pueden facturar con su código.
              </p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm" data-testid="tabla-por-facturar">
                  <thead className="text-tinta-tenue">
                    <tr>
                      <th className={TH}>Ticket</th>
                      <th className={TH}>Sucursal</th>
                      <th className={TH}>Cierre</th>
                      <th className={`${NUM} font-medium`}>Total</th>
                      <th className={TH}>Código</th>
                      <th className={TH}>Vence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.cuentas.map((c) => {
                      const zona = zonas.get(c.sucursalId);
                      const cierre = zona ? fechaHoraEn(zona, c.cerradoAt) : null;
                      const vence = zona ? fechaHoraEn(zona, c.expiraAt) : null;
                      return (
                        <tr key={c.chequeId} className="border-t border-linea">
                          <td className="px-2 py-1">{c.folio}</td>
                          <td className="px-2 py-1">{c.sucursal}</td>
                          <td className="px-2 py-1 whitespace-nowrap">
                            {cierre ? `${fechaParaTabla(cierre.fecha)} ${cierre.hora}` : 'Sin dato'}
                          </td>
                          <td className={NUM}>{pesos(c.total)}</td>
                          <td className="px-2 py-1 font-mono">{c.codigo}</td>
                          <td className="px-2 py-1 whitespace-nowrap">
                            {vence ? `${fechaParaTabla(vence.fecha)} ${vence.hora}` : 'Sin dato'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Paginador pagina={pagina} total={p.total} onPagina={setPagina} />
            </>
          )
        }
      </SegunEstado>
    </Tarjeta>
  );
}

function EnviosPendientes({ empresaId }: { empresaId: string | null }) {
  const queryClient = useQueryClient();
  const consulta = useEnviosPendientes(empresaId);
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  async function reintentar(cfdiId: string, serieFolio: string) {
    setEnCurso(cfdiId);
    setAviso(null);
    try {
      const r = await reintentarEnvio(cfdiId);
      setAviso(
        r.estado === 'enviado'
          ? { tipo: 'ok', texto: `La factura ${serieFolio} se envió a ${r.email}.` }
          : {
              tipo: 'error',
              texto: `El correo de ${serieFolio} volvió a fallar: ${r.error ?? ''}`,
            },
      );
    } catch (e) {
      setAviso({ tipo: 'error', texto: mensajeDe(e) });
    } finally {
      setEnCurso(null);
      await queryClient.invalidateQueries({ queryKey: [...LLAVE_TABLERO, 'envios'] });
    }
  }

  return (
    <Tarjeta titulo="Correos por reenviar">
      {aviso && (
        <p
          role={aviso.tipo === 'error' ? 'alert' : 'status'}
          className={`mb-2 text-sm ${aviso.tipo === 'error' ? 'text-peligro' : 'text-exito'}`}
        >
          {aviso.texto}
        </p>
      )}
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={2} />}>
        {(envios) =>
          envios.length === 0 ? (
            <Vacio>Todas las facturas se entregaron por correo: no hay nada que reenviar.</Vacio>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="envios-pendientes">
              {envios.map((e) => (
                <li
                  key={`${e.cfdiId}-${e.email}`}
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-linea pt-2 text-sm"
                >
                  <div className="min-w-0">
                    <div>
                      {e.serieFolio} → {e.email}{' '}
                      <span className="text-tinta-tenue">
                        ({e.estado === 'fallido' ? 'falló' : 'atorado'}, {e.intentos}{' '}
                        {e.intentos === 1 ? 'intento' : 'intentos'})
                      </span>
                    </div>
                    {e.error && <div className="text-xs text-tinta-tenue">{e.error}</div>}
                  </div>
                  <button
                    type="button"
                    className={BOTON}
                    disabled={enCurso !== null}
                    onClick={() => void reintentar(e.cfdiId, e.serieFolio)}
                  >
                    {enCurso === e.cfdiId ? 'Reenviando…' : 'Reenviar'}
                  </button>
                </li>
              ))}
            </ul>
          )
        }
      </SegunEstado>
    </Tarjeta>
  );
}
