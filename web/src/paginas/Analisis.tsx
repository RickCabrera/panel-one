import { useState, type ReactNode } from 'react';

import { useMinuto } from '../consultas/useMinuto';
import { formatearPesos } from '../dinero/dinero';
import { useAlcance } from '../filtros/alcance';
import { incluyeHoy, type Rango } from '../filtros/periodo';
import { usePeriodo } from '../filtros/usePeriodo';
import {
  BloqueMapa,
  BloqueMeseros,
  BloqueMesas,
  BloqueProductos,
  BotonCsv,
} from './analisis/Bloques';
import { useAnalisis } from './analisis/consultas';
import {
  horaDiaACsv,
  mesasACsv,
  meserosACsv,
  nombreCsvAnalisis,
  productosACsv,
  type BloqueCsv,
} from './analisis/csv';
import {
  movimientos,
  ordenarMeseros,
  ordenarMesas,
  sumaImportes,
  type OrdenMesa,
  type OrdenMesero,
} from './analisis/reglas';
import type { Filtro } from './inicio/consultas';
import { Esqueleto, SegunEstado, Tarjeta } from './inicio/Tarjeta';
import { periodoComparable } from './resumen/comparables';
import { Vista } from './Vista';
import { NOTA_CORTESIAS } from './analisis/textos';
import { BloqueAreas } from './areas/Bloques';
import { areasACsv, nombreCsvAreas } from './areas/csv';

function EncabezadoBloque({ children, csv }: { children?: ReactNode; csv?: ReactNode }) {
  return (
    <div className="mb-2 flex min-w-0 flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 text-xs text-tinta-tenue">{children}</div>
      {csv}
    </div>
  );
}

/**
 * Análisis (F2-221): desgloses por mesero, producto, hora × día de la semana y tiempo de mesa,
 * con el periodo y la sucursal de la cabecera. Cada bloque cuadra con la venta del periodo (la
 * API lo garantiza y el e2e lo prueba a mano; aquí se muestra la Σ) y tiene su CSV con TODAS sus
 * filas. Por área y canal (F2-233) sale del mapeo área → canal de la vista Áreas y canales.
 */
export function Analisis() {
  const { empresa, sucursal, sucursalId, sucursales } = useAlcance();
  const { periodo, rango, hoy } = usePeriodo();
  const ahora = useMinuto();
  const [ordenMesero, setOrdenMesero] = useState<OrdenMesero>('venta');
  const [ordenMesa, setOrdenMesa] = useState<OrdenMesa>('cuentas');

  const filtro: Filtro | null =
    empresa && !sucursales.isPending && (!sucursalId || sucursal)
      ? { empresaId: empresa.id, sucursalId: sucursal?.id }
      : null;
  const auto = rango !== null && incluyeHoy(rango, hoy);
  const comparable = rango === null ? null : periodoComparable(periodo.tipo, rango, hoy, ahora);
  const rangoBase = comparable?.rango ?? null;

  const meseros = useAnalisis('por-mesero', filtro, rango, auto);
  const productos = useAnalisis('por-producto', filtro, rango, auto);
  const base = useAnalisis(
    'por-producto',
    filtro,
    rangoBase,
    rangoBase !== null && incluyeHoy(rangoBase, hoy),
    comparable?.alturaAl,
  );
  const mapa = useAnalisis('hora-dia', filtro, rango, auto);
  const mesas = useAnalisis('por-mesa', filtro, rango, auto);
  const areas = useAnalisis('por-area', filtro, rango, auto);

  const archivo = (bloque: BloqueCsv, r: Rango) => nombreCsvAnalisis(bloque, r, sucursal?.nombre);
  const esq = <Esqueleto lineas={4} />;

  return (
    <Vista titulo="Análisis">
      {rango === null ? (
        <p className="text-sm text-tinta-tenue">
          Corrige el rango de fechas de la cabecera para ver el análisis.
        </p>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4">
          <p className="text-sm text-tinta-suave" data-testid="nota-cortesias">
            {NOTA_CORTESIAS}
          </p>

          <Tarjeta titulo="Por mesero">
            <SegunEstado consulta={meseros} esqueleto={esq}>
              {(datos) => {
                const ordenados = ordenarMeseros(datos, ordenMesero);
                const venta = sumaImportes(datos.map((f) => f.venta));
                return (
                  <>
                    <EncabezadoBloque
                      csv={
                        <BotonCsv
                          nombre={archivo('meseros', rango)}
                          generar={() => meserosACsv(ordenados)}
                          testId="csv-meseros"
                        />
                      }
                    >
                      Venta, cuentas, ticket promedio, propina y cancelaciones por mesero y
                      sucursal. Toca una fila para ver su detalle.
                    </EncabezadoBloque>
                    <BloqueMeseros
                      datos={datos}
                      orden={ordenMesero}
                      cambiarOrden={setOrdenMesero}
                      ordenados={ordenados}
                    />
                    {datos.some((f) => f.cuentas > 0) && (
                      <p className="mt-2 text-xs text-tinta-tenue" data-testid="cuadre-meseros">
                        Σ venta de los meseros:{' '}
                        {venta === null ? 'ilegible' : formatearPesos(venta)}.
                      </p>
                    )}
                  </>
                );
              }}
            </SegunEstado>
          </Tarjeta>

          <Tarjeta titulo="Por producto">
            <SegunEstado consulta={productos} esqueleto={esq}>
              {(datos) => (
                <>
                  <EncabezadoBloque
                    csv={
                      datos.cuentas > 0 && (
                        <BotonCsv
                          nombre={archivo('productos', rango)}
                          generar={() => productosACsv(datos)}
                          testId="csv-productos"
                        />
                      )
                    }
                  >
                    Importe de las partidas (antes del descuento de la cuenta), cantidad y
                    participación. Lo que el total de las cuentas no reparte entre sus productos va
                    en un renglón aparte, para que el desglose sume la venta.
                  </EncabezadoBloque>
                  <BloqueProductos
                    datos={datos}
                    etiquetaBase={comparable?.etiqueta ?? 'el periodo anterior'}
                    movimientos={
                      base.isError
                        ? 'error'
                        : base.data === undefined
                          ? null
                          : movimientos(datos.productos, base.data.productos)
                    }
                  />
                </>
              )}
            </SegunEstado>
          </Tarjeta>

          <Tarjeta titulo="Por hora y día de la semana">
            <SegunEstado consulta={mapa} esqueleto={<Esqueleto grafica />}>
              {(datos) => (
                <>
                  <EncabezadoBloque
                    csv={
                      datos.celdas.some((c) => c.cuentas > 0) && (
                        <BotonCsv
                          nombre={archivo('hora-dia', rango)}
                          generar={() => horaDiaACsv(datos)}
                          testId="csv-hora-dia"
                        />
                      )
                    }
                  >
                    Venta por hora local de cierre de cada sucursal. Úsalo para decidir horarios y
                    turnos.
                  </EncabezadoBloque>
                  <BloqueMapa datos={datos} />
                </>
              )}
            </SegunEstado>
          </Tarjeta>

          <Tarjeta titulo="Por área y canal">
            <SegunEstado consulta={areas} esqueleto={esq}>
              {(datos) => (
                <>
                  <EncabezadoBloque
                    csv={
                      datos.cuentas > 0 && (
                        <BotonCsv
                          nombre={nombreCsvAreas(rango, sucursal?.nombre)}
                          generar={() => areasACsv(datos)}
                          testId="csv-areas"
                        />
                      )
                    }
                  >
                    Venta por el área del POS donde se atendió la cuenta y por canal de negocio. El
                    canal de cada área se asigna en Catálogos → Áreas y canales.
                  </EncabezadoBloque>
                  <BloqueAreas datos={datos} />
                </>
              )}
            </SegunEstado>
          </Tarjeta>

          <Tarjeta titulo="Por tiempo de mesa">
            <SegunEstado consulta={mesas} esqueleto={esq}>
              {(datos) => (
                <>
                  <EncabezadoBloque
                    csv={
                      datos.global.cuentas > 0 && (
                        <BotonCsv
                          nombre={archivo('mesas', rango)}
                          generar={() => mesasACsv(datos, ordenarMesas(datos.filas, ordenMesa))}
                          testId="csv-mesas"
                        />
                      )
                    }
                  >
                    Duración de la cuenta (de la apertura al cierre) y rotación: cuántas cuentas
                    pasaron por cada mesa en el periodo.
                  </EncabezadoBloque>
                  <BloqueMesas datos={datos} orden={ordenMesa} cambiarOrden={setOrdenMesa} />
                </>
              )}
            </SegunEstado>
          </Tarjeta>
        </div>
      )}
    </Vista>
  );
}
