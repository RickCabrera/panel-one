import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { useFiltroAlcance } from '../alertas/consultas';
import { ErrorApi } from '../api/cliente';
import type { Traspasos as DatosTraspasos } from '../api/tipos';
import { useUsuario } from '../auth/contexto';
import { ROLES_ADMIN } from '../auth/roles';
import { queryVista } from '../filtros/vista';
import { useExistencias } from './existencias/consultas';
import { leerValorAlmacen, valorAlmacen } from './existencias/reglas';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from './inicio/Tarjeta';
import { cantidad as textoCantidad } from './tickets/formato';
import { enviarTraspaso, llaveTraspasos, useTraspasos } from './traspasos/consultas';
import {
  avisoExistencia,
  destinosPosibles,
  errorCantidad,
  erroresAlta,
  nombreAlmacenTraspaso,
  puedeTraspasar,
  type RenglonCaptura,
} from './traspasos/reglas';
import { Vista } from './Vista';

const CONTROL =
  'min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-2 text-sm focus:border-acento-borde focus:outline-none disabled:opacity-50';
const BOTON =
  'rounded-md border border-linea-fuerte bg-superficie px-3 py-2 text-sm text-tinta-medio hover:bg-realce disabled:opacity-50';
const PRIMARIO =
  'rounded-md bg-acento px-3 py-2 text-sm font-medium text-sobre-acento disabled:opacity-50';

/**
 * Alta de un traspaso (F2-124): origen, destino y artículos con su cantidad. Enviarlo es la
 * PRIMERA confirmación; la recepción, la segunda. El panel no lo escribe en SoftRestaurant: se
 * registra allá también, y la sincronización lo concilia.
 */
export function TraspasoNuevo() {
  const filtro = useFiltroAlcance();
  const usuario = useUsuario();
  // Toda la empresa: el destino puede ser otra sucursal aunque la vista esté en una.
  const deLaEmpresa = filtro ? { empresaId: filtro.empresaId, sucursalId: undefined } : null;
  const consulta = useTraspasos(deLaEmpresa, null);
  const [parametros] = useSearchParams();

  return (
    <Vista titulo="Nuevo traspaso">
      <p className="mb-4 text-sm">
        <Link
          className="text-acento-texto underline"
          to={{ pathname: '/traspasos', search: queryVista(parametros) }}
        >
          ← Traspasos
        </Link>
      </p>
      {!ROLES_ADMIN.includes(usuario.rol) ? (
        <Tarjeta titulo="Nuevo traspaso">
          <Vacio>Tu usuario puede ver los traspasos, pero no registrarlos.</Vacio>
        </Tarjeta>
      ) : filtro === null ? (
        <Tarjeta titulo="Nuevo traspaso">
          <Esqueleto lineas={4} />
        </Tarjeta>
      ) : (
        <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={6} />}>
          {(r) =>
            puedeTraspasar(r) ? (
              <Formulario r={r} empresaId={filtro.empresaId} sucursalVista={filtro.sucursalId} />
            ) : (
              <Tarjeta titulo="Nuevo traspaso">
                <Vacio>
                  El panel necesita conocer al menos dos almacenes de la empresa para registrar un
                  traspaso. Llegan del catálogo de SoftRestaurant que manda el agente.
                </Vacio>
              </Tarjeta>
            )
          }
        </SegunEstado>
      )}
    </Vista>
  );
}

function Formulario({
  r,
  empresaId,
  sucursalVista,
}: {
  r: DatosTraspasos;
  empresaId: string;
  sucursalVista: string | undefined;
}) {
  const queryClient = useQueryClient();
  const navegar = useNavigate();
  const [parametros] = useSearchParams();
  const inicial = r.almacenes.find((a) => a.sucursalId === sucursalVista) ?? r.almacenes[0] ?? null;
  const [origen, setOrigen] = useState(inicial ? valorAlmacen(inicial) : '');
  const elegidoOrigen = leerValorAlmacen(origen);
  const destinos = destinosPosibles(r.almacenes, elegidoOrigen);
  const [destino, setDestino] = useState(destinos[0] ? valorAlmacen(destinos[0]) : '');
  const elegidoDestino = leerValorAlmacen(destino);
  const [renglones, setRenglones] = useState<RenglonCaptura[]>([]);
  const [articulo, setArticulo] = useState('');
  const [nota, setNota] = useState('');
  const [intentado, setIntentado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const existencias = useExistencias(
    elegidoOrigen ? { empresaId, sucursalId: elegidoOrigen.sucursalId } : null,
    elegidoOrigen?.almacenOrigenSrId ?? null,
    '',
  );
  const filas = (existencias.data?.filas ?? []).filter(
    (f) =>
      f.sucursalId === elegidoOrigen?.sucursalId &&
      f.almacenOrigenSrId === elegidoOrigen?.almacenOrigenSrId,
  );
  const filaDe = new Map(filas.map((f) => [f.insumoOrigenSrId, f]));
  const disponibles = filas.filter(
    (f) => !renglones.some((x) => x.insumoOrigenSrId === f.insumoOrigenSrId),
  );
  const nombreSucursal = new Map(r.sucursales.map((s) => [s.sucursalId, s.sucursal]));
  const etiqueta = (a: { sucursalId: string; almacenOrigenSrId: string; almacen: string | null }) =>
    `${nombreSucursal.get(a.sucursalId) ?? 'Sucursal'} · ${nombreAlmacenTraspaso(a)}`;
  const errores = erroresAlta({ origen: elegidoOrigen, destino: elegidoDestino, renglones });

  function cambiarOrigen(valor: string) {
    setOrigen(valor);
    // Otros artículos: lo capturado era de otro almacén.
    setRenglones([]);
    setArticulo('');
    const nuevos = destinosPosibles(r.almacenes, leerValorAlmacen(valor));
    if (!nuevos.some((a) => valorAlmacen(a) === destino)) {
      setDestino(nuevos[0] ? valorAlmacen(nuevos[0]) : '');
    }
  }

  function agregar() {
    if (!articulo) return;
    setRenglones((rs) => [...rs, { insumoOrigenSrId: articulo, cantidad: '' }]);
    setArticulo('');
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setIntentado(true);
    if (errores.length > 0 || !elegidoOrigen || !elegidoDestino) return;
    setEnviando(true);
    setError(null);
    try {
      const d = await enviarTraspaso({
        empresaId,
        sucursalOrigenId: elegidoOrigen.sucursalId,
        almacenOrigenSrId: elegidoOrigen.almacenOrigenSrId,
        sucursalDestinoId: elegidoDestino.sucursalId,
        almacenDestinoSrId: elegidoDestino.almacenOrigenSrId,
        ...(nota.trim() ? { nota: nota.trim().slice(0, 200) } : {}),
        partidas: renglones.map((x) => ({
          insumoOrigenSrId: x.insumoOrigenSrId,
          cantidad: x.cantidad.trim(),
        })),
      });
      await queryClient.invalidateQueries({ queryKey: llaveTraspasos });
      navegar({ pathname: `/traspasos/${d.traspaso.id}`, search: queryVista(parametros) });
    } catch (err) {
      setError(
        err instanceof ErrorApi && err.status === 400
          ? 'El panel rechazó el traspaso: revisa los artículos y las cantidades.'
          : err instanceof ErrorApi && err.status === 404
            ? 'Uno de los almacenes ya no está disponible. Recarga la página.'
            : err instanceof ErrorApi && err.status === 503
              ? 'Otra operación de traspasos está en curso. Intenta de nuevo en un momento.'
              : 'No se pudo enviar el traspaso. Intenta de nuevo.',
      );
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={(e) => void enviar(e)} className="space-y-4" noValidate>
      <Tarjeta titulo="Origen y destino">
        <div className="flex flex-wrap gap-3">
          <label className="flex min-w-0 flex-col gap-1 text-sm text-tinta-suave">
            Sale de
            <select
              className={CONTROL}
              value={origen}
              onChange={(e) => cambiarOrigen(e.target.value)}
            >
              {r.almacenes.map((a) => (
                <option key={valorAlmacen(a)} value={valorAlmacen(a)}>
                  {etiqueta(a)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-sm text-tinta-suave">
            Llega a
            <select
              className={CONTROL}
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
            >
              {destinos.map((a) => (
                <option key={valorAlmacen(a)} value={valorAlmacen(a)}>
                  {etiqueta(a)}
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
              placeholder="Quién lo lleva, motivo…"
            />
          </label>
        </div>
      </Tarjeta>

      <Tarjeta titulo="Artículos">
        {existencias.isPending && elegidoOrigen ? (
          <Esqueleto lineas={3} />
        ) : filas.length === 0 ? (
          <p className="text-sm text-tinta-suave" data-testid="traspaso-sin-articulos">
            El almacén de origen todavía no tiene lectura de existencias: no hay artículos que
            elegir. La lectura la manda el agente de la sucursal.
          </p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-end gap-2">
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-tinta-suave">
                Artículo
                <select
                  className={CONTROL}
                  value={articulo}
                  onChange={(e) => setArticulo(e.target.value)}
                >
                  <option value="">Elige un artículo…</option>
                  {disponibles.map((f) => (
                    <option key={f.insumoOrigenSrId} value={f.insumoOrigenSrId}>
                      {f.insumo ?? f.insumoOrigenSrId}
                      {f.cantidad !== null
                        ? ` (hay ${textoCantidad(f.cantidad)}${f.unidad ? ` ${f.unidad}` : ''})`
                        : ''}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className={BOTON} disabled={!articulo} onClick={agregar}>
                Agregar
              </button>
            </div>
            {renglones.length === 0 ? (
              <p className="text-sm text-tinta-tenue">Todavía no agregas artículos.</p>
            ) : (
              <ul className="space-y-2">
                {renglones.map((x, i) => {
                  const f = filaDe.get(x.insumoOrigenSrId);
                  const err = intentado ? errorCantidad(x.cantidad) : null;
                  const aviso = avisoExistencia(x.cantidad, f?.cantidad ?? null);
                  const id = `cantidad-${x.insumoOrigenSrId}`;
                  return (
                    <li key={x.insumoOrigenSrId} className="flex flex-wrap items-center gap-2">
                      <label htmlFor={id} className="min-w-0 flex-1 text-sm">
                        {f?.insumo ?? x.insumoOrigenSrId}
                        {f?.unidad ? ` (${f.unidad})` : ''}
                      </label>
                      <input
                        id={id}
                        inputMode="decimal"
                        className={`${CONTROL} w-28 text-right`}
                        value={x.cantidad}
                        aria-invalid={err !== null}
                        onChange={(e) =>
                          setRenglones((rs) =>
                            rs.map((y, j) => (j === i ? { ...y, cantidad: e.target.value } : y)),
                          )
                        }
                      />
                      <button
                        type="button"
                        className={BOTON}
                        onClick={() => setRenglones((rs) => rs.filter((_, j) => j !== i))}
                      >
                        Quitar
                      </button>
                      {err && <span className="w-full text-xs text-peligro">{err}</span>}
                      {!err && aviso && <span className="w-full text-xs text-aviso">{aviso}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </Tarjeta>

      {intentado && errores.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-sm text-peligro">
          {errores.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={PRIMARIO} disabled={enviando}>
          {enviando ? 'Enviando…' : 'Enviar traspaso'}
        </button>
        <span className="text-xs text-tinta-tenue">
          Después regístralo también en SoftRestaurant; el panel lo concilia cuando lo lea.
        </span>
      </div>
    </form>
  );
}
