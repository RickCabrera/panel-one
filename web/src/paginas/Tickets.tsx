import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';

import { ErrorApi } from '../api/cliente';
import type { Sucursal } from '../api/tipos';
import { useAlcance } from '../filtros/alcance';
import {
  escribirFiltros,
  escribirFolio,
  escribirOrden,
  escribirPagina,
  hayFiltros,
  leerFiltros,
  leerFolio,
  leerOrden,
  leerPagina,
  MAX_LARGO_FOLIO,
  paginasDe,
  PARAM_FOLIO,
  PARAM_PAGINA,
  SIN_FILTROS,
  type FiltrosTickets,
  type OrdenTickets,
} from '../filtros/tickets';
import { usePeriodo } from '../filtros/usePeriodo';
import { useAnalisis } from './analisis/consultas';
import type { Filtro } from './inicio/consultas';
import { Esqueleto, Vacio } from './inicio/Tarjeta';
import { parametrosDe, POR_PAGINA, useTickets, type ParametrosTickets } from './tickets/consultas';
import { ErrorCsv, nombreArchivo, ticketsACsv } from './tickets/csv';
import { descargar, ErrorExport, exportarTickets } from './tickets/exportar';
import { FiltrosTicketsForm } from './tickets/Filtros';
import { activos } from './tickets/reglasFiltros';
import { TablaTickets } from './tickets/Tabla';
import { Vista } from './Vista';

/** Zona de presentación cuando no hay una sucursal elegida (CLAUDE.md: America/Mexico_City). */
const ZONA_PRESENTACION = 'America/Mexico_City';

/** `HH:MM:SS` de un instante en una zona. */
function horaEn(zona: string, instante: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: zona,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instante));
}

const BOTON =
  'rounded-md border border-linea-fuerte bg-superficie px-3 py-1 text-sm text-tinta-medio hover:bg-realce disabled:opacity-50';

function mensajeDe(error: unknown): string {
  if (error instanceof ErrorApi || error instanceof ErrorCsv || error instanceof ErrorExport) {
    return error.message;
  }
  return 'Error inesperado.';
}

/**
 * Al cambiar de empresa o sucursal (el selector del topbar no sabe de páginas) la
 * página vuelve a 1. Mientras la URL no se corrige NO se consulta: si no, saldría
 * un request con la página vieja del alcance anterior y, por un instante, "esta
 * página no existe". En la primera carga no se reinicia: un deep-link a la
 * página 3 abre la página 3.
 */
function useAlcanceEstable(clave: string | null, pagina: number): boolean {
  const [, setParametros] = useSearchParams();
  const [claveVista, setClaveVista] = useState<string | null>(null);
  const [reiniciando, setReiniciando] = useState(false);

  // Ajuste de estado durante el render (patrón de React para "estado derivado de
  // una prop que cambió"): así el render con el alcance nuevo ya sabe que no debe
  // consultar, sin esperar a un efecto.
  if (clave !== null && clave !== claveVista) {
    setClaveVista(clave);
    if (claveVista !== null && pagina > 1) setReiniciando(true);
  }
  if (reiniciando && pagina === 1) setReiniciando(false);

  useEffect(() => {
    if (!reiniciando) return;
    setParametros(
      (previos) => {
        const nuevos = new URLSearchParams(previos);
        nuevos.delete(PARAM_PAGINA);
        return nuevos;
      },
      { replace: true },
    );
  }, [reiniciando, setParametros]);

  return clave !== null && clave === claveVista && !reiniciando;
}

type EstadoExport =
  | { fase: 'inactivo' }
  | { fase: 'exportando'; hechos: number; total: number | null }
  /** Lo que de verdad llevó el archivo: su conteo y hasta cuándo llega (F2-222). */
  | { fase: 'hecho'; filas: number; corte: string }
  | { fase: 'error'; mensaje: string };

function useExportar(sucursales: ReadonlyMap<string, Sucursal>) {
  const [estado, setEstado] = useState<EstadoExport>({ fase: 'inactivo' });
  const controlador = useRef<AbortController | null>(null);

  // Salir de la vista corta el export en curso.
  useEffect(() => () => controlador.current?.abort(), []);

  const exportar = useCallback(
    async (parametros: ParametrosTickets, nombre: string) => {
      controlador.current?.abort();
      const actual = new AbortController();
      controlador.current = actual;
      setEstado({ fase: 'exportando', hechos: 0, total: null });
      let corte = '';
      try {
        const tickets = await exportarTickets(parametros, {
          signal: actual.signal,
          onProgreso: (hechos, total) => setEstado({ fase: 'exportando', hechos, total }),
          onCorte: (c) => {
            corte = c;
          },
        });
        descargar(nombre, ticketsACsv(tickets, sucursales));
        setEstado({ fase: 'hecho', filas: tickets.length, corte });
      } catch (error) {
        if (actual.signal.aborted) {
          setEstado({ fase: 'inactivo' });
          return;
        }
        setEstado({ fase: 'error', mensaje: mensajeDe(error) });
      } finally {
        if (controlador.current === actual) controlador.current = null;
      }
    },
    [sucursales],
  );

  const cancelar = useCallback(() => controlador.current?.abort(), []);

  return { estado, exportar, cancelar };
}

function BuscadorFolio({ folio, onBuscar }: { folio: string; onBuscar: (folio: string) => void }) {
  const [texto, setTexto] = useState(folio);
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    onBuscar(texto);
  };
  return (
    <form role="search" onSubmit={enviar} className="flex min-w-0 items-center gap-2">
      <label className="flex min-w-0 items-center gap-2 text-sm">
        Folio
        <input
          type="search"
          value={texto}
          maxLength={MAX_LARGO_FOLIO}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Empieza con…"
          className="w-36 min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-1 text-sm focus:border-acento-borde focus:outline-none"
        />
      </label>
      <button type="submit" className={BOTON}>
        Buscar
      </button>
      {folio && (
        <button
          type="button"
          className={BOTON}
          onClick={() => {
            setTexto('');
            onBuscar('');
          }}
        >
          Limpiar
        </button>
      )}
    </form>
  );
}

export function Tickets() {
  const { empresa, sucursal, sucursalId, sucursales } = useAlcance();
  const [parametros, setParametros] = useSearchParams();
  const folio = leerFolio(parametros);
  const pagina = leerPagina(parametros);
  const filtros = leerFiltros(parametros);
  const orden = leerOrden(parametros);
  // El selector de periodo está en la cabecera (F2-212), y cambiarlo ya vuelve a la
  // página 1 (`escribirPeriodo`).
  const { rango } = usePeriodo();

  // La misma condición que el dashboard: alcance validado y zona conocida.
  const filtro: Filtro | null =
    empresa && !sucursales.isPending && (!sucursalId || sucursal)
      ? { empresaId: empresa.id, sucursalId: sucursal?.id }
      : null;
  const estable = useAlcanceEstable(
    filtro && `${filtro.empresaId}|${filtro.sucursalId ?? ''}`,
    pagina,
  );
  const consultaParams = estable ? parametrosDe(filtro, rango, folio, filtros, orden) : null;
  const consulta = useTickets(consultaParams, pagina);

  // Las opciones del filtro de mesero: los del alcance y periodo, sin repetir (dos sucursales
  // pueden tener una "Ana") y sin "Sin mesero", que el filtro exacto no puede pedir.
  const meseros = useAnalisis('por-mesero', filtro, rango, false);
  const nombresMeseros = useMemo(
    () =>
      meseros.data
        ? [...new Set(meseros.data.flatMap((m) => (m.mesero ? [m.mesero] : [])))].sort((a, b) =>
            a.localeCompare(b, 'es-MX'),
          )
        : null,
    [meseros.data],
  );

  const porId = useMemo(
    () => new Map((sucursales.data ?? []).map((s) => [s.id, s] as const)),
    [sucursales.data],
  );
  const { estado: exportacion, exportar, cancelar } = useExportar(porId);

  const buscar = useCallback(
    (texto: string) => setParametros((previos) => escribirFolio(previos, texto)),
    [setParametros],
  );
  const irA = useCallback(
    (n: number) => setParametros((previos) => escribirPagina(previos, n)),
    [setParametros],
  );
  const aplicar = useCallback(
    (nuevos: FiltrosTickets) => setParametros((previos) => escribirFiltros(previos, nuevos)),
    [setParametros],
  );
  const ordenar = useCallback(
    (nuevo: OrdenTickets) => setParametros((previos) => escribirOrden(previos, nuevo)),
    [setParametros],
  );
  const limpiarTodo = useCallback(
    () =>
      setParametros((previos) => {
        const nuevos = escribirFiltros(previos, SIN_FILTROS);
        nuevos.delete(PARAM_FOLIO);
        return nuevos;
      }),
    [setParametros],
  );
  const conFiltros = hayFiltros(filtros);
  const zonaCorte = sucursal?.zonaHoraria ?? ZONA_PRESENTACION;

  const datos = consulta.data;
  const cambiandoPagina = consulta.isPlaceholderData;
  const paginas = datos ? paginasDe(datos.total, POR_PAGINA) : 1;
  const exportando = exportacion.fase === 'exportando';

  return (
    <Vista titulo="Tickets">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-end">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <BuscadorFolio key={folio} folio={folio} onBuscar={buscar} />
          {exportando ? (
            <>
              <span className="text-sm text-tinta-suave" role="status">
                {exportacion.total === null
                  ? 'Exportando…'
                  : `Exportando ${exportacion.hechos.toLocaleString('es-MX')} de ${exportacion.total.toLocaleString('es-MX')}…`}
              </span>
              <button type="button" className={BOTON} onClick={cancelar}>
                Cancelar
              </button>
            </>
          ) : (
            <button
              type="button"
              className={BOTON}
              disabled={consultaParams === null || !datos || cambiandoPagina || datos.total === 0}
              onClick={() => {
                if (consultaParams === null) return;
                void exportar(
                  consultaParams,
                  nombreArchivo(consultaParams.desde, consultaParams.hasta, sucursal?.nombre),
                );
              }}
            >
              {datos && !cambiandoPagina
                ? `Exportar CSV · ${datos.total.toLocaleString('es-MX')} ${datos.total === 1 ? 'ticket' : 'tickets'}`
                : 'Exportar CSV'}
            </button>
          )}
        </div>
      </div>
      {/* El conteo de arriba es el de la lista; el archivo usa un corte de 30 s antes de
          pedirlo (F2-203), así que lo recién llegado puede no entrar. Se dice aquí y, al
          terminar, cuántos llevó de verdad. */}
      <p className="mt-2 text-xs text-tinta-tenue">
        El CSV lleva exactamente los tickets de los filtros de abajo, recibidos hasta 30 segundos
        antes de exportar: lo que llegue en esos segundos puede no entrar.
      </p>
      {exportacion.fase === 'hecho' && (
        <p role="status" data-testid="exportados" className="mt-1 text-sm text-tinta-suave">
          Se exportaron {exportacion.filas.toLocaleString('es-MX')}{' '}
          {exportacion.filas === 1 ? 'ticket' : 'tickets'}, recibidos hasta las{' '}
          {horaEn(zonaCorte, exportacion.corte)}.
        </p>
      )}
      {exportacion.fase === 'error' && (
        <p role="alert" className="mt-2 text-sm text-peligro">
          No se pudo exportar. {exportacion.mensaje}
        </p>
      )}

      <div className="mt-4 min-w-0">
        <FiltrosTicketsForm
          key={JSON.stringify(filtros)}
          filtros={filtros}
          meseros={nombresMeseros}
          onAplicar={aplicar}
        />
        {conFiltros && (
          <ul aria-label="Filtros activos" className="mt-2 flex min-w-0 flex-wrap gap-2 text-xs">
            {activos(filtros).map(({ llave, texto }) => (
              <li
                key={llave}
                className="flex items-center gap-1 rounded-full border border-linea-fuerte bg-realce px-2 py-0.5 text-tinta-medio"
              >
                <span className="break-all">{texto}</span>
                <button
                  type="button"
                  aria-label={`Quitar ${texto}`}
                  onClick={() => aplicar({ ...filtros, [llave]: SIN_FILTROS[llave] })}
                  className="rounded px-1 hover:bg-realce-fuerte"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 min-w-0">
        {rango === null ? (
          <p className="text-sm text-tinta-tenue">
            Corrige el rango de fechas para ver los tickets.
          </p>
        ) : consulta.isError ? (
          <p role="alert" className="py-6 text-center text-sm text-peligro">
            No se pudieron cargar los tickets. {mensajeDe(consulta.error)}
          </p>
        ) : !datos ? (
          <Esqueleto lineas={6} />
        ) : datos.total === 0 ? (
          <Vacio>
            {conFiltros ? (
              <>
                <span className="block">Ningún ticket del periodo cumple los filtros.</span>
                <button type="button" className={`${BOTON} mt-2`} onClick={limpiarTodo}>
                  Quitar filtros
                </button>
              </>
            ) : folio ? (
              `Ningún ticket del periodo tiene un folio que empiece con "${folio}".`
            ) : (
              'No hay tickets en este periodo.'
            )}
          </Vacio>
        ) : datos.items.length === 0 ? (
          <div className="py-6 text-center text-sm text-tinta-tenue">
            <p>Esta página ya no tiene tickets.</p>
            <button type="button" className={`${BOTON} mt-2`} onClick={() => irA(paginas)}>
              Ir a la última página
            </button>
          </div>
        ) : (
          <>
            <TablaTickets
              tickets={datos.items}
              sucursales={porId}
              mostrarSucursal={!sucursalId}
              atenuada={cambiandoPagina}
              orden={orden}
              onOrdenar={ordenar}
            />
            <nav
              aria-label="Paginación"
              className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-tinta-suave"
            >
              <span data-testid="conteo">
                {datos.total.toLocaleString('es-MX')} {datos.total === 1 ? 'ticket' : 'tickets'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={BOTON}
                  disabled={pagina <= 1 || cambiandoPagina}
                  onClick={() => irA(pagina - 1)}
                >
                  Anterior
                </button>
                <span data-testid="pagina">
                  Página {pagina.toLocaleString('es-MX')} de {paginas.toLocaleString('es-MX')}
                </span>
                <button
                  type="button"
                  className={BOTON}
                  disabled={pagina >= paginas || cambiandoPagina}
                  onClick={() => irA(pagina + 1)}
                >
                  Siguiente
                </button>
              </div>
            </nav>
          </>
        )}
      </div>
    </Vista>
  );
}
