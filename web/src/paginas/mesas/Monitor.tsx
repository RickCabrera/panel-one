import { memo, useMemo, type ReactNode } from 'react';

import type { MesasSucursal } from '../../api/tipos';
import { formatearPesos } from '../../dinero/dinero';
import { horaEn } from '../../filtros/periodo';
import { Tarjeta } from '../inicio/Tarjeta';
import { edadLegible } from '../inicio/ventaEnVivo';
import { useConReloj } from './consultas';
import { filtrarMesas, ordenarMesas, type EstadoMesas, type OrdenMesas } from './orden';
import {
  armarMonitor,
  estadosSucursales,
  minutosDesde,
  requiereAtencion,
  semaforo,
  type Frescura,
  type MesaViva,
  type Semaforo,
} from './reglas';
import { nombreMesa, TEXTO_SEMAFORO } from './textos';
import type { MonitorVivo } from './vivo';

/** Cuántas partidas se ven en la tarjeta antes del "n partidas más". */
export const PARTIDAS_VISIBLES = 3;

/**
 * Normal: la vista con menú. Pared (F2-223): pantalla colgada, se lee a 2 m. Criterio
 * tipográfico, no verificado a ojo: ningún texto de la pared baja de `text-2xl` (24 px);
 * lo principal (mesa, minutos, cifras) va en `text-4xl`/`text-5xl`.
 */
export type Variante = 'normal' | 'pared';

/** Lo que el Monitor necesita saber de la respuesta para lo que sí depende del reloj. */
export interface Respuesta {
  filas: readonly MesasSucursal[];
  respuestaAt: number;
}

function Cifra({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <p data-testid={testId} className="text-2xl font-semibold tabular-nums text-tinta">
      {children}
    </p>
  );
}

const COLOR_FRESCURA: Record<Frescura, string> = {
  fresca: 'text-exito',
  demorada: 'text-aviso',
  desconectada: 'text-peligro',
};

const TEXTO_FRESCURA: Record<Frescura, string> = {
  fresca: 'al día',
  demorada: 'con retraso',
  desconectada: 'sin lectura reciente',
};

/** Cuántas mesas requieren atención AHORA: sólo se pinta cuando el conteo cambia. */
function useAtencion(mesas: readonly MesaViva[]): number {
  return useConReloj((ahora) => mesas.filter((m) => requiereAtencion(m, ahora)).length);
}

function textoSinHora(n: number): string {
  return n === 1 ? '1 mesa sin hora de apertura legible.' : `${n} mesas sin hora de apertura legible.`;
}

export function TarjetasKpi({
  monitor,
  respuesta,
  zona,
  filtroAtencion,
  onAtencion,
}: {
  monitor: MonitorVivo;
  respuesta: Respuesta;
  zona: string;
  filtroAtencion: boolean;
  onAtencion: () => void;
}) {
  const sinContar =
    monitor.excluidas.length > 0 ? `Sin contar: ${monitor.excluidas.join(', ')}.` : null;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tarjeta titulo="Mesas abiertas">
        <Cifra testId="kpi-mesas">{monitor.mesas.length}</Cifra>
        <p className="text-sm text-tinta-tenue">
          En curso:{' '}
          <span data-testid="kpi-en-curso" className="font-medium text-tinta-medio">
            {monitor.enCurso === null ? 'Sin dato' : formatearPesos(monitor.enCurso)}
          </span>
        </p>
        {monitor.enCurso === null && (
          <p className="mt-1 text-xs text-tinta-tenue">
            Alguna mesa no trae un importe legible; no se muestra una suma incompleta.
          </p>
        )}
        {sinContar && <p className="mt-1 text-xs text-aviso">{sinContar}</p>}
      </Tarjeta>
      <Tarjeta titulo="Cuentas sin imprimir">
        <Cifra testId="kpi-sin-imprimir">
          {monitor.sinImprimir === null ? 'Sin dato' : monitor.sinImprimir}
        </Cifra>
        {monitor.sinImprimir === null && (
          <p className="text-xs text-tinta-tenue">
            Alguna mesa no dice si su cuenta ya se imprimió; no se muestra un conteo parcial.
          </p>
        )}
      </Tarjeta>
      <KpiAtencion
        mesas={monitor.mesas}
        sinHora={monitor.sinHora}
        activo={filtroAtencion}
        onClick={onAtencion}
      />
      <UltimaLectura respuesta={respuesta} zona={zona} />
    </div>
  );
}

/**
 * KPI "Atención requerida" (F2-223): tarjeta propia y botón. Activa el filtro "Sólo
 * atención", o lo quita si ya estaba.
 */
function KpiAtencion({
  mesas,
  sinHora,
  activo,
  onClick,
}: {
  mesas: readonly MesaViva[];
  sinHora: number;
  activo: boolean;
  onClick: () => void;
}) {
  const atencion = useAtencion(mesas);
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      title={activo ? 'Quitar el filtro de atención' : 'Mostrar sólo las mesas que requieren atención'}
      className={`min-w-0 rounded-lg border bg-superficie p-4 text-left shadow-sm hover:bg-realce focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento-borde ${
        atencion > 0 ? 'border-2 border-peligro-borde' : 'border-linea'
      } ${activo ? 'ring-2 ring-acento-borde' : ''}`}
    >
      <span className="block text-sm font-medium text-tinta-suave">Atención requerida</span>
      <span className="mt-2 block">
        <span
          data-testid="kpi-atencion"
          className={`block text-2xl font-semibold tabular-nums ${atencion > 0 ? 'text-peligro' : 'text-tinta'}`}
        >
          {atencion}
        </span>
        <span className="block text-sm text-tinta-tenue">
          Más de 60 min · {activo ? 'filtrando' : 'ver sólo ésas'}
        </span>
        {sinHora > 0 && (
          <span data-testid="kpi-sin-hora" className="block text-xs text-aviso">
            {textoSinHora(sinHora)}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * Regla (F1-094): la lectura más vieja de las sucursales que ENTRAN en las cifras, con
 * `armarMonitor`, igual que Inicio. Se calcula con el reloj, pero sólo se pinta cuando
 * el texto cambia (la edad va en minutos).
 */
function useUltimaLectura(respuesta: Respuesta) {
  const texto = useConReloj((ahora) => {
    const u = armarMonitor(respuesta.filas, respuesta.respuestaAt, ahora).kpis.ultimaLectura;
    return u === null ? '' : `${u.recibidoAt}|${u.frescura}|${edadLegible(u.edadSegundos)}`;
  });
  if (texto === '') return null;
  const [recibidoAt, frescura, edad] = texto.split('|');
  return { recibidoAt: Number(recibidoAt), frescura: frescura as Frescura, edad };
}

function UltimaLectura({ respuesta, zona }: { respuesta: Respuesta; zona: string }) {
  const lectura = useUltimaLectura(respuesta);
  return (
    <Tarjeta titulo="Última lectura">
      {lectura === null ? (
        <Cifra testId="kpi-lectura">—</Cifra>
      ) : (
        <>
          <p
            data-testid="kpi-lectura"
            data-frescura={lectura.frescura}
            className={`text-2xl font-semibold tabular-nums ${COLOR_FRESCURA[lectura.frescura]}`}
          >
            {horaEn(zona, lectura.recibidoAt)}
          </p>
          <p className="text-sm text-tinta-tenue">
            {lectura.edad} · {TEXTO_FRESCURA[lectura.frescura]}
          </p>
        </>
      )}
    </Tarjeta>
  );
}

/** KPIs de la pared: pocas cifras, enormes. */
export function KpisPared({ monitor }: { monitor: MonitorVivo }) {
  const atencion = useAtencion(monitor.mesas);
  return (
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="rounded-lg border border-linea bg-superficie p-4">
        <dt className="text-tinta-suave">Mesas abiertas</dt>
        <dd data-testid="kpi-mesas" className="text-5xl font-bold tabular-nums">
          {monitor.mesas.length}
        </dd>
      </div>
      <div
        className={`rounded-lg bg-superficie p-4 ${atencion > 0 ? 'border-4 border-peligro-borde' : 'border border-linea'}`}
      >
        <dt className="text-tinta-suave">Atención requerida</dt>
        <dd
          data-testid="kpi-atencion"
          className={`text-5xl font-bold tabular-nums ${atencion > 0 ? 'text-peligro' : ''}`}
        >
          {atencion}
        </dd>
        {monitor.sinHora > 0 && (
          <dd data-testid="kpi-sin-hora" className="text-aviso">
            {textoSinHora(monitor.sinHora)}
          </dd>
        )}
      </div>
      <div className="rounded-lg border border-linea bg-superficie p-4">
        <dt className="text-tinta-suave">Sin imprimir</dt>
        <dd data-testid="kpi-sin-imprimir" className="text-5xl font-bold tabular-nums">
          {monitor.sinImprimir === null ? 'Sin dato' : monitor.sinImprimir}
        </dd>
      </div>
    </dl>
  );
}

/**
 * Un aviso por sucursal que NO se está mostrando en vivo. La edad avanza con el reloj,
 * pero el componente sólo se pinta cuando cambia el texto.
 */
export function Avisos({
  respuesta,
  zona,
  variante = 'normal',
}: {
  respuesta: Respuesta;
  zona: string;
  variante?: Variante;
}) {
  const texto = useConReloj((ahora) =>
    JSON.stringify(
      estadosSucursales(respuesta.filas, respuesta.respuestaAt, ahora)
        .filter((s) => s.estado !== 'conectada')
        .map((s) => [
          s.sucursalId,
          s.nombre,
          s.estado,
          edadLegible(s.edadSegundos ?? 0),
          s.recibidoAt !== null && !Number.isNaN(s.recibidoAt) ? s.recibidoAt : null,
        ]),
    ),
  );
  const fuera = JSON.parse(texto) as Array<[string, string, string, string, number | null]>;
  if (fuera.length === 0) return null;
  const tamano = variante === 'pared' ? '' : 'text-sm';
  return (
    <div className="mt-4 flex flex-col gap-2">
      {fuera.map(([id, nombre, estado, edad, recibidoAt]) =>
        estado === 'desconectada' ? (
          <p
            key={id}
            role="alert"
            data-testid="banner-desconectada"
            className={`rounded-md border border-peligro-borde bg-peligro-fondo px-3 py-2 text-peligro ${tamano}`}
          >
            <strong>{nombre}: sucursal desconectada.</strong> Última lectura {edad}
            {recibidoAt !== null ? ` (${horaEn(zona, recibidoAt)})` : ''}. Sus mesas no se muestran
            hasta que vuelva a reportar.
          </p>
        ) : (
          <p
            key={id}
            role="status"
            data-testid="banner-sin-reporte"
            className={`rounded-md border border-linea-fuerte bg-fondo px-3 py-2 text-tinta-medio ${tamano}`}
          >
            <strong>{nombre}:</strong> todavía no llegan datos del agente.
          </p>
        ),
      )}
    </div>
  );
}

const BORDE: Record<Semaforo, string> = {
  ok: 'border-semaforo-ok',
  alerta: 'border-semaforo-alerta',
  rojo: 'border-semaforo-rojo',
  'sin-dato': 'border-semaforo-sin-dato',
};

/** Abre el detalle; `boton` es a donde vuelve el foco al cerrarlo. */
export type AbrirDetalle = (mesa: MesaViva, boton: HTMLButtonElement) => void;

interface PropsTarjeta {
  mesa: MesaViva;
  conSucursal: boolean;
  onAbrir?: AbrirDetalle;
}

/**
 * Una tarjeta sólo se vuelve a pintar si cambia lo que pinta (`firma`) o SU minuto (su
 * propio `useConReloj`): ni el reloj ni un poll con los mismos datos repintan las demás.
 */
const mismaTarjeta = (a: PropsTarjeta, b: PropsTarjeta) =>
  a.mesa.firma === b.mesa.firma && a.conSucursal === b.conSucursal && a.onAbrir === b.onAbrir;

function useMinutos(mesa: MesaViva) {
  const minutos = useConReloj((ahora) => minutosDesde(mesa.apertura, ahora));
  return { minutos, semaforo: semaforo(minutos) };
}

const TarjetaMesa = memo(function TarjetaMesa({ mesa, conSucursal, onAbrir }: PropsTarjeta) {
  const { minutos, semaforo: color } = useMinutos(mesa);
  const partidas = mesa.partidas ?? [];
  const resto = partidas.length - PARTIDAS_VISIBLES;
  const nombre = nombreMesa(mesa, conSucursal);
  return (
    <li
      aria-label={nombre}
      data-semaforo={color}
      className={`relative min-w-0 rounded-lg border-2 bg-superficie p-3 shadow-sm hover:bg-fondo ${BORDE[color]}`}
    >
      {/* Botón "estirado" sobre toda la tarjeta: un <button> no puede contener la
          lista de partidas, así que no envuelve el contenido. */}
      {onAbrir && (
        <button
          type="button"
          aria-label={`Ver consumo de ${nombre}`}
          onClick={(e) => onAbrir(mesa, e.currentTarget)}
          className="absolute inset-0 z-10 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento-borde"
        />
      )}
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="truncate text-lg font-semibold">{mesa.mesa ?? 'Sin dato'}</h3>
        <span className="shrink-0 font-semibold tabular-nums" data-testid="mesa-total">
          {mesa.total === null ? 'Sin dato' : formatearPesos(mesa.total)}
        </span>
      </div>
      {conSucursal && <p className="truncate text-xs text-tinta-tenue">{mesa.sucursal}</p>}
      <p className="truncate text-sm text-tinta-suave">{mesa.mesero ?? 'Mesero: sin dato'}</p>
      <p className="text-sm" data-testid="mesa-minutos">
        {minutos === null ? 'Tiempo: sin dato' : `${minutos} min`}
        <span className="sr-only"> · {TEXTO_SEMAFORO[color]}</span>
      </p>
      {mesa.partidas === null ? (
        <p className="mt-2 text-xs text-tinta-tenue">Partidas: sin dato</p>
      ) : (
        <ul className="mt-2 space-y-0.5 text-xs text-tinta-medio">
          {partidas.slice(0, PARTIDAS_VISIBLES).map((p, i) => (
            <li key={i} className="truncate">
              {p.cantidad === null ? '' : `${p.cantidad} × `}
              {p.producto ?? 'Sin dato'}
            </li>
          ))}
          {resto > 0 && (
            <li className="text-tinta-tenue">
              {resto === 1 ? '1 partida más' : `${resto} partidas más`}
            </li>
          )}
          {partidas.length === 0 && <li className="text-tinta-tenue">Sin partidas</li>}
        </ul>
      )}
    </li>
  );
}, mismaTarjeta);

/** La tarjeta de la pared: número, minutos, importe y mesero. Sin partidas ni clic. */
const TarjetaPared = memo(function TarjetaPared({ mesa, conSucursal }: PropsTarjeta) {
  const { minutos, semaforo: color } = useMinutos(mesa);
  const nombre = nombreMesa(mesa, conSucursal);
  return (
    <li
      aria-label={nombre}
      data-semaforo={color}
      className={`min-w-0 rounded-xl border-8 bg-superficie p-4 ${BORDE[color]}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="truncate text-5xl font-bold">{mesa.mesa ?? 'Sin dato'}</h3>
        <span className="shrink-0 text-4xl font-bold tabular-nums" data-testid="mesa-minutos">
          {minutos === null ? 'Sin hora' : `${minutos} min`}
          <span className="sr-only"> · {TEXTO_SEMAFORO[color]}</span>
        </span>
      </div>
      <p className="text-3xl font-semibold tabular-nums" data-testid="mesa-total">
        {mesa.total === null ? 'Sin dato' : formatearPesos(mesa.total)}
      </p>
      <p className="truncate text-tinta-suave">
        {mesa.mesero ?? 'Mesero: sin dato'}
        {conSucursal ? ` · ${mesa.sucursal}` : ''}
      </p>
    </li>
  );
}, mismaTarjeta);

/**
 * El grid, ordenado y filtrado. El orden no depende del reloj; el filtro "atención" sí,
 * pero el grid sólo se vuelve a pintar cuando una mesa entra o sale de él.
 */
export function GridMesas({
  mesas,
  orden,
  estado,
  conSucursal,
  sinHora,
  onAbrir,
  variante = 'normal',
}: {
  mesas: MesaViva[];
  orden: OrdenMesas;
  estado: EstadoMesas;
  conSucursal: boolean;
  sinHora: number;
  onAbrir?: AbrirDetalle;
  variante?: Variante;
}) {
  const clavesAtencion = useConReloj((ahora) =>
    estado === 'atencion'
      ? mesas
          .filter((m) => requiereAtencion(m, ahora))
          .map((m) => m.clave)
          .join('\n')
      : '',
  );
  const visibles = useMemo(
    () =>
      filtrarMesas(
        ordenarMesas(mesas, orden),
        estado,
        new Set(clavesAtencion === '' ? [] : clavesAtencion.split('\n')),
      ),
    [mesas, orden, estado, clavesAtencion],
  );

  if (visibles.length === 0) {
    return (
      <p
        className={`py-6 text-center text-tinta-tenue ${variante === 'pared' ? '' : 'text-sm'}`}
      >
        {vacio(mesas, estado, sinHora)}
      </p>
    );
  }
  const Tarjeta = variante === 'pared' ? TarjetaPared : TarjetaMesa;
  return (
    <ul
      aria-label="Mesas abiertas"
      className={
        variante === 'pared'
          ? 'grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
          : 'grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'
      }
    >
      {visibles.map((m) => (
        <Tarjeta key={m.clave} mesa={m} conSucursal={conSucursal} onAbrir={onAbrir} />
      ))}
    </ul>
  );
}

/** Por qué no hay tarjetas: sin mesas, o un filtro que no deja ninguna (y qué no mide). */
function vacio(mesas: readonly MesaViva[], estado: EstadoMesas, sinHora: number): string {
  if (mesas.length === 0 || estado === 'todas') return 'No hay mesas abiertas.';
  if (estado === 'atencion') {
    return sinHora > 0
      ? `Ninguna mesa requiere atención (${sinHora} sin hora de apertura: no se pueden medir).`
      : 'Ninguna mesa requiere atención.';
  }
  const sinDato = mesas.filter((m) => m.impreso === null).length;
  return sinDato > 0
    ? `Ninguna cuenta sin imprimir (${sinDato} no dicen si ya se imprimieron).`
    : 'Ninguna cuenta sin imprimir.';
}
