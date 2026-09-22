import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { useFiltroAlcance } from '../alertas/consultas';
import { ErrorApi } from '../api/cliente';
import type { ConteoDetalle, PartidaConteo } from '../api/tipos';
import { useUsuario } from '../auth/contexto';
import { ROLES_ADMIN } from '../auth/roles';
import { descargar, ErrorCsv } from '../csv/csv';
import { pesos } from '../dinero/dinero';
import { queryVista } from '../filtros/vista';
import { leerCantidad, mismaCantidad, type Borrador } from './conteos/borrador';
import type { EstadoEnvio } from './conteos/captura';
import { llaveConteos, terminarConteo, useCapturaConteo, useConteo } from './conteos/consultas';
import { conteoACsv, nombreCsvConteo } from './conteos/csv';
import {
  alcanceConteo,
  buscar,
  horaEn,
  nombreAlmacenConteo,
  nombreArticulo,
  TEXTO_ESTADO_CONTEO,
  TEXTO_RENGLON,
} from './conteos/reglas';
import { Esqueleto, SegunEstado, Tarjeta } from './inicio/Tarjeta';
import { cantidad } from './tickets/formato';
import { Vista } from './Vista';

const TH = 'px-2 py-1 font-medium';
const TD = 'px-2 py-2';
const NUM = 'px-2 py-2 text-right tabular-nums whitespace-nowrap';
const BOTON =
  'rounded-md border border-linea-fuerte bg-superficie px-3 py-2 text-sm text-tinta-medio hover:bg-realce disabled:opacity-50';
const CONTROL =
  'min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-2 text-sm focus:border-acento-borde focus:outline-none disabled:opacity-50';

const cant = (v: string | null) => (v === null ? '—' : cantidad(v));

/**
 * Un conteo físico (F2-123): la captura (pensada para el celular en el almacén) mientras está en
 * captura, y el reporte de diferencias contra el teórico cuando se cierra. Lo capturado se guarda
 * primero en este dispositivo y luego en el servidor: bloquear la pantalla o perder la red no
 * pierde nada. Nada de esto ajusta SoftRestaurant.
 */
export function ConteoCaptura() {
  const { id = '' } = useParams();
  const filtro = useFiltroAlcance();
  const [parametros] = useSearchParams();
  const consulta = useConteo(filtro?.empresaId ?? null, id);
  return (
    <Vista titulo="Conteo físico">
      <p className="mb-4 text-sm">
        <Link
          className="text-acento-texto underline"
          to={{ pathname: '/conteos', search: queryVista(parametros) }}
        >
          ← Conteos físicos
        </Link>
        {' · '}
        <Link
          className="text-acento-texto underline"
          to={{ pathname: '/conteos/ayuda', search: queryVista(parametros) }}
        >
          Cómo se hace un conteo
        </Link>
      </p>
      {filtro === null ? (
        <Esqueleto lineas={6} />
      ) : (
        <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={6} />}>
          {(d) => (
            // Un conteo (o empresa) distinto es un montaje nuevo: su propio borrador y envío.
            <Detalle
              key={`${filtro.empresaId}:${d.conteo.id}`}
              d={d}
              empresaId={filtro.empresaId}
            />
          )}
        </SegunEstado>
      )}
    </Vista>
  );
}

function Detalle({ d, empresaId }: { d: ConteoDetalle; empresaId: string }) {
  const usuario = useUsuario();
  const esAdmin = ROLES_ADMIN.includes(usuario.rol);
  const c = d.conteo;
  const captura = useCapturaConteo({ usuarioId: usuario.id, empresaId, conteoId: c.id });
  const enCaptura = c.estado === 'en_captura';
  return (
    <>
      <Tarjeta titulo={`Conteo #${c.folio}`}>
        <dl className="grid gap-1 text-sm sm:grid-cols-2" data-testid="conteo-cabecera">
          <div>
            <dt className="inline text-tinta-suave">Almacén: </dt>
            <dd className="inline">
              {nombreAlmacenConteo(c)} · {c.sucursal}
            </dd>
          </div>
          <div>
            <dt className="inline text-tinta-suave">Artículos: </dt>
            <dd className="inline">{alcanceConteo(c)}</dd>
          </div>
          <div>
            <dt className="inline text-tinta-suave">Estado: </dt>
            <dd className="inline" data-testid="conteo-estado">
              {TEXTO_ESTADO_CONTEO[c.estado]}
            </dd>
          </div>
          <div>
            <dt className="inline text-tinta-suave">Teórico: </dt>
            <dd className="inline">
              lectura del POS del {horaEn(d.zonaHoraria, c.teoricoCapturadoAt)}
            </dd>
          </div>
          {c.nota && (
            <div className="sm:col-span-2">
              <dt className="inline text-tinta-suave">Nota: </dt>
              <dd className="inline">{c.nota}</dd>
            </div>
          )}
        </dl>
        {c.teoricoAtrasado && (
          <p className="mt-2 text-sm text-tinta-medio">
            La lectura que sirve de teórico tenía más de 90 minutos al crear el conteo: lo que pasó
            en el almacén después no está en ella.
          </p>
        )}
        {c.estado === 'cancelado' && (
          <p className="mt-2 text-sm text-tinta-medio">
            Este conteo se canceló: su reporte no es válido para ajustar.
          </p>
        )}
      </Tarjeta>
      <AvisoEnvio
        envio={captura.envio}
        pendientes={captura.pendientes}
        descartar={captura.descartar}
      />
      {enCaptura ? (
        <>
          <Captura
            d={d}
            editable={esAdmin}
            borrador={captura.borrador}
            capturar={captura.capturar}
          />
          {esAdmin && (
            <Terminar
              d={d}
              empresaId={empresaId}
              pendientes={captura.pendientes}
              enviar={captura.enviar}
            />
          )}
        </>
      ) : (
        <Reporte d={d} />
      )}
    </>
  );
}

function AvisoEnvio({
  envio,
  pendientes,
  descartar,
}: {
  envio: EstadoEnvio;
  pendientes: number;
  descartar: () => void;
}) {
  if (envio.tipo === 'rechazado') {
    return (
      <div role="alert" className="mt-4 rounded-md border border-linea-fuerte p-3 text-sm">
        <p className="text-peligro">{envio.mensaje}</p>
        <p className="mt-1 text-tinta-medio">
          {pendientes} valor(es) capturado(s) en este dispositivo no llegaron al servidor.
        </p>
        <button type="button" className={`${BOTON} mt-2`} onClick={descartar}>
          Descartar lo no enviado
        </button>
      </div>
    );
  }
  if (envio.tipo === 'sin-red') {
    return (
      <p role="status" className="mt-4 text-sm text-tinta-medio" data-testid="conteo-envio">
        {envio.mensaje} ({pendientes} pendiente(s))
      </p>
    );
  }
  return (
    <p role="status" className="mt-4 text-sm text-tinta-tenue" data-testid="conteo-envio">
      {envio.tipo === 'enviando' || pendientes > 0
        ? `Guardando ${pendientes} valor(es)…`
        : 'Todo lo capturado está guardado.'}
    </p>
  );
}

function Captura({
  d,
  editable,
  borrador,
  capturar,
}: {
  d: ConteoDetalle;
  editable: boolean;
  borrador: Borrador;
  capturar: (insumo: string, valor: string | null) => void;
}) {
  const [q, setQ] = useState('');
  // "Sólo sin contar" fija la lista al activarse: un renglón no desaparece mientras se teclea.
  const [soloSinContar, setSoloSinContar] = useState<ReadonlySet<string> | null>(null);
  const valorDe = (p: PartidaConteo) =>
    p.insumoOrigenSrId in borrador ? borrador[p.insumoOrigenSrId] : p.contado;
  const contados = d.partidas.filter((p) => valorDe(p) !== null).length;
  let filas = buscar(d.partidas, q);
  if (soloSinContar) filas = filas.filter((p) => soloSinContar.has(p.insumoOrigenSrId));
  return (
    <Tarjeta titulo="Captura" className="mt-4">
      <p className="mb-2 text-sm" data-testid="conteo-avance">
        {contados} de {d.partidas.length} artículos contados
      </p>
      <p className="mb-3 text-xs text-tinta-tenue">
        Cuenta lo que ves: el teórico no se muestra mientras se captura, para no influir en el
        conteo. Deja vacío lo que no contaste (no es lo mismo que 0).
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="search"
          className={`${CONTROL} flex-1`}
          placeholder="Buscar por nombre o clave"
          aria-label="Buscar artículo"
          value={q}
          onChange={(e) => setQ(e.target.value.slice(0, 100))}
        />
        <label className="flex items-center gap-2 text-sm text-tinta-suave">
          <input
            type="checkbox"
            checked={soloSinContar !== null}
            onChange={(e) =>
              setSoloSinContar(
                e.target.checked
                  ? new Set(
                      d.partidas.filter((p) => valorDe(p) === null).map((p) => p.insumoOrigenSrId),
                    )
                  : null,
              )
            }
          />
          Sólo sin contar
        </label>
      </div>
      {filas.length === 0 ? (
        <p className="text-sm text-tinta-suave">Ningún artículo con esa búsqueda.</p>
      ) : (
        <ul className="divide-y divide-linea">
          {filas.map((p) => (
            <RenglonCaptura
              key={p.insumoOrigenSrId}
              p={p}
              valor={valorDe(p)}
              pendiente={p.insumoOrigenSrId in borrador}
              editable={editable}
              capturar={capturar}
            />
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}

function RenglonCaptura({
  p,
  valor,
  pendiente,
  editable,
  capturar,
}: {
  p: PartidaConteo;
  valor: string | null;
  pendiente: boolean;
  editable: boolean;
  capturar: (insumo: string, valor: string | null) => void;
}) {
  // Lo tecleado se guarda como texto mientras no sea válido; lo válido va al borrador.
  const [texto, setTexto] = useState(valor === null ? '' : cantidad(valor));
  const [error, setError] = useState<string | null>(null);
  const [previo, setPrevio] = useState(valor);
  if (previo !== valor) {
    setPrevio(valor);
    // Sólo si el valor cambió por fuera (el servidor, otro renglón): lo que se está tecleando
    // ("1.50" mientras se escribe) no se reescribe.
    const tecleado = leerCantidad(texto);
    if (!(tecleado.ok && mismaCantidad(tecleado.valor, valor))) {
      setTexto(valor === null ? '' : cantidad(valor));
      setError(null);
    }
  }
  const nombre = nombreArticulo(p);
  return (
    <li className="flex flex-wrap items-center gap-3 py-2" data-insumo={p.insumoOrigenSrId}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{nombre}</p>
        <p className="text-xs text-tinta-tenue">
          {[p.clave, p.unidad ?? 'Sin unidad'].filter(Boolean).join(' · ')}
        </p>
      </div>
      {editable ? (
        <div className="flex flex-col items-end">
          <input
            className={`${CONTROL} w-28 text-right text-base`}
            inputMode="decimal"
            autoComplete="off"
            aria-label={`Contado de ${nombre}`}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              const l = leerCantidad(e.target.value);
              if (l.ok) {
                setError(null);
                capturar(p.insumoOrigenSrId, l.valor);
              } else {
                setError(l.error);
              }
            }}
          />
          <span className="text-xs text-tinta-tenue" data-testid="renglon-estado">
            {error ? (
              <span className="text-peligro">{error}</span>
            ) : pendiente ? (
              'Pendiente de guardar'
            ) : valor === null ? (
              'Sin contar'
            ) : (
              'Guardado'
            )}
          </span>
        </div>
      ) : (
        <span className="text-sm tabular-nums">{valor === null ? 'Sin contar' : cant(valor)}</span>
      )}
    </li>
  );
}

function Terminar({
  d,
  empresaId,
  pendientes,
  enviar,
}: {
  d: ConteoDetalle;
  empresaId: string;
  pendientes: number;
  enviar: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirmando, setConfirmando] = useState<'cerrar' | 'cancelar' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const sinContar = d.partidas.length - d.conteo.contados;

  async function terminar(que: 'cerrar' | 'cancelar') {
    setEnviando(true);
    setError(null);
    try {
      await terminarConteo(empresaId, d.conteo.id, que);
      await queryClient.invalidateQueries({ queryKey: llaveConteos });
      setConfirmando(null);
    } catch (e) {
      setError(
        e instanceof ErrorApi && e.status === 409
          ? 'El conteo ya no está en captura. Recarga la página.'
          : 'No se pudo. Intenta de nuevo.',
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Tarjeta titulo="Terminar" className="mt-4">
      {pendientes > 0 ? (
        <div className="text-sm">
          <p>
            Hay {pendientes} valor(es) que todavía no llegan al servidor: espera a que se guarden
            antes de cerrar.
          </p>
          <button type="button" className={`${BOTON} mt-2`} onClick={enviar}>
            Reintentar ahora
          </button>
        </div>
      ) : confirmando === null ? (
        <div className="flex flex-wrap gap-3">
          <button type="button" className={BOTON} onClick={() => setConfirmando('cerrar')}>
            Cerrar conteo
          </button>
          <button type="button" className={BOTON} onClick={() => setConfirmando('cancelar')}>
            Cancelar conteo
          </button>
        </div>
      ) : (
        <div className="text-sm" data-testid="conteo-confirmar">
          <p>
            {confirmando === 'cerrar'
              ? `¿Cerrar el conteo? Ya no se podrá capturar.${
                  sinContar > 0
                    ? ` ${sinContar} artículo(s) sin contar se reportarán aparte (no como 0).`
                    : ''
                }`
              : '¿Cancelar el conteo? Queda visible, pero su reporte no sirve para ajustar.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              className={BOTON}
              disabled={enviando}
              onClick={() => void terminar(confirmando)}
            >
              {confirmando === 'cerrar' ? 'Sí, cerrar' : 'Sí, cancelar'}
            </button>
            <button type="button" className={BOTON} onClick={() => setConfirmando(null)}>
              No
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-peligro">
          {error}
        </p>
      )}
    </Tarjeta>
  );
}

function Reporte({ d }: { d: ConteoDetalle }) {
  const t = d.totales;
  const [errorCsv, setErrorCsv] = useState<string | null>(null);
  const conDiferencia = d.partidas.filter((p) => p.estado === 'con_diferencia');
  const sinContar = d.partidas.filter((p) => p.estado === 'sin_contar');
  const sinTeorico = d.partidas.filter((p) => p.estado === 'sin_teorico');
  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="conteo-kpis">
        <Kpi titulo="Faltante" valor={pesos(t.faltante)} id="faltante" />
        <Kpi titulo="Sobrante" valor={pesos(t.sobrante)} id="sobrante" />
        <Kpi titulo="Neto" valor={pesos(t.neto)} id="neto" />
        <Kpi titulo="Contados" valor={`${t.contados} de ${t.articulos}`} id="contados" />
      </div>
      <Tarjeta titulo="Diferencias contra el teórico" className="mt-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-tinta-suave">
            {t.conDiferencia} con diferencia · {t.sinContar} sin contar · {t.sinTeorico} sin teórico
            {t.sinValuar > 0 ? ` · ${t.sinValuar} sin valuar` : ''}
          </p>
          <button
            type="button"
            className={BOTON}
            onClick={() => {
              try {
                setErrorCsv(null);
                descargar(nombreCsvConteo(d), conteoACsv(d));
              } catch (e) {
                setErrorCsv(e instanceof ErrorCsv ? e.message : 'No se pudo generar el CSV.');
              }
            }}
          >
            Descargar CSV
          </button>
        </div>
        {errorCsv && (
          <p role="alert" className="mb-2 text-sm text-peligro">
            {errorCsv}
          </p>
        )}
        {conDiferencia.length === 0 ? (
          <p className="text-sm">Todo lo contado cuadra con el teórico.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-tinta-suave">
                <tr>
                  <th scope="col" className={TH}>
                    Artículo
                  </th>
                  <th scope="col" className={TH}>
                    Unidad
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Teórico
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Contado
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Diferencia
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Importe
                  </th>
                </tr>
              </thead>
              <tbody>
                {conDiferencia.map((p) => (
                  <tr
                    key={p.insumoOrigenSrId}
                    className="border-t border-linea"
                    data-insumo={p.insumoOrigenSrId}
                  >
                    <td className={TD}>
                      {nombreArticulo(p)}
                      {p.clave && (
                        <span className="ml-1 text-xs text-tinta-tenue">({p.clave})</span>
                      )}
                    </td>
                    <td className={TD}>{p.unidad ?? 'Sin dato'}</td>
                    <td className={NUM}>{cant(p.teorico)}</td>
                    <td className={NUM}>{cant(p.contado)}</td>
                    <td className={NUM}>{cant(p.diferencia)}</td>
                    <td className={NUM}>{p.importe === null ? 'Sin valuar' : pesos(p.importe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>
      <Aparte
        titulo="Sin contar"
        partidas={sinContar}
        nota="No se contaron: no se reportan como 0."
      />
      <Aparte
        titulo={TEXTO_RENGLON.sin_teorico}
        partidas={sinTeorico}
        nota="Se contaron, pero la lectura del POS no los traía: no hay con qué compararlos."
      />
    </>
  );
}

function Kpi({ titulo, valor, id }: { titulo: string; valor: string; id: string }) {
  return (
    <Tarjeta titulo={titulo}>
      <p className="text-lg font-semibold tabular-nums" data-testid={`kpi-${id}`}>
        {valor}
      </p>
    </Tarjeta>
  );
}

function Aparte({
  titulo,
  partidas,
  nota,
}: {
  titulo: string;
  partidas: PartidaConteo[];
  nota: string;
}) {
  if (partidas.length === 0) return null;
  return (
    <Tarjeta titulo={`${titulo} (${partidas.length})`} className="mt-4">
      <p className="mb-2 text-xs text-tinta-tenue">{nota}</p>
      <ul className="text-sm" data-testid={`aparte-${partidas[0].estado}`}>
        {partidas.map((p) => (
          <li key={p.insumoOrigenSrId}>
            {nombreArticulo(p)}
            {p.contado !== null && ` · contado ${cant(p.contado)}`}
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}
