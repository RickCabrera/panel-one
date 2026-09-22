import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { useFiltroAlcance } from '../alertas/consultas';
import type {
  EstadoTraspaso,
  Traspasos as DatosTraspasos,
  TraspasosSr,
  TraspasoResumen,
} from '../api/tipos';
import { useUsuario } from '../auth/contexto';
import { ROLES_ADMIN } from '../auth/roles';
import { usePeriodo } from '../filtros/usePeriodo';
import { queryVista } from '../filtros/vista';
import { horaEn } from './conteos/reglas';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from './inicio/Tarjeta';
import { useTraspasos, useTraspasosSr } from './traspasos/consultas';
import {
  avanceConciliacion,
  COLOR_CONCILIACION,
  destinoDe,
  nombreAlmacenTraspaso,
  origenDe,
  puedeTraspasar,
  TEXTO_CONCILIACION,
  TEXTO_ESTADO_TRASPASO,
  vacioTraspasos,
} from './traspasos/reglas';
import { Vista } from './Vista';

const TH = 'px-2 py-1 font-medium';
const TD = 'px-2 py-2';
const CONTROL =
  'min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-2 text-sm focus:border-acento-borde focus:outline-none disabled:opacity-50';
const BOTON =
  'rounded-md border border-linea-fuerte bg-superficie px-3 py-2 text-sm text-tinta-medio hover:bg-realce';
const PESTANA = 'rounded-md px-3 py-1 text-sm';

type Pestana = 'panel' | 'sr';

/**
 * Traspasos (F2-124): los del PANEL (enviado → recibido, con su conciliación contra SR) y los
 * LEÍDOS de SoftRestaurant en el periodo. Un traspaso del panel se registra también en SR a mano;
 * el panel lo concilia solo cuando la sincronización trae su salida y su entrada, y lo marca en
 * alerta si pasan 48 h sin que aparezca. Nada se escribe a SR.
 */
export function Traspasos() {
  const filtro = useFiltroAlcance();
  const usuario = useUsuario();
  const esAdmin = ROLES_ADMIN.includes(usuario.rol);
  const [parametros] = useSearchParams();
  const [estado, setEstado] = useState<EstadoTraspaso | ''>('');
  const [pestana, setPestana] = useState<Pestana>('panel');
  const consulta = useTraspasos(filtro, estado || null);
  const search = queryVista(parametros);

  return (
    <Vista titulo="Traspasos">
      <p className="mb-4 text-sm text-tinta-tenue">
        Mueve artículos de un almacén a otro, en la misma sucursal o entre sucursales. El traspaso
        se registra también en SoftRestaurant: el panel lo marca conciliado cuando la sincronización
        trae su salida y su entrada (mismo artículo y cantidad, ± 1 día).
      </p>
      <div role="tablist" aria-label="Origen de los traspasos" className="mb-4 flex gap-2">
        {(
          [
            ['panel', 'Del panel'],
            ['sr', 'Leídos de SoftRestaurant'],
          ] as const
        ).map(([id, texto]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={pestana === id}
            className={`${PESTANA} ${pestana === id ? 'bg-acento text-sobre-acento' : 'text-tinta-medio hover:bg-realce'}`}
            onClick={() => setPestana(id)}
          >
            {texto}
          </button>
        ))}
      </div>
      {filtro === null ? (
        <Tarjeta titulo="Traspasos">
          <Esqueleto lineas={4} />
        </Tarjeta>
      ) : pestana === 'sr' ? (
        <LeidosDeSr />
      ) : (
        <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={6} />}>
          {(r) => {
            const v = vacioTraspasos(r);
            return (
              <>
                {esAdmin && puedeTraspasar(r) && (
                  <div className="mb-4">
                    <Link className={BOTON} to={{ pathname: '/traspasos/nuevo', search }}>
                      Nuevo traspaso
                    </Link>
                  </div>
                )}
                {v.tipo !== 'con-datos' && estado === '' ? (
                  <Tarjeta titulo="Traspasos del panel">
                    <div className="space-y-2 text-sm" data-testid="traspasos-vacio">
                      <p>{v.porque}</p>
                      <p className="text-tinta-medio">{v.falta}</p>
                    </div>
                  </Tarjeta>
                ) : (
                  <Tarjeta titulo="Traspasos del panel">
                    <label className="mb-3 flex items-center gap-2 text-sm text-tinta-suave">
                      Estado
                      <select
                        className={CONTROL}
                        value={estado}
                        onChange={(e) => setEstado(e.target.value as EstadoTraspaso | '')}
                      >
                        <option value="">Todos</option>
                        {(Object.keys(TEXTO_ESTADO_TRASPASO) as EstadoTraspaso[]).map((e) => (
                          <option key={e} value={e}>
                            {TEXTO_ESTADO_TRASPASO[e]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Lista r={r} search={search} />
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

export function EtiquetaConciliacion({ t }: { t: Pick<TraspasoResumen, 'conciliacion'> }) {
  return (
    <span className="inline-flex items-center gap-1" data-conciliacion={t.conciliacion}>
      <span
        aria-hidden="true"
        className={`inline-block h-2 w-2 rounded-full ${COLOR_CONCILIACION[t.conciliacion]}`}
      />
      {TEXTO_CONCILIACION[t.conciliacion]}
    </span>
  );
}

function Lista({ r, search }: { r: DatosTraspasos; search: string }) {
  if (r.traspasos.length === 0) {
    return <p className="text-sm text-tinta-suave">Ningún traspaso con ese estado.</p>;
  }
  const zonaDe = new Map(r.sucursales.map((s) => [s.sucursalId, s.zonaHoraria]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-tinta-suave">
          <tr>
            <th scope="col" className={TH}>
              Traspaso
            </th>
            <th scope="col" className={TH}>
              De
            </th>
            <th scope="col" className={TH}>
              A
            </th>
            <th scope="col" className={TH}>
              Estado
            </th>
            <th scope="col" className={TH}>
              En SoftRestaurant
            </th>
            <th scope="col" className={TH}>
              Enviado
            </th>
          </tr>
        </thead>
        <tbody>
          {r.traspasos.map((t) => (
            <tr key={t.id} className="border-t border-linea" data-traspaso={t.id}>
              <td className={TD}>
                <Link
                  className="text-acento-texto underline"
                  to={{ pathname: `/traspasos/${t.id}`, search }}
                >
                  #{t.folio} · {t.articulos} {t.articulos === 1 ? 'artículo' : 'artículos'}
                </Link>
                {t.nota && <span className="block text-xs text-tinta-tenue">{t.nota}</span>}
              </td>
              <td className={TD}>{origenDe(t)}</td>
              <td className={TD}>{destinoDe(t)}</td>
              <td className={TD}>{TEXTO_ESTADO_TRASPASO[t.estado]}</td>
              <td className={TD}>
                <EtiquetaConciliacion t={t} />
                {t.conciliacion !== 'cancelado' && t.conciliacion !== 'conciliado' && (
                  <span className="block text-xs text-tinta-tenue">
                    {avanceConciliacion(t)} renglones en SR
                  </span>
                )}
              </td>
              <td className={`${TD} whitespace-nowrap`}>
                {horaEn(zonaDe.get(t.sucursalId) ?? 'America/Mexico_City', t.enviadoAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-tinta-tenue">
        En alerta: sin conciliar después de {r.umbralAlertaHoras} h desde su envío (se ajusta en las
        reglas del centro de alertas).
      </p>
      {r.total > r.traspasos.length && (
        <p className="mt-1 text-xs text-tinta-tenue">
          Se muestran los {r.traspasos.length} más recientes de {r.total}.
        </p>
      )}
    </div>
  );
}

function LeidosDeSr() {
  const filtro = useFiltroAlcance();
  const { rango } = usePeriodo();
  const [parametros] = useSearchParams();
  const consulta = useTraspasosSr(filtro, rango, true);
  if (rango === null) {
    return (
      <Tarjeta titulo="Leídos de SoftRestaurant">
        <Vacio>El rango de fechas no es válido: corrígelo en la cabecera para consultar.</Vacio>
      </Tarjeta>
    );
  }
  return (
    <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={6} />}>
      {(r) => <TablaSr r={r} search={queryVista(parametros)} />}
    </SegunEstado>
  );
}

function TablaSr({ r, search }: { r: TraspasosSr; search: string }) {
  const zonaDe = new Map(r.sucursales.map((s) => [s.sucursalId, s.zonaHoraria]));
  if (r.traspasos.length === 0) {
    return (
      <Tarjeta titulo="Leídos de SoftRestaurant">
        <div className="space-y-2 text-sm" data-testid="traspasos-sr-vacio">
          {r.hayPolizas ? (
            <p>SoftRestaurant no registró traspasos en el periodo elegido.</p>
          ) : (
            <>
              <p>Todavía no llega ningún traspaso de SoftRestaurant a este alcance.</p>
              <p className="text-tinta-medio">
                Los traspasos de SR llegan como pólizas de inventario (salida y entrada) cuando el
                agente de la sucursal tenga el lector de inventario de SoftRestaurant. Si la
                instalación no usa traspasos, esta lista se queda vacía.
              </p>
            </>
          )}
        </div>
      </Tarjeta>
    );
  }
  return (
    <Tarjeta titulo="Leídos de SoftRestaurant">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-tinta-suave">
            <tr>
              <th scope="col" className={TH}>
                Documento en SR
              </th>
              <th scope="col" className={TH}>
                Pólizas
              </th>
              <th scope="col" className={TH}>
                En el panel
              </th>
            </tr>
          </thead>
          <tbody>
            {r.traspasos.map((g) => (
              <tr
                key={g.referencia ?? g.polizas[0].polizaId}
                className="border-t border-linea align-top"
              >
                <td className={TD}>{g.referencia ?? 'Sin referencia'}</td>
                <td className={TD}>
                  <ul className="space-y-1">
                    {g.polizas.map((p) => (
                      <li key={p.polizaId}>
                        {p.tipo === 'traspaso_salida' ? 'Salida' : 'Entrada'} {p.folio} ·{' '}
                        {p.sucursal} · {nombreAlmacenTraspaso(p)} ·{' '}
                        {horaEn(zonaDe.get(p.sucursalId) ?? 'America/Mexico_City', p.fecha)}
                        {p.cancelada && (
                          <span className="ml-1 text-xs text-peligro">(cancelada en SR)</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className={TD}>
                  {g.traspasosPanel.length === 0 ? (
                    <span className="text-tinta-tenue">Sin traspaso del panel</span>
                  ) : (
                    g.traspasosPanel.map((t) => (
                      <Link
                        key={t.id}
                        className="mr-2 text-acento-texto underline"
                        to={{ pathname: `/traspasos/${t.id}`, search }}
                      >
                        #{t.folio}
                      </Link>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.truncado && (
          <p className="mt-2 text-xs text-tinta-tenue">
            Hay más pólizas de traspaso en el periodo de las que se muestran: acorta el rango.
          </p>
        )}
      </div>
    </Tarjeta>
  );
}
