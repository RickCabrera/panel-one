import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';

import { useFiltroAlcance } from '../alertas/consultas';
import { ErrorApi } from '../api/cliente';
import type { DetalleProducto, SincronizacionSucursal } from '../api/tipos';
import { useUsuario } from '../auth/contexto';
import { ROLES_ADMIN } from '../auth/roles';
import { useAlcance } from '../filtros/alcance';
import { queryVista } from '../filtros/vista';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from './inicio/Tarjeta';
import {
  api,
  useProducto,
  useProductos,
  useSincronizacion,
  type EstadoProductos,
} from './productos/consultas';
import { estadoProducto, precioTexto } from './productos/textos';
import { fechaHoraEn, fechaParaTabla } from './tickets/formato';
import { Vista } from './Vista';

const ZONA_POR_DEFECTO = 'America/Mexico_City';

function cuando(instante: string, zona: string): string {
  const { fecha, hora } = fechaHoraEn(zona, instante);
  return `${fechaParaTabla(fecha)} ${hora}`;
}

const ESTADOS: { valor: EstadoProductos; texto: string }[] = [
  { valor: 'todos', texto: 'Todos' },
  { valor: 'activos', texto: 'Los que están en el POS' },
  { valor: 'inactivos', texto: 'Los que ya no aparecen' },
];

/**
 * Productos (F2-145): el catálogo que el agente lee del POS de cada sucursal, con su precio
 * y su estado. Nada del POS se edita aquí; la metadata (foto, descripción, etiquetas,
 * mínimo/máximo) es nuestra y la editan los administradores.
 */
export function Productos() {
  const filtro = useFiltroAlcance();
  const { sucursales } = useAlcance();
  const usuario = useUsuario();
  const [parametros] = useSearchParams();
  const esAdmin = ROLES_ADMIN.includes(usuario.rol);
  const [estado, setEstado] = useState<EstadoProductos>('todos');
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const [pagina, setPagina] = useState(1);
  const [elegido, setElegido] = useState<string | null>(null);
  // Otro alcance: primera página y sin ficha abierta (el producto sería de otra sucursal).
  const llaveAlcance = `${filtro?.empresaId ?? ''}|${filtro?.sucursalId ?? ''}`;
  const [alcancePrevio, setAlcancePrevio] = useState(llaveAlcance);
  if (alcancePrevio !== llaveAlcance) {
    setAlcancePrevio(llaveAlcance);
    setPagina(1);
    setElegido(null);
  }

  const productos = useProductos(filtro, estado, q, pagina);
  const sincronizacion = useSincronizacion(filtro?.empresaId);
  const zonas = new Map((sucursales.data ?? []).map((s) => [s.id, s.zonaHoraria]));
  const zonaDe = (sucursalId: string) => zonas.get(sucursalId) ?? ZONA_POR_DEFECTO;
  const conFiltros = estado !== 'todos' || q !== '';

  const buscar = (e: FormEvent) => {
    e.preventDefault();
    setQ(texto.trim());
    setPagina(1);
  };

  const sincronizadas = (sincronizacion.data ?? []).filter(
    (s) =>
      (!filtro?.sucursalId || s.sucursalId === filtro.sucursalId) &&
      s.catalogos.some((c) => c.catalogo === 'productos' && c.ultimaCompletaAt !== null),
  );

  return (
    <Vista titulo="Productos">
      <p className="mb-4 text-sm text-tinta-tenue">
        El catálogo tal como lo tiene el POS de cada sucursal: nombre, grupo, precio y si sigue
        vigente. Aquí no se cambia nada del POS; el precio se muestra como lo reporta el POS. Para
        comparar precios entre sucursales, abre el{' '}
        <Link
          to={{ pathname: '/menu', search: queryVista(parametros) }}
          className="text-acento-texto underline-offset-2 hover:underline"
        >
          orquestador de menú
        </Link>
        .
      </p>

      <EstadoSincronizacion
        consulta={sincronizacion}
        sucursalId={filtro?.sucursalId}
        empresaId={filtro?.empresaId}
        esAdmin={esAdmin}
        zonaDe={zonaDe}
      />

      <Tarjeta titulo="Catálogo" className="mt-4">
        <form className="mb-3 flex flex-wrap items-end gap-3 text-sm" onSubmit={buscar}>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-tinta-suave">Estado</span>
            <select
              className="rounded-md border border-linea-fuerte bg-superficie px-2 py-1"
              value={estado}
              onChange={(e) => {
                setEstado(e.target.value as EstadoProductos);
                setPagina(1);
              }}
            >
              {ESTADOS.map((x) => (
                <option key={x.valor} value={x.valor}>
                  {x.texto}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
            <span className="text-xs text-tinta-suave">Buscar por nombre o clave</span>
            <input
              type="search"
              maxLength={100}
              className="rounded-md border border-linea-fuerte bg-superficie px-2 py-1"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className="rounded-md border border-linea-fuerte px-3 py-1 hover:bg-realce"
          >
            Buscar
          </button>
        </form>

        <SegunEstado consulta={productos} esqueleto={<Esqueleto lineas={5} />}>
          {(p) =>
            p.total === 0 ? (
              <Vacio>
                {conFiltros
                  ? 'Ningún producto coincide con el estado y la búsqueda elegidos.'
                  : sincronizadas.length === 0
                    ? 'Todavía no hay catálogo de productos: el agente de la sucursal no ha enviado su primera sincronización. Hace falta el agente instalado y conectado, con la lectura de catálogos del POS.'
                    : 'El catálogo sincronizado no tiene productos.'}
              </Vacio>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-0 text-left text-sm" data-testid="productos-tabla">
                    <thead className="text-xs text-tinta-suave">
                      <tr>
                        <th className="py-1 pr-3 font-medium">Clave</th>
                        <th className="py-1 pr-3 font-medium">Producto</th>
                        <th className="py-1 pr-3 font-medium">Grupo</th>
                        <th className="py-1 pr-3 font-medium">Sucursal</th>
                        <th className="py-1 pr-3 text-right font-medium">Precio</th>
                        <th className="py-1 pr-3 font-medium">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-linea">
                      {p.filas.map((f) => (
                        <tr key={f.id} className={elegido === f.id ? 'bg-realce' : undefined}>
                          <td className="py-2 pr-3 whitespace-nowrap text-tinta-medio">
                            {f.clave ?? '—'}
                          </td>
                          <td className="py-2 pr-3">
                            <button
                              type="button"
                              className="text-left text-acento-texto underline-offset-2 hover:underline"
                              onClick={() => setElegido(f.id)}
                            >
                              {f.nombre}
                            </button>
                          </td>
                          <td className="py-2 pr-3">{f.grupo ?? 'Sin grupo'}</td>
                          <td className="py-2 pr-3">{f.sucursal}</td>
                          <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">
                            {precioTexto(f.precio)}
                          </td>
                          <td className="py-2 pr-3">{estadoProducto(f)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                  <button
                    type="button"
                    className="rounded-md border border-linea-fuerte px-3 py-1 hover:bg-realce disabled:opacity-50"
                    disabled={p.pagina <= 1}
                    onClick={() => setPagina(p.pagina - 1)}
                  >
                    Anterior
                  </button>
                  <span data-testid="productos-pagina">
                    Página {p.pagina} de {Math.max(1, Math.ceil(p.total / p.porPagina))} · {p.total}{' '}
                    producto{p.total === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    className="rounded-md border border-linea-fuerte px-3 py-1 hover:bg-realce disabled:opacity-50"
                    disabled={p.pagina * p.porPagina >= p.total}
                    onClick={() => setPagina(p.pagina + 1)}
                  >
                    Siguiente
                  </button>
                </div>
              </>
            )
          }
        </SegunEstado>
      </Tarjeta>

      {elegido !== null && filtro !== null && (
        <Ficha
          key={elegido}
          empresaId={filtro.empresaId}
          id={elegido}
          esAdmin={esAdmin}
          zonaDe={zonaDe}
          onCerrar={() => setElegido(null)}
        />
      )}
    </Vista>
  );
}

function EstadoSincronizacion({
  consulta,
  empresaId,
  sucursalId,
  esAdmin,
  zonaDe,
}: {
  consulta: ReturnType<typeof useSincronizacion>;
  empresaId: string | undefined;
  sucursalId: string | undefined;
  esAdmin: boolean;
  zonaDe: (sucursalId: string) => string;
}) {
  const cliente = useQueryClient();
  const [enviando, setEnviando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pedir = async (s: SincronizacionSucursal) => {
    if (!empresaId) return;
    setEnviando(s.sucursalId);
    setError(null);
    try {
      await api.pedirSincronizacion(empresaId, s.sucursalId);
      await cliente.invalidateQueries({ queryKey: ['catalogos', 'sincronizacion', empresaId] });
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No se pudo pedir la sincronización.');
    } finally {
      setEnviando(null);
    }
  };

  return (
    <Tarjeta titulo="Sincronización del catálogo">
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={2} />}>
        {(todas) => {
          const filas = todas.filter((s) => !sucursalId || s.sucursalId === sucursalId);
          if (filas.length === 0) return <Vacio>Esta empresa todavía no tiene sucursales.</Vacio>;
          return (
            <ul className="divide-y divide-linea text-sm" data-testid="sincronizacion">
              {filas.map((s) => {
                const productos = s.catalogos.find((c) => c.catalogo === 'productos');
                return (
                  <li
                    key={s.sucursalId}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                  >
                    <span className="font-medium">{s.sucursal}</span>
                    <span className="min-w-0 flex-1 basis-56 text-tinta-medio">
                      {productos?.ultimaCompletaAt
                        ? `Última sincronización completa: ${cuando(productos.ultimaCompletaAt, zonaDe(s.sucursalId))} · ${productos.total ?? 0} productos`
                        : 'Nunca ha sincronizado su catálogo de productos.'}
                      {s.solicitud.pendiente &&
                        ' · Sincronización pedida; el agente la hace en su siguiente ciclo.'}
                    </span>
                    {esAdmin && (
                      <button
                        type="button"
                        className="rounded-md border border-linea-fuerte px-3 py-1 hover:bg-realce disabled:opacity-50"
                        disabled={enviando !== null}
                        onClick={() => void pedir(s)}
                      >
                        {enviando === s.sucursalId ? 'Pidiendo…' : 'Pedir sincronización'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          );
        }}
      </SegunEstado>
      {error && (
        <p role="alert" className="mt-2 text-sm text-peligro">
          {error}
        </p>
      )}
    </Tarjeta>
  );
}

function Ficha({
  empresaId,
  id,
  esAdmin,
  zonaDe,
  onCerrar,
}: {
  empresaId: string;
  id: string;
  esAdmin: boolean;
  zonaDe: (sucursalId: string) => string;
  onCerrar: () => void;
}) {
  const detalle = useProducto(empresaId, id);
  return (
    <Tarjeta titulo="Ficha del producto" className="mt-4">
      <SegunEstado consulta={detalle} esqueleto={<Esqueleto lineas={4} />}>
        {(d) => (
          <div className="text-sm" data-testid="ficha-producto">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h3 className="text-base font-semibold">{d.nombre}</h3>
              <span className="text-tinta-medio">
                {d.clave ?? 'Sin clave'} · {d.sucursal} · {d.grupo ?? 'Sin grupo'}
              </span>
              <button
                type="button"
                className="ml-auto rounded-md border border-linea-fuerte px-3 py-1 hover:bg-realce"
                onClick={onCerrar}
              >
                Cerrar
              </button>
            </div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-tinta-suave">Precio en el POS</dt>
              <dd>{precioTexto(d.precio)}</dd>
              <dt className="text-tinta-suave">Estado</dt>
              <dd>{estadoProducto(d)}</dd>
              <dt className="text-tinta-suave">Visto por última vez</dt>
              <dd>{cuando(d.vistoAt, zonaDe(d.sucursalId))}</dd>
            </dl>
            <h4 className="mt-4 font-medium">Datos propios</h4>
            <p className="text-xs text-tinta-tenue">
              Son nuestros, no del POS: ninguna sincronización los cambia. Por ahora son de este
              producto en esta sucursal.
            </p>
            {esAdmin ? (
              <FormularioMetadata empresaId={empresaId} detalle={d} />
            ) : d.metadata ? (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-tinta-suave">Descripción</dt>
                <dd>{d.metadata.descripcion ?? '—'}</dd>
                <dt className="text-tinta-suave">Etiquetas</dt>
                <dd>{d.metadata.etiquetas.join(', ') || '—'}</dd>
                <dt className="text-tinta-suave">Mínimo / máximo</dt>
                <dd>
                  {d.metadata.minimo ?? '—'} / {d.metadata.maximo ?? '—'}
                </dd>
              </dl>
            ) : (
              <p className="mt-2 text-tinta-medio">Sin datos propios todavía.</p>
            )}
          </div>
        )}
      </SegunEstado>
    </Tarjeta>
  );
}

const vacioANulo = (s: string) => (s.trim() === '' ? null : s.trim());

function FormularioMetadata({
  empresaId,
  detalle,
}: {
  empresaId: string;
  detalle: DetalleProducto;
}) {
  const cliente = useQueryClient();
  const m = detalle.metadata;
  const [descripcion, setDescripcion] = useState(m?.descripcion ?? '');
  const [fotoUrl, setFotoUrl] = useState(m?.fotoUrl ?? '');
  const [etiquetas, setEtiquetas] = useState(m?.etiquetas.join(', ') ?? '');
  const [minimo, setMinimo] = useState(m?.minimo ?? '');
  const [maximo, setMaximo] = useState(m?.maximo ?? '');
  const [estado, setEstado] = useState<'listo' | 'guardando' | 'guardado'>('listo');
  const [error, setError] = useState<string | null>(null);

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    setEstado('guardando');
    setError(null);
    try {
      const nuevo = await api.guardarMetadata(detalle.id, {
        empresaId,
        descripcion: vacioANulo(descripcion),
        fotoUrl: vacioANulo(fotoUrl),
        etiquetas: etiquetas
          .split(',')
          .map((x) => x.trim())
          .filter((x) => x !== ''),
        minimo: vacioANulo(minimo),
        maximo: vacioANulo(maximo),
      });
      cliente.setQueryData(['catalogos', 'producto', empresaId, detalle.id], nuevo);
      await cliente.invalidateQueries({ queryKey: ['catalogos', 'productos'] });
      setEstado('guardado');
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudieron guardar los datos.');
      setEstado('listo');
    }
  };

  const campo = 'rounded-md border border-linea-fuerte bg-superficie px-2 py-1';
  return (
    <form className="mt-2 grid gap-3 sm:grid-cols-2" onSubmit={guardar}>
      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className="text-xs text-tinta-suave">Descripción</span>
        <textarea
          className={campo}
          maxLength={2000}
          rows={2}
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-tinta-suave">Foto (URL https)</span>
        <input
          type="url"
          className={campo}
          maxLength={500}
          value={fotoUrl}
          onChange={(e) => setFotoUrl(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-tinta-suave">Etiquetas (separadas por coma)</span>
        <input className={campo} value={etiquetas} onChange={(e) => setEtiquetas(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-tinta-suave">Existencia mínima</span>
        <input
          inputMode="decimal"
          className={campo}
          value={minimo}
          onChange={(e) => setMinimo(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-tinta-suave">Existencia máxima</span>
        <input
          inputMode="decimal"
          className={campo}
          value={maximo}
          onChange={(e) => setMaximo(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button
          type="submit"
          className="rounded-md bg-acento px-3 py-1 text-sm font-medium text-acento-contraste disabled:opacity-50"
          disabled={estado === 'guardando'}
        >
          {estado === 'guardando' ? 'Guardando…' : 'Guardar datos propios'}
        </button>
        {estado === 'guardado' && <span className="text-sm text-tinta-medio">Guardado.</span>}
        {error && (
          <span role="alert" className="text-sm text-peligro">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
