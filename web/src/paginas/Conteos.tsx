import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { useFiltroAlcance } from '../alertas/consultas';
import { ErrorApi } from '../api/cliente';
import type { Conteos as DatosConteos, EstadoConteo } from '../api/tipos';
import { useUsuario } from '../auth/contexto';
import { ROLES_ADMIN } from '../auth/roles';
import { queryVista } from '../filtros/vista';
import { crearConteo, llaveConteos, useConteos } from './conteos/consultas';
import {
  alcanceConteo,
  almacenesContables,
  avance,
  horaEn,
  nombreAlmacenConteo,
  TEXTO_ESTADO_CONTEO,
  vacioConteos,
} from './conteos/reglas';
import { valorAlmacen, leerValorAlmacen } from './existencias/reglas';
import { Esqueleto, SegunEstado, Tarjeta } from './inicio/Tarjeta';
import { Vista } from './Vista';

const TH = 'px-2 py-1 font-medium';
const TD = 'px-2 py-2';
const BOTON =
  'rounded-md border border-linea-fuerte bg-superficie px-3 py-2 text-sm text-tinta-medio hover:bg-realce disabled:opacity-50';
const CONTROL =
  'min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-2 text-sm focus:border-acento-borde focus:outline-none disabled:opacity-50';

/**
 * Conteos físicos (F2-123): la lista de conteos del alcance y el alta de uno nuevo. Un conteo es
 * del PANEL: se captura aquí y NUNCA se escribe a SoftRestaurant; su reporte de diferencias es lo
 * que el encargado lleva a SR para ajustar allá (ver la ayuda).
 */
export function Conteos() {
  const filtro = useFiltroAlcance();
  const usuario = useUsuario();
  const esAdmin = ROLES_ADMIN.includes(usuario.rol);
  const [parametros] = useSearchParams();
  const [estado, setEstado] = useState<EstadoConteo | ''>('');
  const consulta = useConteos(filtro, estado || null);

  return (
    <Vista titulo="Conteos físicos">
      <p className="mb-4 text-sm text-tinta-tenue">
        Cuenta lo que hay en un almacén y compáralo contra la última lectura del POS. El conteo vive
        en el panel: los ajustes se registran a mano en SoftRestaurant con el reporte de
        diferencias.{' '}
        <Link
          className="text-acento-texto underline"
          to={{ pathname: '/conteos/ayuda', search: queryVista(parametros) }}
        >
          Cómo se hace un conteo
        </Link>
      </p>
      {filtro === null ? (
        <Tarjeta titulo="Conteos">
          <Esqueleto lineas={4} />
        </Tarjeta>
      ) : (
        <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={6} />}>
          {(r) => {
            const v = vacioConteos(r);
            return (
              <>
                {esAdmin && almacenesContables(r).length > 0 && (
                  <NuevoConteo r={r} empresaId={filtro.empresaId} />
                )}
                {v.tipo !== 'con-datos' && estado === '' ? (
                  <Tarjeta titulo="Conteos" className="mt-4">
                    <div className="space-y-2 text-sm" data-testid="conteos-vacio">
                      <p>{v.porque}</p>
                      <p className="text-tinta-medio">{v.falta}</p>
                    </div>
                  </Tarjeta>
                ) : (
                  <Tarjeta titulo="Conteos" className="mt-4">
                    <label className="mb-3 flex items-center gap-2 text-sm text-tinta-suave">
                      Estado
                      <select
                        className={CONTROL}
                        value={estado}
                        onChange={(e) => setEstado(e.target.value as EstadoConteo | '')}
                      >
                        <option value="">Todos</option>
                        {(Object.keys(TEXTO_ESTADO_CONTEO) as EstadoConteo[]).map((e) => (
                          <option key={e} value={e}>
                            {TEXTO_ESTADO_CONTEO[e]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Lista r={r} search={queryVista(parametros)} />
                  </Tarjeta>
                )}
              </>
            );
          }}
        </SegunEstado>
      )}
    </Vista>
  );
}

function Lista({ r, search }: { r: DatosConteos; search: string }) {
  if (r.conteos.length === 0) {
    return <p className="text-sm text-tinta-suave">Ningún conteo con ese estado.</p>;
  }
  const zonaDe = new Map(r.sucursales.map((s) => [s.sucursalId, s.zonaHoraria]));
  const variasSucursales = r.sucursales.length > 1;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-tinta-suave">
          <tr>
            <th scope="col" className={TH}>
              Conteo
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
              Estado
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Contados
            </th>
            <th scope="col" className={TH}>
              Creado
            </th>
          </tr>
        </thead>
        <tbody>
          {r.conteos.map((c) => (
            <tr key={c.id} className="border-t border-linea" data-conteo={c.id}>
              <td className={TD}>
                <Link
                  className="text-acento-texto underline"
                  to={{ pathname: `/conteos/${c.id}`, search }}
                >
                  #{c.folio} · {alcanceConteo(c)}
                </Link>
                {c.nota && <span className="block text-xs text-tinta-tenue">{c.nota}</span>}
              </td>
              {variasSucursales && <td className={TD}>{c.sucursal}</td>}
              <td className={TD}>{nombreAlmacenConteo(c)}</td>
              <td className={TD}>{TEXTO_ESTADO_CONTEO[c.estado]}</td>
              <td className={`${TD} text-right tabular-nums`}>{avance(c)}</td>
              <td className={`${TD} whitespace-nowrap`}>
                {horaEn(zonaDe.get(c.sucursalId) ?? 'America/Mexico_City', c.creadoAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.total > r.conteos.length && (
        <p className="mt-2 text-xs text-tinta-tenue">
          Se muestran los {r.conteos.length} más recientes de {r.total}.
        </p>
      )}
    </div>
  );
}

function NuevoConteo({ r, empresaId }: { r: DatosConteos; empresaId: string }) {
  const queryClient = useQueryClient();
  const navegar = useNavigate();
  const [parametros] = useSearchParams();
  const almacenes = almacenesContables(r);
  const [almacen, setAlmacen] = useState(valorAlmacen(almacenes[0]));
  const [grupo, setGrupo] = useState('');
  const [nota, setNota] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const elegido = leerValorAlmacen(almacen);
  const grupos = r.grupos.filter((g) => g.sucursalId === elegido?.sucursalId);
  const variasSucursales = r.sucursales.length > 1;
  const sinLectura = r.almacenes.filter((a) => a.capturadoAt === null);
  const detalleAlmacen = r.almacenes.find(
    (a) =>
      a.sucursalId === elegido?.sucursalId && a.almacenOrigenSrId === elegido?.almacenOrigenSrId,
  );
  const zona =
    r.sucursales.find((s) => s.sucursalId === elegido?.sucursalId)?.zonaHoraria ??
    'America/Mexico_City';

  async function crear(e: FormEvent) {
    e.preventDefault();
    if (!elegido) return;
    setEnviando(true);
    setError(null);
    try {
      const d = await crearConteo({
        empresaId,
        sucursalId: elegido.sucursalId,
        almacenOrigenSrId: elegido.almacenOrigenSrId,
        ...(grupo ? { grupoOrigenSrId: grupo } : {}),
        ...(nota.trim() ? { nota: nota.trim().slice(0, 200) } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: llaveConteos });
      navegar({ pathname: `/conteos/${d.conteo.id}`, search: queryVista(parametros) });
    } catch (err) {
      setError(
        err instanceof ErrorApi && err.status === 409
          ? 'Ese almacén todavía no tiene lectura de existencias: no hay contra qué comparar.'
          : err instanceof ErrorApi && err.status === 400
            ? 'No hay artículos que contar con ese almacén y grupo.'
            : 'No se pudo crear el conteo. Intenta de nuevo.',
      );
      setEnviando(false);
    }
  }

  return (
    <Tarjeta titulo="Nuevo conteo">
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => void crear(e)}>
        <label className="flex min-w-0 flex-col gap-1 text-sm text-tinta-suave">
          Almacén
          <select
            className={CONTROL}
            value={almacen}
            onChange={(e) => {
              setAlmacen(e.target.value);
              setGrupo('');
            }}
          >
            {almacenes.map((a) => (
              <option key={valorAlmacen(a)} value={valorAlmacen(a)}>
                {nombreAlmacenConteo(a)}
                {variasSucursales
                  ? ` · ${r.sucursales.find((s) => s.sucursalId === a.sucursalId)?.sucursal ?? ''}`
                  : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm text-tinta-suave">
          Artículos
          <select className={CONTROL} value={grupo} onChange={(e) => setGrupo(e.target.value)}>
            <option value="">Todos los del almacén</option>
            {grupos.map((g) => (
              <option key={g.grupoOrigenSrId} value={g.grupoOrigenSrId}>
                Grupo {g.grupo}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-tinta-suave">
          Nota (opcional)
          <input
            className={CONTROL}
            value={nota}
            maxLength={200}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Quién cuenta, turno…"
          />
        </label>
        <button type="submit" className={BOTON} disabled={enviando || !elegido}>
          {enviando ? 'Creando…' : 'Crear conteo'}
        </button>
      </form>
      {detalleAlmacen?.capturadoAt && (
        <p className="mt-2 text-xs text-tinta-tenue" data-testid="conteo-teorico">
          El teórico será la lectura del {horaEn(zona, detalleAlmacen.capturadoAt)}
          {detalleAlmacen.atrasada ? ' (lectura atrasada: puede no reflejar lo último).' : '.'}
        </p>
      )}
      {sinLectura.length > 0 && (
        <p className="mt-1 text-xs text-tinta-tenue">
          Sin lectura de existencias (no se pueden contar todavía):{' '}
          {sinLectura.map((a) => nombreAlmacenConteo(a)).join(', ')}.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-peligro">
          {error}
        </p>
      )}
    </Tarjeta>
  );
}
