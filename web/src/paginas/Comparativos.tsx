import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { useMinuto } from '../consultas/useMinuto';
import { descargar, ErrorCsv } from '../csv/csv';
import { useAlcance } from '../filtros/alcance';
import { errorDeRango, incluyeHoy, TIPOS_PERIODO, type Rango } from '../filtros/periodo';
import { usePeriodo } from '../filtros/usePeriodo';
import { comparativosACsv, nombreCsvComparativos } from './comparativos/csv';
import {
  armarFilas,
  cifrasDeResumen,
  ordenar,
  ORDENES,
  tieneDatos,
  UTILIDAD_CORTADA,
  UTILIDAD_SIN_LECTURA,
  utilidadesDe,
  type FilaOrdenada,
  type Orden,
  tasasDe,
  TASA_SIN_LECTURA,
} from './comparativos/matriz';
import { escribirB, leerB, resolverB, type SeleccionB } from './comparativos/periodoB';
import { SelectorB } from './comparativos/SelectorB';
import { TablaComparativos } from './comparativos/Tabla';
import { useEstadoResultados } from './finanzas/consultas';
import { useTablero } from './facturacion/tablero/consultas';
import { useMesasAbiertas, useVentas, type Filtro } from './inicio/consultas';
import { useAhora } from './mesas/consultas';
import { Esqueleto, ErrorTarjeta, Tarjeta } from './inicio/Tarjeta';
import { useReporte } from './reportes/consultas';
import { avisoIncompleta } from './resumen/reglas';
import { Vista } from './Vista';

const CONTROL =
  'min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-1 text-sm focus:border-acento-borde focus:outline-none';
const BOTON =
  'rounded-md border border-linea-fuerte bg-superficie px-3 py-1 text-sm text-tinta-medio hover:bg-realce disabled:opacity-50';

/** Qué es la columna Tasa de facturación (F2-106) y cuándo no se afirma. */
export const NOTA_TASA =
  'Tasa de facturación: lo facturado en el periodo (por fecha de emisión) entre la venta del ' +
  'periodo, la misma del tablero de Facturación. “—” sin venta; el Δ va en puntos porcentuales (pp).';

/** Qué es la columna Utilidad (F2-126) y cuándo no se afirma. */
export const NOTA_UTILIDAD =
  'Utilidad: la de operación de "Gastos y utilidad" (venta neta − costo teórico de lo vendido − ' +
  'gastos). “—” si falta el costo (sin recetas o sin catálogo) o si B se corta a la misma altura; ' +
  '* = costo incompleto, la utilidad real es menor o igual.';

/**
 * Qué sucursales no reportan (mientras A incluye hoy): su "—" o su cifra baja no quiere decir
 * que no vendieron. Componente aparte para que el pulso del reloj no repinte la tabla.
 */
function AvisoIncompleta({ mesas }: { mesas: Parameters<typeof avisoIncompleta>[0] }) {
  const ahora = useAhora();
  const aviso = avisoIncompleta(mesas, ahora);
  if (!aviso) return null;
  return (
    <p className="text-aviso" data-testid="aviso-incompleta">
      {aviso}
    </p>
  );
}

const textoRango = (r: Rango) => (r.desde === r.hasta ? r.desde : `${r.desde} a ${r.hasta}`);

/**
 * Comparativos (F2-140): sucursal × métrica, periodo A (el de la cabecera) contra periodo B
 * (propio de la vista), con Δ absoluto y %, ranking y CSV.
 *
 * No calcula ninguna cifra de venta: la fila de total es la MISMA consulta que "Venta total" de
 * Inicio (`useVentas('resumen', …)`, misma llave) y las filas de sucursal son la misma consulta
 * que el comparativo de Reportes (`comparativo-sucursales`). Que cada fila cuadre con Inicio
 * para esa sucursal lo prueba el e2e de la API (`lectura.e2e.spec.ts`, F2-140).
 *
 * Una empresa a la vez (la de la cabecera): comparar entre empresas queda anotado en F2-250.
 */
export function Comparativos() {
  const { empresa, sucursal, sucursalId, sucursales } = useAlcance();
  const { periodo, rango, hoy } = usePeriodo();
  const [parametros, setParametros] = useSearchParams();
  const ahora = useMinuto();
  const [orden, setOrden] = useState<Orden>('venta');
  const [errorCsv, setErrorCsv] = useState<string | null>(null);

  const filtro: Filtro | null =
    empresa && !sucursales.isPending && (!sucursalId || sucursal)
      ? { empresaId: empresa.id, sucursalId: sucursal?.id }
      : null;

  const seleccionB = leerB(parametros);
  const b = rango === null ? null : resolverB(seleccionB, periodo.tipo, rango, hoy, ahora);
  const comparable = b?.ok ? b.comparable : null;
  const rangoB = comparable?.rango ?? null;

  const autoA = rango !== null && incluyeHoy(rango, hoy);
  const autoB = rangoB !== null && incluyeHoy(rangoB, hoy);

  const resumenA = useVentas('resumen', filtro, rango, autoA);
  const resumenB = useVentas('resumen', filtro, rangoB, autoB, comparable?.alturaAl);
  const sucA = useReporte('comparativo-sucursales', filtro, rango, {}, undefined, autoA);
  const sucB = useReporte(
    'comparativo-sucursales',
    filtro,
    rangoB,
    {},
    comparable?.alturaAl,
    autoB,
  );
  // Utilidad (F2-126): la MISMA consulta que "Gastos y utilidad" (misma llave). El estado de
  // resultados es por días completos: un B cortado a la misma altura no se pide y se dice.
  const cortadaB = comparable?.alturaAl !== undefined;
  const estadoA = useEstadoResultados(filtro, rango);
  const estadoB = useEstadoResultados(filtro, cortadaB ? null : rangoB);
  // Tasa de facturación (F2-106): la MISMA consulta que el tablero de Facturación. El tablero sí
  // corta a la misma altura, así que B se pide con su `alturaAl`.
  const tableroA = useTablero(filtro, rango);
  const tableroB = useTablero(filtro, rangoB, comparable?.alturaAl);
  // Misma llave que Inicio y la cabecera: no sale una petición de más.
  const mesas = useMesasAbiertas(filtro);

  const cambiarB = (nueva: SeleccionB) => setParametros((previos) => escribirB(previos, nueva));
  const errorB =
    seleccionB.modo === 'rango'
      ? errorDeRango(seleccionB.desde ?? '', seleccionB.hasta ?? '')
      : null;

  const nombrePeriodo = TIPOS_PERIODO.find((t) => t.tipo === periodo.tipo)?.nombre ?? '';
  const consultas = [resumenA, resumenB, sucA, sucB];
  const fallida = consultas.find((c) => c.isError);
  // La utilidad no tumba la tabla: si su consulta falla, su columna dice "no se pudo leer".
  const utilidadLista =
    (estadoA.data !== undefined || estadoA.isError) &&
    (cortadaB || estadoB.data !== undefined || estadoB.isError);
  // La tasa tampoco tumba la tabla: si su consulta falla, su columna dice "no se pudo leer".
  const tasaLista =
    (tableroA.data !== undefined || tableroA.isError) &&
    (tableroB.data !== undefined || tableroB.isError);
  const listas =
    resumenA.data !== undefined &&
    resumenB.data !== undefined &&
    sucA.data !== undefined &&
    sucB.data !== undefined &&
    utilidadLista &&
    tasaLista;

  const utilA = utilidadesDe(estadoA.isError ? undefined : estadoA.data, UTILIDAD_SIN_LECTURA);
  const utilB = cortadaB
    ? utilidadesDe(undefined, UTILIDAD_CORTADA)
    : utilidadesDe(estadoB.isError ? undefined : estadoB.data, UTILIDAD_SIN_LECTURA);

  const tasaA = tasasDe(tableroA.isError ? undefined : tableroA.data, TASA_SIN_LECTURA);
  const tasaB = tasasDe(tableroB.isError ? undefined : tableroB.data, TASA_SIN_LECTURA);

  const ordenadas: FilaOrdenada[] =
    listas && sucA.data && sucB.data
      ? ordenar(armarFilas(sucA.data, sucB.data, utilA, utilB, tasaA, tasaB), orden)
      : [];

  const exportar = () => {
    if (!rango || !rangoB) return;
    try {
      descargar(
        nombreCsvComparativos(rango, rangoB, sucursal?.nombre),
        comparativosACsv(ordenadas),
      );
      setErrorCsv(null);
    } catch (e) {
      setErrorCsv(e instanceof ErrorCsv ? e.message : 'No se pudo generar el archivo.');
    }
  };

  // A va hasta hoy y B no se corta a la misma altura: el Δ compara un periodo a medias
  // contra uno entero. No depende del modo de B: "comparable" tampoco se corta si A es un
  // rango que termina en el futuro (limitación documentada en `resumen/comparables.ts`).
  const aMedias = autoA && comparable !== null && comparable.alturaAl === undefined;

  return (
    <Vista titulo="Comparativos">
      {rango === null ? (
        <p className="text-sm text-tinta-tenue">
          Corrige el rango de fechas de la cabecera para comparar.
        </p>
      ) : (
        <Tarjeta titulo="Sucursales: periodo A contra periodo B">
          <div className="flex min-w-0 flex-col gap-2 text-sm">
            <p data-testid="comparativos-periodos">
              <span className="font-medium">A:</span> {nombrePeriodo} ({textoRango(rango)})
              {comparable && rangoB && (
                <>
                  {' · '}
                  <span className="font-medium">B:</span> {comparable.etiqueta} (
                  {textoRango(rangoB)})
                </>
              )}
            </p>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <SelectorB
                seleccion={seleccionB}
                rangoA={rango}
                rangoB={rangoB}
                onCambiar={cambiarB}
              />
              <label className="flex min-w-0 items-center gap-1">
                Ordenar por
                <select
                  className={CONTROL}
                  value={orden}
                  onChange={(e) => setOrden(e.target.value as Orden)}
                >
                  {ORDENES.map(({ orden: o, nombre }) => (
                    <option key={o} value={o}>
                      {nombre}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className={BOTON} disabled={!listas} onClick={exportar}>
                Exportar CSV
              </button>
            </div>
            {errorB && (
              <p role="alert" className="text-peligro">
                Periodo B: {errorB}
              </p>
            )}
            {errorCsv && (
              <p role="alert" className="text-peligro">
                {errorCsv}
              </p>
            )}
            {aMedias && (
              <p className="text-aviso" data-testid="aviso-a-medias">
                El periodo A va en curso (incluye hoy) y el B está completo: el Δ compara un periodo
                a medias contra uno entero.
              </p>
            )}
            {autoA && <AvisoIncompleta mesas={mesas} />}
          </div>

          <div className="mt-3">
            {errorB ? null : fallida ? (
              <ErrorTarjeta error={fallida.error} />
            ) : !listas || !resumenA.data || !resumenB.data ? (
              <Esqueleto lineas={3} />
            ) : (
              <>
                {!tieneDatos(cifrasDeResumen(resumenA.data)) && (
                  <p className="mb-2 text-sm text-tinta-tenue" data-testid="sin-ventas-a">
                    Sin ventas en el periodo A en ninguna sucursal del alcance: elige otro periodo
                    en la cabecera.
                  </p>
                )}
                {!tieneDatos(cifrasDeResumen(resumenB.data)) && (
                  <p className="mb-2 text-sm text-tinta-tenue" data-testid="sin-ventas-b">
                    Sin ventas en el periodo B en ninguna sucursal del alcance: elige otro periodo
                    de comparación.
                  </p>
                )}
                <TablaComparativos
                  total={{
                    a: cifrasDeResumen(resumenA.data, utilA.total, tasaA.total),
                    b: cifrasDeResumen(resumenB.data, utilB.total, tasaB.total),
                  }}
                  etiquetaTotal={sucursal ? `Total (${sucursal.nombre})` : 'Total del alcance'}
                  filas={ordenadas}
                />
                {resumenA.data.comensales.cuentasConDato < resumenA.data.cuentas && (
                  <p className="mt-2 text-xs text-tinta-tenue" data-testid="cobertura-comensales">
                    Periodo A: {resumenA.data.comensales.cuentasConDato} de {resumenA.data.cuentas}{' '}
                    cuentas traían comensales.
                  </p>
                )}
              </>
            )}
          </div>

          <p className="mt-3 text-xs text-tinta-tenue">
            “—”: sin cuentas en ese periodo, o sin base para el Δ (pasa el cursor para ver por qué).
            El comparativo por sucursal no distingue comensales no registrados de cero.
          </p>
          <p className="mt-1 text-xs text-tinta-tenue" data-testid="nota-utilidad">
            {NOTA_UTILIDAD}
          </p>
          <p className="mt-1 text-xs text-tinta-tenue" data-testid="nota-tasa">
            {NOTA_TASA}
          </p>
        </Tarjeta>
      )}
    </Vista>
  );
}
