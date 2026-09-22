import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { useFiltroAlcance } from '../alertas/consultas';
import { ErrorApi } from '../api/cliente';
import type { EspejoTraspaso, TraspasoDetalle as Detalle } from '../api/tipos';
import { useUsuario } from '../auth/contexto';
import { ROLES_ADMIN } from '../auth/roles';
import { pesos } from '../dinero/dinero';
import { queryVista } from '../filtros/vista';
import { horaEn } from './conteos/reglas';
import { Esqueleto, SegunEstado, Tarjeta } from './inicio/Tarjeta';
import { cantidad } from './tickets/formato';
import { accionTraspaso, llaveTraspasos, useTraspaso } from './traspasos/consultas';
import {
  destinoDe,
  nombreArticuloTraspaso,
  origenDe,
  TEXTO_ESTADO_TRASPASO,
} from './traspasos/reglas';
import { EtiquetaConciliacion } from './Traspasos';
import { Vista } from './Vista';

const TH = 'px-2 py-1 font-medium';
const TD = 'px-2 py-2';
const NUM = 'px-2 py-2 text-right tabular-nums whitespace-nowrap';
const BOTON =
  'rounded-md border border-linea-fuerte bg-superficie px-3 py-2 text-sm text-tinta-medio hover:bg-realce disabled:opacity-50';

/**
 * Un traspaso (F2-124): su flujo (enviado → recibido), sus renglones con el movimiento espejo que
 * SR registró para cada uno, y el REPORTE IMPRIMIBLE (con firmas de quien envía y quien recibe).
 * Recibir y cancelar se confirman en la página. Nada de esto escribe a SoftRestaurant.
 */
export function TraspasoDetalle() {
  const { id = '' } = useParams();
  const filtro = useFiltroAlcance();
  const [parametros] = useSearchParams();
  const consulta = useTraspaso(filtro?.empresaId ?? null, id);
  return (
    <Vista titulo="Traspaso">
      <p className="mb-4 text-sm print:hidden">
        <Link
          className="text-acento-texto underline"
          to={{ pathname: '/traspasos', search: queryVista(parametros) }}
        >
          ← Traspasos
        </Link>
      </p>
      {filtro === null ? (
        <Esqueleto lineas={6} />
      ) : (
        <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={6} />}>
          {(d) => <Contenido key={d.traspaso.id} d={d} empresaId={filtro.empresaId} />}
        </SegunEstado>
      )}
    </Vista>
  );
}

function espejo(e: EspejoTraspaso | null, zona: string): string {
  return e === null ? 'Todavía no aparece' : `${e.folio} · ${horaEn(zona, e.fecha)}`;
}

function Contenido({ d, empresaId }: { d: Detalle; empresaId: string }) {
  const t = d.traspaso;
  const zona = d.zonaHoraria;
  return (
    <div data-testid="traspaso-reporte">
      <Tarjeta titulo={`Traspaso #${t.folio}`}>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-tinta-suave">Sale de</dt>
            <dd>{origenDe(t)}</dd>
          </div>
          <div>
            <dt className="text-tinta-suave">Llega a</dt>
            <dd>{destinoDe(t)}</dd>
          </div>
          <div>
            <dt className="text-tinta-suave">Estado</dt>
            <dd data-testid="traspaso-estado">{TEXTO_ESTADO_TRASPASO[t.estado]}</dd>
          </div>
          <div>
            <dt className="text-tinta-suave">En SoftRestaurant</dt>
            <dd>
              <EtiquetaConciliacion t={t} />
              {t.conciliadoAt && (
                <span className="block text-xs text-tinta-tenue">
                  Conciliado el {horaEn(zona, t.conciliadoAt)}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-tinta-suave">Enviado</dt>
            <dd>{horaEn(zona, t.enviadoAt)}</dd>
          </div>
          <div>
            <dt className="text-tinta-suave">Recibido</dt>
            <dd>{t.recibidoAt ? horaEn(zona, t.recibidoAt) : 'Todavía no'}</dd>
          </div>
          {t.canceladoAt && (
            <div>
              <dt className="text-tinta-suave">Cancelado</dt>
              <dd>{horaEn(zona, t.canceladoAt)}</dd>
            </div>
          )}
          {t.nota && (
            <div className="sm:col-span-2">
              <dt className="text-tinta-suave">Nota</dt>
              <dd>{t.nota}</dd>
            </div>
          )}
        </dl>
        {t.conciliacion === 'pendiente_sr' || t.conciliacion === 'en_alerta' ? (
          <p
            className="mt-3 text-sm text-tinta-medio print:hidden"
            data-testid="traspaso-pendiente"
          >
            Registra este traspaso también en SoftRestaurant (la salida en el almacén de origen y la
            entrada en el de destino). El panel lo concilia solo cuando la sincronización traiga los
            dos movimientos con el mismo artículo y cantidad, a más tardar un día después.
            {t.conciliacion === 'en_alerta' &&
              ' Ya pasó el plazo de la alerta sin que aparezca: revisa si se capturó en SR.'}
          </p>
        ) : null}
      </Tarjeta>

      <Tarjeta titulo="Artículos" className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-tinta-suave">
              <tr>
                <th scope="col" className={TH}>
                  Artículo
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Cantidad
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Costo
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Importe
                </th>
                <th scope="col" className={TH}>
                  Salida en SR
                </th>
                <th scope="col" className={TH}>
                  Entrada en SR
                </th>
              </tr>
            </thead>
            <tbody>
              {d.partidas.map((p) => (
                <tr
                  key={p.insumoOrigenSrId}
                  className="border-t border-linea"
                  data-partida={p.insumoOrigenSrId}
                >
                  <td className={TD}>
                    {nombreArticuloTraspaso(p)}
                    {p.clave && <span className="block text-xs text-tinta-tenue">{p.clave}</span>}
                  </td>
                  <td className={NUM}>
                    {cantidad(p.cantidad)}
                    {p.unidad ? ` ${p.unidad}` : ''}
                  </td>
                  <td className={NUM}>
                    {p.costoUnitario === null ? 'Sin lectura' : pesos(p.costoUnitario)}
                  </td>
                  <td className={NUM}>{p.importe === null ? '—' : pesos(p.importe)}</td>
                  <td className={TD}>{espejo(p.salida, zona)}</td>
                  <td className={TD}>{espejo(p.entrada, zona)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-linea-fuerte font-medium">
                <td className={TD} colSpan={3}>
                  Total
                  {d.totales.sinCosto > 0 && (
                    <span className="block text-xs font-normal text-tinta-tenue">
                      {d.totales.sinCosto} artículo(s) sin costo (sin lectura en el origen) no
                      suman.
                    </span>
                  )}
                </td>
                <td className={NUM} data-testid="traspaso-total">
                  {pesos(d.totales.importe)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </Tarjeta>

      <div className="mt-10 hidden grid-cols-2 gap-10 text-sm print:grid" aria-hidden="true">
        <p className="border-t border-tinta pt-1">Envía (nombre y firma)</p>
        <p className="border-t border-tinta pt-1">Recibe (nombre y firma)</p>
      </div>

      <Acciones d={d} empresaId={empresaId} />
    </div>
  );
}

function Acciones({ d, empresaId }: { d: Detalle; empresaId: string }) {
  const usuario = useUsuario();
  const queryClient = useQueryClient();
  const esAdmin = ROLES_ADMIN.includes(usuario.rol);
  const [confirmando, setConfirmando] = useState<'recibir' | 'cancelar' | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = d.traspaso;
  const conEspejo = d.partidas.some((p) => p.salida !== null || p.entrada !== null);

  async function hacer(que: 'recibir' | 'cancelar') {
    setEnviando(true);
    setError(null);
    try {
      const nuevo = await accionTraspaso(empresaId, t.id, que);
      queryClient.setQueryData([...llaveTraspasos, 'detalle', empresaId, t.id], nuevo);
      await queryClient.invalidateQueries({ queryKey: [...llaveTraspasos, 'lista'] });
      setConfirmando(null);
    } catch (err) {
      setError(
        err instanceof ErrorApi && err.status === 409
          ? que === 'cancelar'
            ? 'No se puede cancelar: ya cambió de estado o SoftRestaurant ya tiene sus movimientos. Recarga.'
            : 'El traspaso ya cambió de estado. Recarga.'
          : err instanceof ErrorApi && err.status === 503
            ? 'Otra operación de traspasos está en curso. Intenta de nuevo en un momento.'
            : 'No se pudo. Intenta de nuevo.',
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Tarjeta titulo="Acciones" className="mt-4 print:hidden">
      <div className="flex flex-wrap gap-3">
        <button type="button" className={BOTON} onClick={() => window.print()}>
          Imprimir reporte
        </button>
        {esAdmin && t.estado === 'enviado' && confirmando === null && (
          <>
            <button type="button" className={BOTON} onClick={() => setConfirmando('recibir')}>
              Confirmar recepción
            </button>
            {!conEspejo && (
              <button type="button" className={BOTON} onClick={() => setConfirmando('cancelar')}>
                Cancelar traspaso
              </button>
            )}
          </>
        )}
      </div>
      {confirmando !== null && (
        <div className="mt-3 text-sm" data-testid="traspaso-confirmar">
          <p>
            {confirmando === 'recibir'
              ? '¿Confirmas que el destino recibió todos los artículos del traspaso?'
              : '¿Cancelar el traspaso? Queda visible, pero ya no se espera en SoftRestaurant.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              className={BOTON}
              disabled={enviando}
              onClick={() => void hacer(confirmando)}
            >
              {confirmando === 'recibir' ? 'Sí, recibido' : 'Sí, cancelar'}
            </button>
            <button type="button" className={BOTON} onClick={() => setConfirmando(null)}>
              No
            </button>
          </div>
        </div>
      )}
      {!esAdmin && t.estado === 'enviado' && (
        <p className="mt-2 text-xs text-tinta-tenue">
          Confirmar la recepción o cancelar lo hace un administrador.
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
