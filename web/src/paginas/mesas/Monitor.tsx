import type { ReactNode } from 'react';

import { formatearPesos } from '../../dinero/dinero';
import { horaEn } from '../../filtros/periodo';
import { Tarjeta } from '../inicio/Tarjeta';
import { edadLegible } from '../inicio/ventaEnVivo';
import type { Frescura, Kpis, MesaMonitor, Semaforo, SucursalMonitor } from './reglas';
import { nombreMesa, TEXTO_SEMAFORO } from './textos';

/** Cuántas partidas se ven en la tarjeta antes del "n partidas más". */
export const PARTIDAS_VISIBLES = 3;

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

export function TarjetasKpi({ kpis, zona }: { kpis: Kpis; zona: string }) {
  const sinContar = kpis.excluidas.length > 0 ? `Sin contar: ${kpis.excluidas.join(', ')}.` : null;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tarjeta titulo="Mesas abiertas">
        <Cifra testId="kpi-mesas">{kpis.mesas}</Cifra>
        <p className="text-sm text-tinta-tenue">
          En curso:{' '}
          <span data-testid="kpi-en-curso" className="font-medium text-tinta-medio">
            {kpis.enCurso === null ? 'Sin dato' : formatearPesos(kpis.enCurso)}
          </span>
        </p>
        {kpis.enCurso === null && (
          <p className="mt-1 text-xs text-tinta-tenue">
            Alguna mesa no trae un importe legible; no se muestra una suma incompleta.
          </p>
        )}
        {sinContar && <p className="mt-1 text-xs text-aviso">{sinContar}</p>}
      </Tarjeta>
      <Tarjeta titulo="Cuentas sin imprimir">
        <Cifra testId="kpi-sin-imprimir">
          {kpis.sinImprimir === null ? 'Sin dato' : kpis.sinImprimir}
        </Cifra>
        {kpis.sinImprimir === null && (
          <p className="text-xs text-tinta-tenue">
            Alguna mesa no dice si su cuenta ya se imprimió; no se muestra un conteo parcial.
          </p>
        )}
      </Tarjeta>
      <Tarjeta titulo="Atención >60 min">
        <Cifra testId="kpi-atencion">{kpis.atencion}</Cifra>
        {kpis.sinHora > 0 && (
          <p data-testid="kpi-sin-hora" className="text-xs text-aviso">
            {kpis.sinHora === 1
              ? '1 mesa sin hora de apertura legible.'
              : `${kpis.sinHora} mesas sin hora de apertura legible.`}
          </p>
        )}
      </Tarjeta>
      <Tarjeta titulo="Última lectura">
        {kpis.ultimaLectura === null ? (
          <Cifra testId="kpi-lectura">—</Cifra>
        ) : (
          <>
            <p
              data-testid="kpi-lectura"
              data-frescura={kpis.ultimaLectura.frescura}
              className={`text-2xl font-semibold tabular-nums ${COLOR_FRESCURA[kpis.ultimaLectura.frescura]}`}
            >
              {horaEn(zona, kpis.ultimaLectura.recibidoAt)}
            </p>
            <p className="text-sm text-tinta-tenue">
              {edadLegible(kpis.ultimaLectura.edadSegundos)} ·{' '}
              {TEXTO_FRESCURA[kpis.ultimaLectura.frescura]}
            </p>
          </>
        )}
      </Tarjeta>
    </div>
  );
}

/** Un aviso por sucursal que NO se está mostrando en vivo. */
export function Avisos({ sucursales, zona }: { sucursales: SucursalMonitor[]; zona: string }) {
  const fuera = sucursales.filter((s) => s.estado !== 'conectada');
  if (fuera.length === 0) return null;
  return (
    <div className="mt-4 flex flex-col gap-2">
      {fuera.map((s) =>
        s.estado === 'desconectada' ? (
          <p
            key={s.sucursalId}
            role="alert"
            data-testid="banner-desconectada"
            className="rounded-md border border-peligro-borde bg-peligro-fondo px-3 py-2 text-sm text-peligro"
          >
            <strong>{s.nombre}: sucursal desconectada.</strong> Última lectura{' '}
            {edadLegible(s.edadSegundos ?? 0)}
            {s.recibidoAt !== null && !Number.isNaN(s.recibidoAt)
              ? ` (${horaEn(zona, s.recibidoAt)})`
              : ''}
            . Sus mesas no se muestran hasta que vuelva a reportar.
          </p>
        ) : (
          <p
            key={s.sucursalId}
            role="status"
            data-testid="banner-sin-reporte"
            className="rounded-md border border-linea-fuerte bg-fondo px-3 py-2 text-sm text-tinta-medio"
          >
            <strong>{s.nombre}:</strong> todavía no llegan datos del agente.
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
export type AbrirDetalle = (mesa: MesaMonitor, boton: HTMLButtonElement) => void;

function TarjetaMesa({
  mesa,
  conSucursal,
  onAbrir,
}: {
  mesa: MesaMonitor;
  conSucursal: boolean;
  onAbrir: AbrirDetalle;
}) {
  const partidas = mesa.partidas ?? [];
  const resto = partidas.length - PARTIDAS_VISIBLES;
  const nombre = nombreMesa(mesa, conSucursal);
  return (
    <li
      aria-label={nombre}
      data-semaforo={mesa.semaforo}
      className={`relative min-w-0 rounded-lg border-2 bg-superficie p-3 shadow-sm hover:bg-fondo ${BORDE[mesa.semaforo]}`}
    >
      {/* Botón "estirado" sobre toda la tarjeta: un <button> no puede contener la
          lista de partidas, así que no envuelve el contenido. */}
      <button
        type="button"
        aria-label={`Ver consumo de ${nombre}`}
        onClick={(e) => onAbrir(mesa, e.currentTarget)}
        className="absolute inset-0 z-10 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento-borde"
      />
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="truncate text-lg font-semibold">{mesa.mesa ?? 'Sin dato'}</h3>
        <span className="shrink-0 font-semibold tabular-nums" data-testid="mesa-total">
          {mesa.total === null ? 'Sin dato' : formatearPesos(mesa.total)}
        </span>
      </div>
      {conSucursal && <p className="truncate text-xs text-tinta-tenue">{mesa.sucursal}</p>}
      <p className="truncate text-sm text-tinta-suave">{mesa.mesero ?? 'Mesero: sin dato'}</p>
      <p className="text-sm" data-testid="mesa-minutos">
        {mesa.minutos === null ? 'Tiempo: sin dato' : `${mesa.minutos} min`}
        <span className="sr-only"> · {TEXTO_SEMAFORO[mesa.semaforo]}</span>
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
}

export function GridMesas({
  mesas,
  conSucursal,
  onAbrir,
}: {
  mesas: MesaMonitor[];
  conSucursal: boolean;
  onAbrir: AbrirDetalle;
}) {
  if (mesas.length === 0) {
    return <p className="py-6 text-center text-sm text-tinta-tenue">No hay mesas abiertas.</p>;
  }
  return (
    <ul
      aria-label="Mesas abiertas"
      className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
    >
      {mesas.map((m) => (
        <TarjetaMesa key={m.clave} mesa={m} conSucursal={conSucursal} onAbrir={onAbrir} />
      ))}
    </ul>
  );
}
