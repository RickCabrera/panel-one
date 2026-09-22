import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { useFiltroAlcance } from '../alertas/consultas';
import { ErrorApi } from '../api/cliente';
import type { Existencias as DatosExistencias, FilaExistencia } from '../api/tipos';
import { useUsuario } from '../auth/contexto';
import { ROLES_ADMIN } from '../auth/roles';
import { pesos } from '../dinero/dinero';
import { Paginador } from './analisis/Bloques';
import { guardarLimites, llaveExistencias, useExistencias } from './existencias/consultas';
import {
  almacenesAtrasados,
  COLOR_ESTADO,
  filtrarPorEstado,
  horaLectura,
  leerValorAlmacen,
  nombreAlmacen,
  nombreInsumo,
  sucursalesSinLectura,
  TEXTO_ESTADO,
  vacio,
  vacioANulo,
  valorAlmacen,
  type FiltroEstado,
} from './existencias/reglas';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from './inicio/Tarjeta';
import { cantidad } from './tickets/formato';
import { Vista } from './Vista';

const POR_PAGINA = 50;
const TH = 'px-2 py-1 font-medium';
const TD = 'px-2 py-2';
const NUM = 'px-2 py-2 text-right tabular-nums whitespace-nowrap';
const BOTON =
  'rounded-md border border-linea-fuerte bg-superficie px-3 py-1 text-sm text-tinta-medio hover:bg-realce disabled:opacity-50';
const CONTROL =
  'min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-1 text-sm focus:border-acento-borde focus:outline-none disabled:opacity-50';

const cant = (v: string | null) => (v === null ? '—' : cantidad(v));

/**
 * Existencias (F2-121): lo que hay en cada almacén según la última lectura del POS, con su
 * costo promedio, su valor y su semáforo contra el mínimo y el máximo, que son NUESTROS (se
 * editan aquí y nunca se escriben a SoftRestaurant). Si no hay lectura, lo dice y explica qué
 * falta; nunca pinta $0.00.
 */
export function Existencias() {
  const filtro = useFiltroAlcance();
  const usuario = useUsuario();
  const esAdmin = ROLES_ADMIN.includes(usuario.rol);
  // La búsqueda NO va a la URL del navegador (historial, referer).
  const [q, setQ] = useState('');
  const [almacenElegido, setAlmacenElegido] = useState('');
  const [estado, setEstado] = useState<FiltroEstado>('todos');
  const [pagina, setPagina] = useState(1);
  const llave = `${filtro?.empresaId ?? ''}|${filtro?.sucursalId ?? ''}`;
  const [llavePrevia, setLlavePrevia] = useState(llave);
  if (llavePrevia !== llave) {
    setLlavePrevia(llave);
    setAlmacenElegido('');
    setEstado('todos');
    setPagina(1);
  }
  const almacen = leerValorAlmacen(almacenElegido);
  // Un almacén es de UNA sucursal: elegirlo acota la consulta a ella.
  const filtroConsulta = filtro && almacen ? { ...filtro, sucursalId: almacen.sucursalId } : filtro;
  const consulta = useExistencias(filtroConsulta, almacen?.almacenOrigenSrId ?? null, q);

  return (
    <Vista titulo="Existencias">
      <p className="mb-4 text-sm text-tinta-tenue">
        Lo que hay en cada almacén según la última lectura del POS, valuado a su costo promedio. El
        mínimo y el máximo de cada artículo los defines aquí: son del panel y nunca se escriben en
        SoftRestaurant.
      </p>
      {filtro === null ? (
        <Tarjeta titulo="Existencias">
          <Esqueleto lineas={4} />
        </Tarjeta>
      ) : (
        <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={6} />}>
          {(r) => {
            const v = vacio(r);
            if (v.tipo === 'sin-lectura') {
              return (
                <Tarjeta titulo="Existencias">
                  <div className="space-y-2 text-sm" data-testid="existencias-vacio">
                    <p>{v.porque}</p>
                    <p className="text-tinta-medio">{v.falta}</p>
                  </div>
                </Tarjeta>
              );
            }
            const filas = filtrarPorEstado(r.filas, estado);
            const paginas = Math.max(1, Math.ceil(filas.length / POR_PAGINA));
            const actual = Math.min(pagina, paginas);
            return (
              <>
                <Kpis
                  r={r}
                  estado={estado}
                  elegir={(e) => {
                    setEstado(e);
                    setPagina(1);
                  }}
                />
                <Avisos r={r} />
                <Tarjeta titulo="Artículos" className="mt-4">
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                    <Busqueda
                      inicial={q}
                      buscar={(t) => {
                        setQ(t.trim().slice(0, 100));
                        setPagina(1);
                      }}
                    />
                    <label className="flex flex-wrap items-center gap-2 text-sm text-tinta-suave">
                      Almacén
                      <select
                        className={CONTROL}
                        value={almacenElegido}
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
                  </div>
                  {filas.length === 0 ? (
                    <Vacio>
                      {r.filas.length === 0
                        ? q
                          ? 'Ningún artículo coincide con la búsqueda.'
                          : 'Este almacén no tiene artículos en su última lectura.'
                        : `Ningún artículo está en "${estado === 'todos' ? '' : TEXTO_ESTADO[estado]}".`}
                    </Vacio>
                  ) : (
                    <Tabla
                      filas={filas.slice((actual - 1) * POR_PAGINA, actual * POR_PAGINA)}
                      empresaId={filtro.empresaId}
                      editable={esAdmin}
                      variasSucursales={r.sucursales.length > 1}
                    />
                  )}
                  {!esAdmin && (
                    <p className="mt-2 text-sm text-tinta-tenue">
                      Sólo un administrador puede cambiar el mínimo y el máximo de un artículo.
                    </p>
                  )}
                  <Paginador
                    pagina={actual}
                    paginas={paginas}
                    total={filas.length}
                    cambiar={setPagina}
                    etiqueta="existencias"
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

function Kpis({
  r,
  estado,
  elegir,
}: {
  r: DatosExistencias;
  estado: FiltroEstado;
  elegir: (e: FiltroEstado) => void;
}) {
  const k = r.kpis;
  const tarjetas: Array<{ id: FiltroEstado; titulo: string; valor: string; nota: string }> = [
    {
      id: 'todos',
      titulo: 'Artículos visibles',
      valor: String(k.articulos),
      nota: 'Con lectura del POS',
    },
    {
      id: 'bajo_minimo',
      titulo: 'Atención requerida',
      valor: String(k.atencion),
      nota: 'Bajo su mínimo',
    },
    {
      id: 'sin_existencia',
      titulo: 'Sin existencia',
      valor: String(k.sinExistencia),
      nota: 'En cero o negativa',
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="existencias-kpis">
      <section
        aria-label="Valor estimado"
        className="min-w-0 rounded-lg border border-linea bg-superficie p-4 shadow-sm"
      >
        <h2 className="text-sm font-medium text-tinta-suave">Valor estimado</h2>
        <p className="mt-1 text-2xl font-semibold tabular-nums" data-testid="kpi-valor">
          {pesos(k.valor)}
        </p>
        <p className="text-xs text-tinta-tenue">Existencia × costo promedio</p>
      </section>
      {tarjetas.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={estado === t.id}
          onClick={() => elegir(estado === t.id ? 'todos' : t.id)}
          className={`min-w-0 rounded-lg border bg-superficie p-4 text-left shadow-sm hover:bg-realce ${
            estado === t.id ? 'border-acento-borde' : 'border-linea'
          }`}
        >
          <span className="block text-sm font-medium text-tinta-suave">{t.titulo}</span>
          <span
            className={`mt-1 block text-2xl font-semibold tabular-nums ${
              t.id === 'bajo_minimo' && k.atencion > 0
                ? 'text-aviso'
                : t.id === 'sin_existencia' && k.sinExistencia > 0
                  ? 'text-peligro'
                  : ''
            }`}
            data-testid={`kpi-${t.id}`}
          >
            {t.valor}
          </span>
          <span className="block text-xs text-tinta-tenue">{t.nota}</span>
        </button>
      ))}
      {k.sinLectura > 0 && (
        <button
          type="button"
          aria-pressed={estado === 'sin_lectura'}
          onClick={() => elegir(estado === 'sin_lectura' ? 'todos' : 'sin_lectura')}
          className="col-span-2 rounded-md border border-linea bg-superficie px-3 py-2 text-left text-sm text-tinta-medio hover:bg-realce lg:col-span-4"
        >
          {k.sinLectura === 1
            ? '1 artículo con mínimo o máximo ya no viene en la lectura de su almacén.'
            : `${k.sinLectura} artículos con mínimo o máximo ya no vienen en la lectura de su almacén.`}{' '}
          No se sabe su existencia: {estado === 'sin_lectura' ? 'mostrar todos' : 'verlos'}.
        </button>
      )}
    </div>
  );
}

/** Lecturas: cuándo se leyó cada almacén (en la zona de su sucursal), y qué falta o va atrasado. */
function Avisos({ r }: { r: DatosExistencias }) {
  const sin = sucursalesSinLectura(r);
  const atrasados = almacenesAtrasados(r);
  const zona = (id: string) => r.sucursales.find((s) => s.sucursalId === id)?.zonaHoraria;
  const leidos = r.almacenes.filter((a) => a.capturadoAt !== null);
  return (
    <div className="mt-4 space-y-2 text-sm" data-testid="existencias-lecturas">
      {sin.length > 0 && (
        <p className="rounded-md border border-aviso-borde bg-aviso-fondo px-3 py-2 text-aviso-fuerte">
          Sin lectura de existencias todavía: {sin.join(', ')}. Su agente las manda cada 30 min
          cuando tenga el lector de inventario (F2-241); no suman al valor.
        </p>
      )}
      {atrasados.length > 0 && (
        <p
          role="status"
          className="rounded-md border border-aviso-borde bg-aviso-fondo px-3 py-2 text-aviso-fuerte"
        >
          Lectura atrasada (más de 90 min sin llegar):{' '}
          {atrasados
            .map((a) => {
              const z = zona(a.sucursalId);
              const cuando = a.recibidaAt && z ? `, recibida ${horaLectura(z, a.recibidaAt)}` : '';
              return `${nombreAlmacen(a)}${cuando}`;
            })
            .join('; ')}
          . Lo que ves puede no ser lo de ahora.
        </p>
      )}
      {leidos.length > 0 && (
        <p className="text-tinta-tenue">
          Última lectura:{' '}
          {leidos
            .map((a) => {
              const z = zona(a.sucursalId);
              return `${nombreAlmacen(a)} ${z ? horaLectura(z, a.capturadoAt!) : 'sin zona'}`;
            })
            .join(' · ')}{' '}
          (hora de la sucursal).
        </p>
      )}
    </div>
  );
}

function Tabla({
  filas,
  empresaId,
  editable,
  variasSucursales,
}: {
  filas: FilaExistencia[];
  empresaId: string;
  editable: boolean;
  variasSucursales: boolean;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const llave = (f: FilaExistencia) =>
    JSON.stringify([f.sucursalId, f.almacenOrigenSrId, f.insumoOrigenSrId]);
  const columnas = 8 + (variasSucursales ? 1 : 0) + (editable ? 1 : 0);
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full min-w-max text-sm">
        <thead className="text-left text-tinta-tenue">
          <tr>
            <th scope="col" className={TH}>
              Artículo
            </th>
            {variasSucursales && (
              <th scope="col" className={TH}>
                Sucursal
              </th>
            )}
            <th scope="col" className={TH}>
              Almacén
            </th>
            <th scope="col" className={TH}>
              Unidad
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Existencia
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Costo prom.
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Valor
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Mín / Máx
            </th>
            <th scope="col" className={TH}>
              Estado
            </th>
            {editable && (
              <th scope="col" className={TH}>
                <span className="sr-only">Acciones</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            const k = llave(f);
            return (
              <FilaTabla
                key={k}
                f={f}
                variasSucursales={variasSucursales}
                editable={editable}
                abierta={editando === k}
                abrir={() => setEditando(editando === k ? null : k)}
                cerrar={() => setEditando(null)}
                empresaId={empresaId}
                columnas={columnas}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FilaTabla({
  f,
  variasSucursales,
  editable,
  abierta,
  abrir,
  cerrar,
  empresaId,
  columnas,
}: {
  f: FilaExistencia;
  variasSucursales: boolean;
  editable: boolean;
  abierta: boolean;
  abrir: () => void;
  cerrar: () => void;
  empresaId: string;
  columnas: number;
}) {
  const nombre = nombreInsumo(f);
  return (
    <>
      <tr className="border-t border-linea" data-insumo={f.insumoOrigenSrId}>
        <td className={TD}>
          {nombre}
          {f.clave && <span className="ml-1 text-xs text-tinta-tenue">({f.clave})</span>}
        </td>
        {variasSucursales && <td className={TD}>{f.sucursal}</td>}
        <td className={TD}>{nombreAlmacen(f)}</td>
        <td className={TD}>{f.unidad ?? 'Sin dato'}</td>
        <td className={NUM}>{cant(f.cantidad)}</td>
        <td className={NUM}>{f.costoPromedio === null ? '—' : pesos(f.costoPromedio)}</td>
        <td className={NUM}>{f.valor === null ? '—' : pesos(f.valor)}</td>
        <td className={NUM}>
          {cant(f.minimo)} / {cant(f.maximo)}
        </td>
        <td className={TD}>
          <span className="inline-flex items-center gap-2" data-estado={f.estado}>
            <span
              aria-hidden="true"
              className={`size-2.5 rounded-full ${COLOR_ESTADO[f.estado]}`}
            />
            {TEXTO_ESTADO[f.estado]}
          </span>
        </td>
        {editable && (
          <td className={TD}>
            <button
              type="button"
              className={BOTON}
              aria-expanded={abierta}
              aria-label={`Mínimo y máximo de ${nombre}`}
              onClick={abrir}
            >
              Mín / Máx
            </button>
          </td>
        )}
      </tr>
      {editable && abierta && (
        <tr className="bg-realce">
          <td colSpan={columnas} className="px-2 py-3">
            <EditorLimites f={f} empresaId={empresaId} cerrar={cerrar} />
          </td>
        </tr>
      )}
    </>
  );
}

function EditorLimites({
  f,
  empresaId,
  cerrar,
}: {
  f: FilaExistencia;
  empresaId: string;
  cerrar: () => void;
}) {
  const cliente = useQueryClient();
  const [minimo, setMinimo] = useState(f.minimo ? cantidad(f.minimo) : '');
  const [maximo, setMaximo] = useState(f.maximo ? cantidad(f.maximo) : '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nombre = nombreInsumo(f);

  const enviar = async (min: string | null, max: string | null) => {
    setGuardando(true);
    setError(null);
    try {
      await guardarLimites(empresaId, f, min, max);
      await cliente.invalidateQueries({ queryKey: llaveExistencias });
      cerrar();
    } catch (e) {
      setError(
        `No se guardaron los límites de ${nombre}. ${e instanceof ErrorApi ? e.message : 'Error inesperado.'}`,
      );
    } finally {
      setGuardando(false);
    }
  };
  const guardar = (e: FormEvent) => {
    e.preventDefault();
    void enviar(vacioANulo(minimo), vacioANulo(maximo));
  };

  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={guardar}>
      <label className="flex flex-col text-sm text-tinta-suave">
        Mínimo{f.unidad ? ` (${f.unidad})` : ''}
        <input
          className={CONTROL}
          inputMode="decimal"
          value={minimo}
          disabled={guardando}
          onChange={(e) => setMinimo(e.target.value)}
        />
      </label>
      <label className="flex flex-col text-sm text-tinta-suave">
        Máximo{f.unidad ? ` (${f.unidad})` : ''}
        <input
          className={CONTROL}
          inputMode="decimal"
          value={maximo}
          disabled={guardando}
          onChange={(e) => setMaximo(e.target.value)}
        />
      </label>
      <button type="submit" className={BOTON} disabled={guardando}>
        Guardar
      </button>
      {(f.minimo !== null || f.maximo !== null) && (
        <button
          type="button"
          className={BOTON}
          disabled={guardando}
          onClick={() => void enviar(null, null)}
        >
          Quitar límites
        </button>
      )}
      <button type="button" className={BOTON} disabled={guardando} onClick={cerrar}>
        Cancelar
      </button>
      <p className="basis-full text-xs text-tinta-tenue">
        Sólo en el panel: no cambia nada en SoftRestaurant. Vacío = sin ese límite.
      </p>
      {error && (
        <p role="alert" className="basis-full text-sm text-peligro">
          {error}
        </p>
      )}
    </form>
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
      <label className="text-sm text-tinta-suave" htmlFor="existencias-q">
        Buscar
      </label>
      <input
        id="existencias-q"
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
