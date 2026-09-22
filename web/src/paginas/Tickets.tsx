import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';

import { ErrorApi } from '../api/cliente';
import type { Sucursal } from '../api/tipos';
import { useAlcance } from '../filtros/alcance';
import {
  escribirPeriodo,
  leerPeriodo,
  rangoDe,
  zonaDelPanel,
  type Periodo,
} from '../filtros/periodo';
import {
  escribirFolio,
  escribirPagina,
  leerFolio,
  leerPagina,
  MAX_LARGO_FOLIO,
  paginasDe,
  PARAM_PAGINA,
} from '../filtros/tickets';
import { useHoy } from '../filtros/useHoy';
import type { Filtro } from './inicio/consultas';
import { SelectorPeriodo } from './inicio/SelectorPeriodo';
import { Esqueleto, Vacio } from './inicio/Tarjeta';
import { parametrosDe, POR_PAGINA, useTickets, type ParametrosTickets } from './tickets/consultas';
import { ErrorCsv, nombreArchivo, ticketsACsv } from './tickets/csv';
import { descargar, ErrorExport, exportarTickets } from './tickets/exportar';
import { TablaTickets } from './tickets/Tabla';
import { Vista } from './Vista';

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
      try {
        const tickets = await exportarTickets(parametros, {
          signal: actual.signal,
          onProgreso: (hechos, total) => setEstado({ fase: 'exportando', hechos, total }),
        });
        descargar(nombre, ticketsACsv(tickets, sucursales));
        setEstado({ fase: 'inactivo' });
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
  const periodo = leerPeriodo(parametros);
  const folio = leerFolio(parametros);
  const pagina = leerPagina(parametros);

  const zona = zonaDelPanel(sucursal, sucursales.data);
  const hoy = useHoy(zona);
  const rango = rangoDe(periodo, hoy);

  // La misma condición que el dashboard: alcance validado y zona conocida.
  const filtro: Filtro | null =
    empresa && !sucursales.isPending && (!sucursalId || sucursal)
      ? { empresaId: empresa.id, sucursalId: sucursal?.id }
      : null;
  const estable = useAlcanceEstable(
    filtro && `${filtro.empresaId}|${filtro.sucursalId ?? ''}`,
    pagina,
  );
  const consultaParams = estable ? parametrosDe(filtro, rango, folio) : null;
  const consulta = useTickets(consultaParams, pagina);

  const porId = useMemo(
    () => new Map((sucursales.data ?? []).map((s) => [s.id, s] as const)),
    [sucursales.data],
  );
  const { estado: exportacion, exportar, cancelar } = useExportar(porId);

  const cambiarPeriodo = useCallback(
    (nuevo: Periodo) =>
      setParametros((previos) => escribirPagina(escribirPeriodo(previos, nuevo), 1)),
    [setParametros],
  );
  const buscar = useCallback(
    (texto: string) => setParametros((previos) => escribirFolio(previos, texto)),
    [setParametros],
  );
  const irA = useCallback(
    (n: number) => setParametros((previos) => escribirPagina(previos, n)),
    [setParametros],
  );

  const datos = consulta.data;
  const cambiandoPagina = consulta.isPlaceholderData;
  const paginas = datos ? paginasDe(datos.total, POR_PAGINA) : 1;
  const exportando = exportacion.fase === 'exportando';

  return (
    <Vista titulo="Tickets">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <SelectorPeriodo periodo={periodo} rangoActual={rango} onCambiar={cambiarPeriodo} />
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
              disabled={consultaParams === null || !datos || datos.total === 0}
              onClick={() => {
                if (consultaParams === null) return;
                void exportar(
                  consultaParams,
                  nombreArchivo(consultaParams.desde, consultaParams.hasta, sucursal?.nombre),
                );
              }}
            >
              Exportar CSV
            </button>
          )}
        </div>
      </div>
      {exportacion.fase === 'error' && (
        <p role="alert" className="mt-2 text-sm text-peligro">
          No se pudo exportar. {exportacion.mensaje}
        </p>
      )}

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
            {folio
              ? `Ningún ticket del periodo tiene un folio que empiece con "${folio}".`
              : 'No hay tickets en este periodo.'}
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
