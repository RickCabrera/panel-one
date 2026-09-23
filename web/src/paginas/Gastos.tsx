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

import { useFiltroAlcance } from '../alertas/consultas';
import { ErrorApi } from '../api/cliente';
import type {
  CategoriaGasto,
  EstadoResultados,
  EstadoResultadosBase,
  Gasto,
  Gastos as DatosGastos,
} from '../api/tipos';
import { useUsuario } from '../auth/contexto';
import { ROLES_ADMIN } from '../auth/roles';
import { descargar, ErrorCsv, nombreCsv } from '../csv/csv';
import { pesos, pesosCompactos } from '../dinero/dinero';
import { useAlcance } from '../filtros/alcance';
import { hoyEn } from '../filtros/periodo';
import { usePeriodo } from '../filtros/usePeriodo';
import { useTema } from '../tema/contexto';
import {
  anularGasto,
  cambiarCategoria,
  crearCategoria,
  crearGasto,
  editarGasto,
  LLAVE_FINANZAS,
  useCategoriasGasto,
  useEstadoResultados,
  useGastos,
} from './finanzas/consultas';
import {
  avisosEstado,
  barrasEstado,
  dineroONulo,
  erroresGasto,
  estadoACsv,
  estadoVacio,
  faltaDelCosto,
  gastosACsv,
  textoMargen,
  type FormGasto,
} from './finanzas/reglas';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from './inicio/Tarjeta';
import { fechaParaTabla } from './tickets/formato';
import { Vista } from './Vista';

const TH = 'px-2 py-1 font-medium';
const TD = 'px-2 py-2';
const NUM = 'px-2 py-2 text-right tabular-nums whitespace-nowrap';
const CONTROL =
  'min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-1 text-sm focus:border-acento-borde focus:outline-none disabled:opacity-50';
const BOTON =
  'rounded-md border border-linea-fuerte bg-superficie px-3 py-1 text-sm text-tinta-medio hover:bg-realce disabled:opacity-50';
const PRIMARIO =
  'rounded-md bg-acento px-3 py-1 text-sm font-medium text-sobre-acento disabled:opacity-50';

export const MARCA_SOBRESTIMADA = 'Costo incompleto: la utilidad real es menor.';

/**
 * Gastos y utilidad (F2-126): el estado de resultados simple del periodo (venta neta − costo de lo
 * vendido − gastos) por sucursal, con gráfica y CSV, y la captura de los gastos de operación. El
 * costo es el consumo TEÓRICO de las recetas (F2-125); si falta costo de algo, la utilidad se
 * marca sobrestimada; si no se puede calcular, se dice por qué y no se pinta $0.00.
 */
export function Gastos() {
  const filtro = useFiltroAlcance();
  const { rango } = usePeriodo();
  const estado = useEstadoResultados(filtro, rango);

  return (
    <Vista titulo="Gastos y utilidad">
      <p className="mb-4 text-sm text-tinta-tenue">
        Lo que dejó el periodo: la venta sin IVA, menos lo que costó lo vendido según las recetas de
        SoftRestaurant, menos los gastos de operación que se capturan aquí. Las compras no se restan:
        el costo ya es el consumo.
      </p>
      {rango === null ? (
        <Tarjeta titulo="Estado de resultados">
          <Vacio>El rango de fechas no es válido: corrígelo en la cabecera para consultar.</Vacio>
        </Tarjeta>
      ) : filtro === null ? (
        <Tarjeta titulo="Estado de resultados">
          <Esqueleto lineas={4} />
        </Tarjeta>
      ) : (
        <SegunEstado consulta={estado} esqueleto={<Esqueleto lineas={6} />}>
          {(e) => <Estado e={e} desde={rango.desde} hasta={rango.hasta} />}
        </SegunEstado>
      )}
      <div className="mt-4">
        <ListaGastos />
      </div>
    </Vista>
  );
}

function CeldaUtilidad({ r, testId }: { r: EstadoResultadosBase; testId: string }) {
  if (r.utilidadOperacion === null) {
    return (
      <td className={`${NUM} text-tinta-tenue`} data-testid={testId} title="Sin costo calculable">
        —
      </td>
    );
  }
  return (
    <td
      className={`${NUM} font-medium`}
      data-testid={testId}
      title={r.utilidadSobrestimada ? MARCA_SOBRESTIMADA : undefined}
    >
      {pesos(r.utilidadOperacion)}
      {r.utilidadSobrestimada && <span aria-label={MARCA_SOBRESTIMADA}> *</span>}
    </td>
  );
}

function FilaEstado({ nombre, r, total }: { nombre: string; r: EstadoResultadosBase; total?: boolean }) {
  return (
    <tr
      className={total ? 'border-t-2 border-linea-fuerte font-semibold' : 'border-t border-linea-suave'}
      data-testid={total ? 'estado-total' : `estado-${nombre}`}
    >
      <th scope="row" className={`${TD} text-left font-normal`}>
        {nombre}
      </th>
      <td className={NUM}>{pesos(r.venta)}</td>
      <td className={NUM}>{pesos(r.ventaNeta)}</td>
      <td className={NUM} title={faltaDelCosto(r.costo) ?? undefined}>
        {dineroONulo(r.costo.importe)}
      </td>
      <td className={NUM}>{dineroONulo(r.utilidadBruta)}</td>
      <td className={NUM}>{textoMargen(r.margenBruto)}</td>
      <td className={NUM}>{pesos(r.gastos)}</td>
      <CeldaUtilidad r={r} testId={total ? 'utilidad-total' : `utilidad-${nombre}`} />
      <td className={NUM}>{textoMargen(r.margenOperacion)}</td>
    </tr>
  );
}

function Estado({ e, desde, hasta }: { e: EstadoResultados; desde: string; hasta: string }) {
  const { sucursal } = useAlcance();
  const [errorCsv, setErrorCsv] = useState<string | null>(null);
  const avisos = avisosEstado(e);
  const exportar = () => {
    try {
      descargar(nombreCsv('estado-resultados', desde, hasta, sucursal?.nombre), estadoACsv(e));
      setErrorCsv(null);
    } catch (err) {
      setErrorCsv(err instanceof ErrorCsv ? err.message : 'No se pudo generar el archivo.');
    }
  };

  if (estadoVacio(e)) {
    return (
      <Tarjeta titulo="Estado de resultados">
        <Vacio>
          Sin ventas ni gastos en el periodo: no hay nada que restar. Elige otro periodo en la
          cabecera, o registra los gastos del periodo abajo.
        </Vacio>
      </Tarjeta>
    );
  }
  return (
    <>
      <Tarjeta titulo="Estado de resultados">
        {avisos.length > 0 && (
          <ul className="mb-3 space-y-1 text-sm text-aviso" data-testid="avisos-estado">
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead className="text-left text-tinta-tenue">
              <tr>
                <th scope="col" className={TH}>
                  Sucursal
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Venta con IVA
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Venta neta
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Costo de lo vendido
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Utilidad bruta
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Margen
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Gastos
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Utilidad de operación
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Margen
                </th>
              </tr>
            </thead>
            <tbody>
              {e.sucursales.map((s) => (
                <FilaEstado key={s.sucursalId} nombre={s.sucursal} r={s} />
              ))}
              {e.sucursales.length > 1 && <FilaEstado nombre="Total" r={e.total} total />}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-tinta-tenue">
          * {MARCA_SOBRESTIMADA} “—”: sin costo calculable (ver avisos). Importes sin IVA salvo
          “Venta con IVA”.
        </p>
        <p className="mt-1 text-xs text-tinta-tenue" data-testid="compras-informativo">
          Compras del periodo (leídas de SoftRestaurant): {pesos(e.total.compras)}. No se restan: el
          costo de lo vendido ya es lo que las ventas consumieron.
        </p>
        <details className="mt-2 text-sm text-tinta-medio">
          <summary className="cursor-pointer">Cómo se calcula</summary>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
            <li>
              Venta neta = subtotal de las cuentas no canceladas cerradas en el periodo (sin IVA).
              Supuesto por validar con el contador: que el subtotal de SoftRestaurant ya viene sin
              descuento y sin propina.
            </li>
            <li>
              Costo de lo vendido = lo que las ventas debieron consumir según sus recetas × el costo
              promedio de cada insumo en el periodo (el mismo cálculo de Recetas).
            </li>
            <li>Gastos = los gastos capturados en el panel con su día en el periodo, sin anulados.</li>
            <li>Utilidad bruta = venta neta − costo. Utilidad de operación = bruta − gastos.</li>
          </ul>
        </details>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={BOTON} onClick={exportar}>
            Exportar CSV
          </button>
          {errorCsv && (
            <p role="alert" className="text-sm text-peligro">
              {errorCsv}
            </p>
          )}
        </div>
      </Tarjeta>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="Por sucursal">
          <GraficaEstado e={e} />
        </Tarjeta>
        <Tarjeta titulo="Gastos por categoría">
          {e.gastosPorCategoria.length === 0 ? (
            <Vacio>Sin gastos capturados en el periodo.</Vacio>
          ) : (
            <ul className="space-y-1 text-sm" data-testid="gastos-por-categoria">
              {e.gastosPorCategoria.map((c) => (
                <li key={c.categoriaId} className="flex justify-between gap-2">
                  <span className="truncate">{c.categoria}</span>
                  <span className="tabular-nums">{pesos(c.monto)}</span>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>
    </>
  );
}

function GraficaEstado({ e }: { e: EstadoResultados }) {
  const { colores } = useTema();
  const eje = { fontSize: 11, fill: colores['tinta-tenue'] };
  const barras = barrasEstado(e);
  return (
    <div className="h-64 w-full min-w-0" data-testid="grafica-estado">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={barras} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={colores.rejilla} vertical={false} />
          <XAxis dataKey="etiqueta" tick={eje} />
          <YAxis width={52} tick={eje} tickFormatter={pesosCompactos} />
          <Tooltip
            formatter={(v) => (typeof v === 'number' ? pesosCompactos(v) : '—')}
            cursor={{ fill: colores.realce }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="ventaNeta" name="Venta neta" fill={colores['serie-1']} isAnimationActive={false} />
          <Bar dataKey="costo" name="Costo" fill={colores['serie-3']} isAnimationActive={false} />
          <Bar dataKey="gastos" name="Gastos" fill={colores['serie-4']} isAnimationActive={false} />
          <Bar
            dataKey="utilidad"
            name="Utilidad de operación"
            fill={colores['serie-2']}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Captura y lista de gastos
// ---------------------------------------------------------------------------

function mensajeError(err: unknown): string {
  if (err instanceof ErrorApi) {
    if (err.status === 404) return 'Esa sucursal, categoría o gasto ya no está en tu alcance.';
    if (err.status === 409) return err.message || 'El gasto ya no se puede cambiar.';
    return err.message || 'No se pudo guardar.';
  }
  return 'No se pudo guardar: revisa tu conexión y reintenta.';
}

function ListaGastos() {
  const filtro = useFiltroAlcance();
  const { rango } = usePeriodo();
  const usuario = useUsuario();
  const esAdmin = ROLES_ADMIN.includes(usuario.rol);
  const [incluirAnulados, setIncluirAnulados] = useState(false);
  const gastos = useGastos(filtro, rango, incluirAnulados);
  const categorias = useCategoriasGasto(filtro?.empresaId ?? null);
  const [editando, setEditando] = useState<Gasto | null>(null);

  return (
    <>
      {esAdmin && filtro && (
        <FormularioGasto
          key={editando?.id ?? 'nuevo'}
          empresaId={filtro.empresaId}
          categorias={categorias.data?.categorias ?? []}
          editando={editando}
          alTerminar={() => setEditando(null)}
        />
      )}
      <div className="mt-4">
        <Tarjeta titulo="Gastos del periodo">
          <label className="mb-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={incluirAnulados}
              onChange={(e) => setIncluirAnulados(e.target.checked)}
            />
            Mostrar los anulados
          </label>
          {rango === null || filtro === null ? (
            <Esqueleto lineas={3} />
          ) : (
            <SegunEstado consulta={gastos} esqueleto={<Esqueleto lineas={4} />}>
              {(g) => (
                <TablaGastos
                  g={g}
                  esAdmin={esAdmin}
                  empresaId={filtro.empresaId}
                  desde={rango.desde}
                  hasta={rango.hasta}
                  alEditar={setEditando}
                />
              )}
            </SegunEstado>
          )}
        </Tarjeta>
      </div>
      {esAdmin && filtro && (
        <div className="mt-4">
          <Categorias empresaId={filtro.empresaId} categorias={categorias.data?.categorias ?? []} />
        </div>
      )}
    </>
  );
}

function TablaGastos({
  g,
  esAdmin,
  empresaId,
  desde,
  hasta,
  alEditar,
}: {
  g: DatosGastos;
  esAdmin: boolean;
  empresaId: string;
  desde: string;
  hasta: string;
  alEditar: (g: Gasto) => void;
}) {
  const { sucursales, sucursal } = useAlcance();
  const cliente = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const nombre = (id: string) => sucursales.data?.find((s) => s.id === id)?.nombre ?? '';

  const anular = async (gasto: Gasto) => {
    setOcupado(gasto.id);
    try {
      await anularGasto(empresaId, gasto.id);
      setError(null);
      await cliente.invalidateQueries({ queryKey: LLAVE_FINANZAS });
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setOcupado(null);
    }
  };
  const exportar = () => {
    try {
      descargar(nombreCsv('gastos', desde, hasta, sucursal?.nombre), gastosACsv(g.gastos, nombre));
      setError(null);
    } catch (err) {
      setError(err instanceof ErrorCsv ? err.message : 'No se pudo generar el archivo.');
    }
  };

  if (g.gastos.length === 0) {
    return (
      <Vacio>
        Sin gastos en el periodo.{' '}
        {esAdmin ? 'Regístralos arriba.' : 'Un administrador los registra en esta vista.'}
      </Vacio>
    );
  }
  return (
    <>
      {error && (
        <p role="alert" className="mb-2 text-sm text-peligro">
          {error}
        </p>
      )}
      {g.truncado && (
        <p className="mb-2 text-sm text-aviso" data-testid="gastos-truncado">
          Hay más de 2000 gastos en el periodo: la lista y su CSV van recortados (los totales no).
        </p>
      )}
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-max text-sm" data-testid="tabla-gastos">
          <thead className="text-left text-tinta-tenue">
            <tr>
              <th scope="col" className={TH}>
                Día
              </th>
              <th scope="col" className={TH}>
                Sucursal
              </th>
              <th scope="col" className={TH}>
                Categoría
              </th>
              <th scope="col" className={TH}>
                Concepto
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Monto
              </th>
              {esAdmin && <th scope="col" className={TH} />}
            </tr>
          </thead>
          <tbody>
            {g.gastos.map((x) => (
              <tr
                key={x.id}
                className={`border-t border-linea-suave ${x.anulado ? 'text-tinta-tenue line-through' : ''}`}
              >
                <td className={TD}>{fechaParaTabla(x.dia)}</td>
                <td className={TD}>{nombre(x.sucursalId)}</td>
                <td className={TD}>{x.categoria}</td>
                <td className={TD}>
                  {x.concepto}
                  {x.anulado && <span className="ml-1 no-underline">(anulado)</span>}
                </td>
                <td className={NUM}>{pesos(x.monto)}</td>
                {esAdmin && (
                  <td className={`${TD} whitespace-nowrap`}>
                    {!x.anulado && (
                      <>
                        <button type="button" className={BOTON} onClick={() => alEditar(x)}>
                          Editar
                        </button>{' '}
                        <button
                          type="button"
                          className={BOTON}
                          disabled={ocupado !== null}
                          onClick={() => void anular(x)}
                        >
                          Anular
                        </button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          Total sin anulados: <span className="font-medium tabular-nums">{pesos(g.total)}</span>
        </span>
        <button type="button" className={BOTON} onClick={exportar}>
          Exportar CSV
        </button>
      </div>
    </>
  );
}

function FormularioGasto({
  empresaId,
  categorias,
  editando,
  alTerminar,
}: {
  empresaId: string;
  categorias: readonly CategoriaGasto[];
  editando: Gasto | null;
  alTerminar: () => void;
}) {
  const { sucursales, sucursal } = useAlcance();
  const cliente = useQueryClient();
  const lista = sucursales.data ?? [];
  const inicial: FormGasto = editando
    ? {
        sucursalId: editando.sucursalId,
        categoriaId: editando.categoriaId,
        dia: editando.dia,
        concepto: editando.concepto,
        monto: editando.monto,
      }
    : {
        sucursalId: sucursal?.id ?? (lista.length === 1 ? lista[0].id : ''),
        categoriaId: '',
        dia: '',
        concepto: '',
        monto: '',
      };
  const [form, setForm] = useState<FormGasto>(inicial);
  const [errores, setErrores] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState<string | null>(null);

  const zona = lista.find((s) => s.id === form.sucursalId)?.zonaHoraria;
  const hoy = zona ? hoyEn(zona, new Date()) : '9999-12-31';
  const activas = categorias.filter((c) => c.activa || c.id === form.categoriaId);
  const cambiar = (campo: keyof FormGasto) => (valor: string) =>
    setForm((f) => ({ ...f, [campo]: valor }));

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const errs = erroresGasto(form, hoy);
    setErrores(errs);
    setHecho(null);
    if (errs.length > 0 || enviando) return;
    setEnviando(true);
    try {
      const datos = {
        categoriaId: form.categoriaId,
        dia: form.dia,
        concepto: form.concepto.trim(),
        monto: form.monto.trim(),
      };
      if (editando) {
        await editarGasto(editando.id, { empresaId, ...datos });
        setHecho('Gasto actualizado.');
        alTerminar();
      } else {
        await crearGasto({ empresaId, sucursalId: form.sucursalId, ...datos });
        setHecho('Gasto registrado.');
        setForm({ ...form, concepto: '', monto: '' });
      }
      await cliente.invalidateQueries({ queryKey: LLAVE_FINANZAS });
    } catch (err) {
      setErrores([mensajeError(err)]);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Tarjeta titulo={editando ? 'Editar gasto' : 'Registrar gasto'}>
      <form className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => void enviar(e)}>
        <label className="flex min-w-0 flex-col gap-1">
          Sucursal
          <select
            className={CONTROL}
            value={form.sucursalId}
            disabled={editando !== null}
            onChange={(e) => cambiar('sucursalId')(e.target.value)}
          >
            <option value="">Elige…</option>
            {lista.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          Categoría
          <select
            className={CONTROL}
            value={form.categoriaId}
            onChange={(e) => cambiar('categoriaId')(e.target.value)}
          >
            <option value="">Elige…</option>
            {activas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          Día
          <input
            type="date"
            className={CONTROL}
            value={form.dia}
            max={zona ? hoy : undefined}
            onChange={(e) => cambiar('dia')(e.target.value)}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          Concepto
          <input
            className={CONTROL}
            value={form.concepto}
            maxLength={200}
            onChange={(e) => cambiar('concepto')(e.target.value)}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          Monto sin IVA
          <input
            className={CONTROL}
            inputMode="decimal"
            value={form.monto}
            placeholder="0.00"
            onChange={(e) => cambiar('monto')(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-5">
          <button type="submit" className={PRIMARIO} disabled={enviando}>
            {enviando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Registrar'}
          </button>
          {editando && (
            <button type="button" className={BOTON} onClick={alTerminar}>
              Cancelar
            </button>
          )}
          {hecho && (
            <span className="text-exito" role="status">
              {hecho}
            </span>
          )}
        </div>
      </form>
      {categorias.length === 0 && (
        <p className="mt-2 text-sm text-tinta-tenue">
          Todavía no hay categorías de gasto: crea la primera abajo.
        </p>
      )}
      {errores.length > 0 && (
        <ul role="alert" className="mt-2 list-disc pl-5 text-sm text-peligro">
          {errores.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}

function Categorias({
  empresaId,
  categorias,
}: {
  empresaId: string;
  categorias: readonly CategoriaGasto[];
}) {
  const cliente = useQueryClient();
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const correr = async (accion: () => Promise<unknown>) => {
    if (enviando) return;
    setEnviando(true);
    try {
      await accion();
      setError(null);
      await cliente.invalidateQueries({ queryKey: LLAVE_FINANZAS });
    } catch (err) {
      setError(
        err instanceof ErrorApi && err.status === 409
          ? 'Ya existe una categoría con ese nombre.'
          : mensajeError(err),
      );
    } finally {
      setEnviando(false);
    }
  };
  const agregar = (e: FormEvent) => {
    e.preventDefault();
    if (nombre.trim().length === 0) {
      setError('Escribe el nombre de la categoría.');
      return;
    }
    void correr(async () => {
      await crearCategoria(empresaId, nombre.trim());
      setNombre('');
    });
  };

  return (
    <Tarjeta titulo="Categorías de gasto">
      <form className="flex flex-wrap items-end gap-2 text-sm" onSubmit={agregar}>
        <label className="flex min-w-0 flex-col gap-1">
          Nueva categoría
          <input
            className={CONTROL}
            value={nombre}
            maxLength={60}
            onChange={(e) => setNombre(e.target.value)}
          />
        </label>
        <button type="submit" className={BOTON} disabled={enviando}>
          Agregar
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-peligro">
          {error}
        </p>
      )}
      {categorias.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {categorias.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <span className={c.activa ? '' : 'text-tinta-tenue'}>
                {c.nombre}
                {!c.activa && ' (inactiva)'}
              </span>
              <button
                type="button"
                className={BOTON}
                disabled={enviando}
                onClick={() => void correr(() => cambiarCategoria(empresaId, c.id, { activa: !c.activa }))}
              >
                {c.activa ? 'Desactivar' : 'Activar'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}
