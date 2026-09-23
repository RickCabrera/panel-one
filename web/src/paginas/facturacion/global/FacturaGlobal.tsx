import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ErrorApi } from '../../../api/cliente';
import type {
  FacturaGlobalEmitida,
  PeriodicidadGlobal,
  ResumenPeriodoGlobal,
  Sucursal,
} from '../../../api/tipos';
import { pesos } from '../../../dinero/dinero';
import { Tarjeta, Vacio } from '../../inicio/Tarjeta';
import { LLAVE_TABLERO } from '../tablero/consultas';
import {
  emitirGlobal,
  guardarConfiguracionGlobal,
  LLAVE_GLOBAL,
  useConfiguracionGlobal,
  usePeriodosGlobal,
  useVistaPreviaGlobal,
} from './consultas';
import {
  explicacionPeriodo,
  fechaEn,
  FORMA_PAGO_TEXTO,
  PERIODICIDADES,
  sePuedeEmitir,
  TEXTO_ESTADO,
} from './reglas';

const CONTROL =
  'min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-1 text-sm focus:border-acento-borde focus:outline-none disabled:opacity-50';
const PRIMARIO =
  'rounded-md bg-acento px-3 py-1 text-sm font-medium text-sobre-acento disabled:opacity-50';
const BOTON =
  'rounded-md border border-linea-fuerte px-2 py-0.5 text-xs hover:bg-realce disabled:opacity-50';
const NUM = 'px-2 py-1 text-right tabular-nums';
const TH = 'px-2 py-1 text-left font-medium';

const mensajeDe = (e: unknown) => (e instanceof ErrorApi ? e.message : 'Error inesperado.');

/**
 * Factura global a público en general (F2-108). Los tickets que ningún cliente facturó a tiempo se
 * amparan con una global por periodo y sucursal. Un ticket entra sólo cuando su código ya no se
 * puede facturar en el portal; después, el portal lo explica con el periodo de la global.
 *
 * - Configuración: periodicidad (mensual por omisión) y emisión automática (apagada por omisión:
 *   timbrar gasta folios). Encenderla no timbra periodos viejos de golpe.
 * - Periodos de la sucursal, con su estado y por qué; vista previa; emitir con confirmación.
 */
export function FacturaGlobal({
  empresaId,
  sucursales,
}: {
  empresaId: string | null;
  sucursales: readonly Sucursal[];
}) {
  const activas = sucursales.filter((s) => s.activo);
  const [sucursalId, setSucursalId] = useState('');
  const elegida = sucursalId || (activas.length > 0 ? activas[0].id : '');

  if (!empresaId) return <Vacio>Elige una empresa arriba para ver su factura global.</Vacio>;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-tinta-tenue">
        Los tickets que ningún cliente facturó a tiempo se amparan con una factura global a público
        en general (RFC XAXX010101000), por sucursal y periodo. Un ticket entra sólo cuando ya no se
        puede facturar en el portal; a partir de ahí, el portal le explica al cliente en qué periodo
        quedó.
      </p>
      <Configuracion empresaId={empresaId} />
      {activas.length === 0 ? (
        <Vacio>La empresa no tiene sucursales activas: no hay tickets que amparar.</Vacio>
      ) : (
        <>
          <label className="flex max-w-xs flex-col gap-1 text-sm">
            Sucursal
            <select
              className={CONTROL}
              value={elegida}
              onChange={(e) => setSucursalId(e.target.value)}
            >
              {activas.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>
          <Periodos key={elegida} empresaId={empresaId} sucursalId={elegida} />
        </>
      )}
    </div>
  );
}

function Configuracion({ empresaId }: { empresaId: string }) {
  const cliente = useQueryClient();
  const conf = useConfiguracionGlobal(empresaId);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(periodicidad: PeriodicidadGlobal, automatica: boolean) {
    setGuardando(true);
    setError(null);
    try {
      await guardarConfiguracionGlobal({ empresaId, periodicidad, automatica });
      await cliente.invalidateQueries({ queryKey: LLAVE_GLOBAL });
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Tarjeta titulo="Configuración">
      {conf.isError ? (
        <Vacio>No se pudo leer la configuración: {mensajeDe(conf.error)}</Vacio>
      ) : !conf.data ? (
        <p className="text-sm text-tinta-tenue">Cargando…</p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1">
              Periodicidad
              <select
                className={CONTROL}
                value={conf.data.periodicidad}
                disabled={guardando}
                onChange={(e) =>
                  void guardar(e.target.value as PeriodicidadGlobal, conf.data!.automatica)
                }
              >
                {PERIODICIDADES.map((p) => (
                  <option key={p.valor} value={p.valor}>
                    {p.texto}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={conf.data.automatica}
                disabled={guardando}
                onChange={(e) => void guardar(conf.data!.periodicidad, e.target.checked)}
              />
              Emitir sola cada periodo que quede listo
            </label>
          </div>
          <p className="text-xs text-tinta-tenue">
            {conf.data.automatica && conf.data.automaticaDesde
              ? `Encendida desde el ${new Intl.DateTimeFormat('es-MX', {
                  timeZone: 'America/Mexico_City',
                  dateStyle: 'long',
                }).format(
                  new Date(conf.data.automaticaDesde),
                )}: se emiten solos los periodos que terminen después; los anteriores y las complementarias se emiten a mano.`
              : 'Apagada: cada factura global se emite a mano desde la vista previa.'}
          </p>
          {conf.data.aviso && (
            <p
              role="note"
              className="rounded-md border border-aviso-borde bg-aviso-fondo p-2 text-xs"
            >
              {conf.data.aviso}
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-peligro">
              {error}
            </p>
          )}
        </div>
      )}
    </Tarjeta>
  );
}

function Periodos({ empresaId, sucursalId }: { empresaId: string; sucursalId: string }) {
  const conf = useConfiguracionGlobal(empresaId);
  const periodicidad = conf.data?.periodicidad ?? null;
  const consulta = usePeriodosGlobal(empresaId, sucursalId, periodicidad);
  const [clave, setClave] = useState<string | null>(null);

  if (consulta.isError) {
    return <Vacio>No se pudieron leer los periodos: {mensajeDe(consulta.error)}</Vacio>;
  }
  if (!consulta.data || periodicidad === null) {
    return <p className="text-sm text-tinta-tenue">Cargando periodos…</p>;
  }
  const { periodos, emitidas, sucursal } = consulta.data;
  const zona = sucursal.zonaHoraria;
  return (
    <>
      <Tarjeta titulo="Periodos con tickets sin factura">
        {periodos.length === 0 ? (
          <Vacio>
            <span data-testid="sin-periodos">
              No hay tickets pendientes de una factura global en esta sucursal (desde el 1 de enero
              del año pasado): todos se facturaron o ya están en una global. Si la sucursal no está
              sincronizando, sus ventas no aparecen aquí.
            </span>
          </Vacio>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-tinta-tenue">
              <tr>
                <th className={TH}>Periodo</th>
                <th className={TH}>Estado</th>
                <th className={`${NUM} font-medium`}>Tickets</th>
                <th className={`${NUM} font-medium`}>Total</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {periodos.map((p) => (
                <FilaPeriodo
                  key={p.clave}
                  p={p}
                  zona={zona}
                  abierta={clave === p.clave}
                  onVer={() => setClave(clave === p.clave ? null : p.clave)}
                />
              ))}
            </tbody>
          </table>
        )}
      </Tarjeta>
      {clave !== null && (
        <VistaPrevia
          empresaId={empresaId}
          sucursalId={sucursalId}
          periodicidad={periodicidad}
          clave={clave}
          zona={zona}
          onCerrar={() => setClave(null)}
        />
      )}
      <Tarjeta titulo="Facturas globales emitidas">
        {emitidas.length === 0 ? (
          <Vacio>Esta sucursal todavía no tiene facturas globales.</Vacio>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-tinta-tenue">
              <tr>
                <th className={TH}>Serie-folio</th>
                <th className={TH}>Periodo</th>
                <th className={TH}>Estado</th>
                <th className={`${NUM} font-medium`}>Tickets</th>
                <th className={`${NUM} font-medium`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {emitidas.map((e) => (
                <tr key={e.id} className="border-t border-linea">
                  <td className="px-2 py-1">{e.serieFolio}</td>
                  <td className="px-2 py-1">{e.etiqueta ?? 'Sin dato'}</td>
                  <td className="px-2 py-1">
                    {e.estado === 'timbrando' ? (
                      <span title="El PAC no confirmó: sus tickets siguen reservados hasta conciliarla.">
                        En emisión (sin confirmar)
                      </span>
                    ) : e.estado === 'vigente' ? (
                      'Vigente'
                    ) : (
                      'Cancelada'
                    )}
                  </td>
                  <td className={NUM}>{e.tickets}</td>
                  <td className={NUM}>{pesos(e.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-tinta-tenue">
          Sus XML y PDF se descargan desde la tabla del Tablero (filtro Origen: Factura global).
        </p>
      </Tarjeta>
    </>
  );
}

function FilaPeriodo({
  p,
  zona,
  abierta,
  onVer,
}: {
  p: ResumenPeriodoGlobal;
  zona: string;
  abierta: boolean;
  onVer: () => void;
}) {
  return (
    <tr className="border-t border-linea align-top">
      <td className="px-2 py-1 whitespace-nowrap">{p.etiqueta}</td>
      <td className="px-2 py-1">
        <div className="font-medium">
          {TEXTO_ESTADO[p.estado]}
          {p.globalesPrevias > 0 && p.estado === 'lista' && ' (complementaria)'}
        </div>
        <div className="text-xs text-tinta-tenue">{explicacionPeriodo(p, zona)}</div>
      </td>
      <td className={NUM}>{p.tickets}</td>
      <td className={NUM}>{pesos(p.total)}</td>
      <td className="px-2 py-1 text-right">
        {p.tickets > 0 && (
          <button type="button" className={BOTON} onClick={onVer} aria-expanded={abierta}>
            {abierta ? 'Cerrar' : 'Vista previa'}
          </button>
        )}
      </td>
    </tr>
  );
}

function VistaPrevia({
  empresaId,
  sucursalId,
  periodicidad,
  clave,
  zona,
  onCerrar,
}: {
  empresaId: string;
  sucursalId: string;
  periodicidad: PeriodicidadGlobal;
  clave: string;
  zona: string;
  onCerrar: () => void;
}) {
  const cliente = useQueryClient();
  const vista = useVistaPreviaGlobal(empresaId, sucursalId, periodicidad, clave);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emitida, setEmitida] = useState<FacturaGlobalEmitida | null>(null);

  async function emitir() {
    setEnviando(true);
    setError(null);
    try {
      const r = await emitirGlobal({ empresaId, sucursalId, periodicidad, clave });
      setEmitida(r);
      setConfirmando(false);
      void cliente.invalidateQueries({ queryKey: LLAVE_GLOBAL });
      void cliente.invalidateQueries({ queryKey: LLAVE_TABLERO });
    } catch (e) {
      setError(mensajeDe(e));
      void cliente.invalidateQueries({ queryKey: LLAVE_GLOBAL });
    } finally {
      setEnviando(false);
    }
  }

  const v = vista.data;
  return (
    <Tarjeta titulo={v ? `Vista previa: ${v.periodo.etiqueta}` : 'Vista previa'}>
      {emitida ? (
        <div role="status" className="flex flex-col gap-2 text-sm">
          <p>
            Se emitió la factura global <strong>{emitida.serieFolio}</strong> de {emitida.etiqueta}{' '}
            por <strong>{pesos(emitida.total)}</strong>, con {emitida.tickets} tickets. Esos tickets
            ya no se pueden facturar en el portal.
          </p>
          <button type="button" className={`${BOTON} self-start`} onClick={onCerrar}>
            Cerrar
          </button>
        </div>
      ) : vista.isError ? (
        <Vacio>No se pudo armar la vista previa: {mensajeDe(vista.error)}</Vacio>
      ) : !v ? (
        <p className="text-sm text-tinta-tenue">Cargando…</p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <dt className="text-tinta-tenue">Receptor</dt>
            <dd>Público en general (XAXX010101000)</dd>
            <dt className="text-tinta-tenue">Periodicidad · Meses · Año</dt>
            <dd data-testid="informacion-global">
              {v.periodo.periodicidadSat} · {v.periodo.meses} · {v.periodo.anio}
            </dd>
            <dt className="text-tinta-tenue">Forma de pago</dt>
            <dd>
              {v.formaPago
                ? (FORMA_PAGO_TEXTO[v.formaPago] ?? v.formaPago)
                : 'Sin forma declarable'}
            </dd>
            <dt className="text-tinta-tenue">Subtotal · IVA · Total</dt>
            <dd className="tabular-nums">
              {v.subtotal && v.iva && v.total
                ? `${pesos(v.subtotal)} · ${pesos(v.iva)} · ${pesos(v.total)}`
                : '—'}
            </dd>
          </dl>
          {v.globalesPrevias > 0 && (
            <p
              role="note"
              className="rounded-md border border-aviso-borde bg-aviso-fondo p-2 text-xs"
            >
              Este periodo YA tiene{' '}
              {v.globalesPrevias === 1
                ? 'una factura global'
                : `${v.globalesPrevias} facturas globales`}
              . Ésta sería complementaria: sólo con los tickets que quedaron fuera.
            </p>
          )}
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-tinta-tenue">
                <tr>
                  <th className={TH}>Ticket</th>
                  <th className={TH}>Cierre</th>
                  <th className={`${NUM} font-medium`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {v.tickets.map((t) => (
                  <tr key={t.folio} className="border-t border-linea">
                    <td className="px-2 py-1">{t.folio}</td>
                    <td className="px-2 py-1">{fechaEn(zona, t.cerradoAt)}</td>
                    <td className={NUM}>{pesos(t.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && (
            <p role="alert" className="text-sm text-peligro">
              {error}
            </p>
          )}
          {!sePuedeEmitir(v) ? (
            <p className="text-xs text-tinta-tenue">
              Este periodo todavía no se puede emitir ({TEXTO_ESTADO[v.estado].toLowerCase()}).
            </p>
          ) : v.formaPago === null ? (
            <p className="text-xs text-tinta-tenue">
              Ningún pago de estos tickets tiene una forma declarable ante el SAT: no se puede
              emitir desde aquí.
            </p>
          ) : confirmando ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>
                ¿Emitir la factura global de {v.periodo.etiqueta} con {v.tickets.length} tickets por{' '}
                {v.total ? pesos(v.total) : '—'}? Se timbra ante el SAT y gasta un folio.
              </span>
              <button
                type="button"
                className={PRIMARIO}
                disabled={enviando}
                onClick={() => void emitir()}
              >
                {enviando ? 'Emitiendo…' : 'Sí, emitir'}
              </button>
              <button
                type="button"
                className={BOTON}
                disabled={enviando}
                onClick={() => setConfirmando(false)}
              >
                No
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={`${PRIMARIO} self-start`}
              onClick={() => setConfirmando(true)}
            >
              Emitir factura global
            </button>
          )}
        </div>
      )}
    </Tarjeta>
  );
}
