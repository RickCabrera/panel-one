import { useState, type ReactNode } from 'react';

import type { VentaHoraDia, VentaMesero, VentaPorMesa, VentaPorProducto } from '../../api/tipos';
import { descargar, ErrorCsv } from '../../csv/csv';
import { formatearPesos, pesos, porcentaje } from '../../dinero/dinero';
import { diferenciaEnPesos } from '../resumen/delta';
import { DIFERENCIA_CUENTAS } from './csv';
import {
  armarMapa,
  canceladosDe,
  extremos,
  nombreMesero,
  ORDENES_MESA,
  ORDENES_MESERO,
  ordenarMesas,
  paginar,
  sumaImportes,
  type MeseroOrdenado,
  type Movimiento,
  type OrdenMesa,
  type OrdenMesero,
  type TipoCelda,
} from './reglas';

const TH = 'px-2 py-1 font-medium';
const TD = 'px-2 py-1';
const NUM = 'px-2 py-1 text-right tabular-nums whitespace-nowrap';
const CONTROL =
  'min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-1 text-sm focus:border-acento-borde focus:outline-none';
const BOTON =
  'rounded-md border border-linea-fuerte bg-superficie px-3 py-1 text-sm text-tinta-medio hover:bg-realce disabled:opacity-50';

/** "Total del desglose" = la venta del periodo; si no cuadra (no debería), se dice. */
export function Cuadre({ suma, venta, testId }: { suma: bigint | null; venta: string; testId: string }) {
  const esperado = sumaImportes([venta]);
  const cuadra = suma !== null && esperado !== null && suma === esperado;
  return (
    <p className="text-xs text-tinta-tenue" data-testid={testId}>
      {cuadra
        ? `Σ del desglose = venta del periodo: ${pesos(venta)}.`
        : `El desglose no cuadra con la venta del periodo (${pesos(venta)}): revisa la ingesta.`}
    </p>
  );
}

/** Descarga con su propio error: un importe ilegible detiene el archivo y se dice. */
export function BotonCsv({
  nombre,
  generar,
  testId,
}: {
  nombre: string;
  generar: () => string;
  testId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const exportar = () => {
    try {
      descargar(nombre, generar());
      setError(null);
    } catch (e) {
      setError(e instanceof ErrorCsv ? e.message : 'No se pudo generar el archivo.');
    }
  };
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <button type="button" className={BOTON} onClick={exportar} data-testid={testId}>
        Exportar CSV
      </button>
      {error && (
        <span role="alert" className="text-sm text-peligro">
          {error}
        </span>
      )}
    </span>
  );
}

/** Anterior / siguiente. Sólo se pinta con más de una página: el DOM lleva la página, no todo. */
export function Paginador({
  pagina,
  paginas,
  total,
  cambiar,
  etiqueta,
}: {
  pagina: number;
  paginas: number;
  total: number;
  cambiar: (p: number) => void;
  etiqueta: string;
}) {
  if (paginas <= 1) return null;
  return (
    <nav
      aria-label={`Páginas de ${etiqueta}`}
      className="mt-2 flex flex-wrap items-center gap-2 text-sm"
    >
      <button
        type="button"
        className={BOTON}
        disabled={pagina <= 1}
        onClick={() => cambiar(pagina - 1)}
      >
        Anterior
      </button>
      <span data-testid={`pagina-${etiqueta}`}>
        Página {pagina} de {paginas} · {total} filas
      </span>
      <button
        type="button"
        className={BOTON}
        disabled={pagina >= paginas}
        onClick={() => cambiar(pagina + 1)}
      >
        Siguiente
      </button>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Meseros
// ---------------------------------------------------------------------------

function DetalleMesero({ f }: { f: VentaMesero }) {
  const propina = porcentaje(sumaImportes([f.propina]) ?? 0n, sumaImportes([f.venta]) ?? 0n);
  return (
    <dl
      className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2"
      data-testid="detalle-mesero"
    >
      <dt className="text-tinta-tenue">Comensales</dt>
      <dd>
        {f.comensales} ({f.cuentasConComensales} de {f.cuentas} cuentas traían el dato)
      </dd>
      <dt className="text-tinta-tenue">Propina</dt>
      <dd>
        {pesos(f.propina)}
        {propina !== null && ` (${propina} de su venta)`}
      </dd>
      <dt className="text-tinta-tenue">Descuentos aplicados</dt>
      <dd>
        {pesos(f.descuentos.monto)} en {f.descuentos.cuentas} cuentas
      </dd>
      <dt className="text-tinta-tenue">Cancelaciones (no suman a la venta)</dt>
      <dd>
        {f.cancelados.cuentas} cuentas por {pesos(f.cancelados.monto)}
      </dd>
    </dl>
  );
}

export function BloqueMeseros({
  datos,
  orden,
  cambiarOrden,
  ordenados,
}: {
  datos: VentaMesero[];
  orden: OrdenMesero;
  cambiarOrden: (o: OrdenMesero) => void;
  ordenados: MeseroOrdenado[];
}) {
  const [pagina, setPagina] = useState(1);
  const [abierto, setAbierto] = useState<string | null>(null);
  const cancelados = canceladosDe(datos);
  const conVentas = datos.some((f) => f.cuentas > 0);
  const p = paginar(ordenados, pagina);
  const llave = (f: VentaMesero) => `${f.sucursalId}|${f.mesero === null ? '\u0000' : f.mesero}`;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-sm" data-testid="cancelados-meseros">
        {cancelados.cuentas === 0
          ? 'Sin cancelaciones en el periodo.'
          : `Cancelaciones del periodo (fuera de la venta): ${cancelados.cuentas} cuentas${
              cancelados.monto === null ? '' : ` por ${formatearPesos(cancelados.monto)}`
            }.`}
      </p>
      {!conVentas ? (
        <p className="py-4 text-sm text-tinta-tenue" data-testid="meseros-vacio">
          Sin ventas en el periodo: no hay meseros que comparar. Elige otro periodo o sucursal.
        </p>
      ) : (
        <>
          <label className="flex min-w-0 items-center gap-1 text-sm">
            Ordenar por
            <select
              className={CONTROL}
              value={orden}
              onChange={(e) => {
                cambiarOrden(e.target.value as OrdenMesero);
                setPagina(1);
              }}
            >
              {ORDENES_MESERO.map(({ orden: o, nombre }) => (
                <option key={o} value={o}>
                  {nombre}
                </option>
              ))}
            </select>
          </label>
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-max text-sm" data-testid="tabla-meseros">
              <thead className="text-left text-tinta-tenue">
                <tr>
                  <th scope="col" className={`${TH} text-right`}>
                    #
                  </th>
                  <th scope="col" className={TH}>
                    Mesero
                  </th>
                  <th scope="col" className={TH}>
                    Sucursal
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Venta
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Cuentas
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Ticket prom.
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Propina
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Cancelaciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {p.filas.map(({ fila: f, posicion }) => {
                  const id = llave(f);
                  const expandido = abierto === id;
                  return (
                    <FilaExpandible
                      key={id}
                      expandido={expandido}
                      alternar={() => setAbierto(expandido ? null : id)}
                      testId="fila-mesero"
                      celdas={
                        <>
                          <td className={NUM}>{posicion ?? '—'}</td>
                          <td className={TD}>
                            <span className={f.mesero === null ? 'italic text-tinta-tenue' : ''}>
                              {nombreMesero(f)}
                            </span>
                          </td>
                          <td className={TD}>{f.sucursal}</td>
                          <td className={NUM} data-testid="mesero-venta">
                            {f.cuentas === 0 ? '—' : pesos(f.venta)}
                          </td>
                          <td className={NUM}>{f.cuentas}</td>
                          <td className={NUM}>
                            {f.ticketPromedio === null ? '—' : pesos(f.ticketPromedio)}
                          </td>
                          <td className={NUM}>{pesos(f.propina)}</td>
                          <td className={NUM}>{f.cancelados.cuentas}</td>
                        </>
                      }
                      columnas={8}
                      detalle={<DetalleMesero f={f} />}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
          <Paginador
            pagina={p.pagina}
            paginas={p.paginas}
            total={p.total}
            cambiar={setPagina}
            etiqueta="meseros"
          />
        </>
      )}
    </div>
  );
}

function FilaExpandible({
  expandido,
  alternar,
  celdas,
  detalle,
  columnas,
  testId,
}: {
  expandido: boolean;
  alternar: () => void;
  celdas: ReactNode;
  detalle: ReactNode;
  columnas: number;
  testId: string;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-t border-linea-suave hover:bg-realce"
        onClick={alternar}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            alternar();
          }
        }}
        tabIndex={0}
        aria-expanded={expandido}
        data-testid={testId}
      >
        {celdas}
      </tr>
      {expandido && (
        <tr>
          <td colSpan={columnas} className="bg-realce px-3 py-2">
            {detalle}
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------

function ListaMovimientos({
  titulo,
  ms,
  testId,
}: {
  titulo: string;
  ms: Movimiento[];
  testId: string;
}) {
  return (
    <div className="min-w-0 flex-1" data-testid={testId}>
      <h3 className="text-sm font-medium">{titulo}</h3>
      {ms.length === 0 ? (
        <p className="text-sm text-tinta-tenue">Ninguno.</p>
      ) : (
        <ol className="mt-1 flex flex-col gap-1 text-sm">
          {ms.map((m) => (
            <li key={m.producto} className="flex min-w-0 flex-wrap justify-between gap-2">
              <span className="min-w-0 truncate">{m.producto}</span>
              <span className={`tabular-nums ${m.diferencia > 0n ? 'text-exito' : 'text-peligro'}`}>
                {diferenciaEnPesos(m.diferencia)}
                {m.delta.tipo === 'cambio' ? ` (${m.delta.porcentaje})` : ''}
                {m.delta.tipo === 'sinBase' && (
                  <span className="text-tinta-tenue">
                    {' '}
                    · {m.actual === null ? 'dejó de venderse' : 'nuevo'}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function BloqueProductos({
  datos,
  movimientos,
  etiquetaBase,
}: {
  datos: VentaPorProducto;
  /** null mientras carga la base; `'error'` si falló. */
  movimientos: Movimiento[] | null | 'error';
  etiquetaBase: string;
}) {
  const [pagina, setPagina] = useState(1);
  if (datos.cuentas === 0) {
    return (
      <p className="py-4 text-sm text-tinta-tenue" data-testid="productos-vacio">
        Sin ventas en el periodo: no hay productos que desglosar. Elige otro periodo o sucursal.
      </p>
    );
  }
  const importes = sumaImportes(datos.productos.map((p) => p.importe));
  const diferencia = sumaImportes([datos.diferenciaCuentas]);
  const p = paginar(datos.productos, pagina);
  const ext = Array.isArray(movimientos) ? extremos(movimientos) : null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row">
        {movimientos === 'error' ? (
          <p role="alert" className="text-sm text-peligro">
            No se pudo leer el periodo de comparación: sin Δ por producto.
          </p>
        ) : ext === null ? (
          <p className="text-sm text-tinta-tenue">Cargando la comparación…</p>
        ) : (
          <>
            <ListaMovimientos
              titulo={`Más subieron contra ${etiquetaBase}`}
              ms={ext.subieron}
              testId="subieron"
            />
            <ListaMovimientos
              titulo={`Más cayeron contra ${etiquetaBase}`}
              ms={ext.cayeron}
              testId="cayeron"
            />
          </>
        )}
      </div>
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-max text-sm" data-testid="tabla-productos">
          <thead className="text-left text-tinta-tenue">
            <tr>
              <th scope="col" className={TH}>
                Producto
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Importe
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Cantidad
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Participación (sobre Σ partidas)
              </th>
            </tr>
          </thead>
          <tbody>
            {p.filas.map((prod) => (
              <tr
                key={prod.producto}
                className="border-t border-linea-suave"
                data-testid="fila-producto"
              >
                <td className={TD}>{prod.producto}</td>
                <td className={NUM}>{pesos(prod.importe)}</td>
                <td className={NUM}>{prod.cantidad}</td>
                <td className={NUM}>
                  {importes === null
                    ? '—'
                    : (porcentaje(sumaImportes([prod.importe]) ?? 0n, importes) ?? '—')}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-linea" data-testid="fila-diferencia">
              <td className={`${TD} text-tinta-suave`}>{DIFERENCIA_CUENTAS}</td>
              <td className={NUM}>{pesos(datos.diferenciaCuentas)}</td>
              <td className={NUM} />
              <td className={NUM} />
            </tr>
            <tr className="border-t border-linea font-medium">
              <td className={TD}>Venta del periodo</td>
              <td className={NUM} data-testid="productos-venta">
                {pesos(datos.venta)}
              </td>
              <td className={NUM} />
              <td className={NUM} />
            </tr>
          </tfoot>
        </table>
      </div>
      <Paginador
        pagina={p.pagina}
        paginas={p.paginas}
        total={p.total}
        cambiar={setPagina}
        etiqueta="productos"
      />
      <Cuadre
        suma={importes === null || diferencia === null ? null : importes + diferencia}
        venta={datos.venta}
        testId="cuadre-productos"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mapa de calor
// ---------------------------------------------------------------------------

/** Relleno por quintil: tokens de la paleta, nunca un color escrito a mano. */
const RELLENO: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'bg-serie-1/20',
  2: 'bg-serie-1/40',
  3: 'bg-serie-1/60',
  4: 'bg-serie-1/80',
  5: 'bg-serie-1',
};

function textoCelda(t: TipoCelda, dia: string, hora: number): string {
  const cuando = `${dia} ${hora}:00`;
  switch (t.tipo) {
    case 'fueraDePeriodo':
      return `${cuando}: ese día no está en el periodo`;
    case 'sinVentas':
      return `${cuando}: sin ventas`;
    case 'ceroPesos':
      return `${cuando}: $0.00 en ${t.cuentas} cuentas`;
    case 'negativa':
    case 'venta':
      return `${cuando}: ${formatearPesos(t.centavos)} en ${t.cuentas} cuentas`;
    case 'ilegible':
      return `${cuando}: importe ilegible`;
  }
}

function Celda({ t, dia, hora }: { t: TipoCelda; dia: string; hora: number }) {
  const base = 'flex h-7 w-7 items-center justify-center rounded-sm text-xs';
  let clase: string;
  let contenido = '';
  switch (t.tipo) {
    case 'fueraDePeriodo':
      clase = 'text-tinta-medio';
      contenido = '—';
      break;
    case 'sinVentas':
      clase = 'border border-dashed border-tinta-tenue';
      break;
    case 'ceroPesos':
      clase = 'border border-linea-fuerte text-tinta-medio';
      contenido = '0';
      break;
    case 'negativa':
      clase = 'border border-linea-fuerte text-peligro';
      contenido = '−';
      break;
    case 'ilegible':
      clase = 'border border-linea-fuerte text-peligro';
      contenido = '?';
      break;
    case 'venta':
      clase = RELLENO[t.nivel];
      break;
  }
  const etiqueta = textoCelda(t, dia, hora);
  return (
    <td className="p-0.5">
      <div
        className={`${base} ${clase}`}
        title={etiqueta}
        aria-label={etiqueta}
        role="img"
        data-tipo={t.tipo}
        data-testid={`celda-${dia}-${hora}`}
      >
        {contenido}
      </div>
    </td>
  );
}

export function BloqueMapa({ datos }: { datos: VentaHoraDia }) {
  const mapa = armarMapa(datos);
  if (!mapa.conVentas) {
    return (
      <p className="py-4 text-sm text-tinta-tenue" data-testid="mapa-vacio">
        Sin ventas en el periodo: el mapa quedaría en blanco. Elige otro periodo o sucursal.
      </p>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="max-w-full overflow-x-auto" data-testid="mapa-calor">
        <table className="min-w-max border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th scope="col" className="px-1 text-left font-medium text-tinta-tenue">
                <span className="sr-only">Día</span>
              </th>
              {Array.from({ length: 24 }, (_, h) => (
                <th key={h} scope="col" className="w-7 text-center font-normal text-tinta-tenue">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mapa.filas.map(({ dia, enPeriodo, celdas }) => (
              <tr key={dia.dia}>
                <th
                  scope="row"
                  className="px-1 text-left font-medium"
                  title={enPeriodo ? undefined : 'No está en el periodo'}
                >
                  {dia.corto}
                </th>
                {celdas.map(({ hora, tipo }) => (
                  <Celda key={hora} t={tipo} dia={dia.nombre} hora={hora} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul
        className="flex flex-wrap items-center gap-3 text-xs text-tinta-medio"
        aria-label="Leyenda del mapa"
      >
        <li className="flex items-center gap-1">
          <span className="inline-block h-4 w-4 rounded-sm border border-dashed border-tinta-tenue" />{' '}
          Sin ventas
        </li>
        <li className="flex items-center gap-1">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm border border-linea-fuerte">
            0
          </span>
          Cuentas por $0.00
        </li>
        <li className="flex items-center gap-1">
          <span className="inline-flex h-4 w-4 items-center justify-center">—</span> Ese día no está
          en el periodo
        </li>
        <li className="flex items-center gap-1">
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <span key={n} className={`inline-block h-4 w-4 rounded-sm ${RELLENO[n]}`} />
          ))}
          Menos → más venta
          {mapa.maximo !== null && ` (máximo ${formatearPesos(mapa.maximo)} en una hora)`}
        </li>
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mesas
// ---------------------------------------------------------------------------

export function BloqueMesas({
  datos,
  orden,
  cambiarOrden,
}: {
  datos: VentaPorMesa;
  orden: OrdenMesa;
  cambiarOrden: (o: OrdenMesa) => void;
}) {
  const [pagina, setPagina] = useState(1);
  const g = datos.global;
  if (g.cuentas === 0) {
    return (
      <p className="py-4 text-sm text-tinta-tenue" data-testid="mesas-vacio">
        Sin ventas en el periodo: no hay tiempos de mesa que medir. Elige otro periodo o sucursal.
      </p>
    );
  }
  const filas = ordenarMesas(datos.filas, orden);
  const p = paginar(filas, pagina);
  const suma = sumaImportes([...datos.filas.map((m) => m.venta), datos.sinMesa.venta]);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-tinta-tenue">Duración promedio de la cuenta</dt>
          <dd className="text-lg font-semibold" data-testid="minutos-promedio">
            {g.minutosPromedio === null ? '—' : `${g.minutosPromedio} min`}
          </dd>
        </div>
        <div>
          <dt className="text-tinta-tenue">Rotación (cuentas por mesa)</dt>
          <dd className="text-lg font-semibold" data-testid="rotacion">
            {g.rotacion ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-tinta-tenue">Mesas con cuentas</dt>
          <dd className="text-lg font-semibold">{g.mesas}</dd>
        </div>
      </dl>
      <p className="text-sm" data-testid="sin-mesa">
        Sin mesa: {datos.sinMesa.cuentas} cuentas por {pesos(datos.sinMesa.venta)} (no entran a la
        rotación).
      </p>
      {g.duracionesInvalidas > 0 && (
        <p className="text-sm text-aviso" data-testid="duraciones-invalidas">
          {g.duracionesInvalidas} cuentas traen el cierre antes que la apertura: no entran al
          promedio.
        </p>
      )}
      {datos.filas.length > 0 && (
        <>
          <label className="flex min-w-0 items-center gap-1 text-sm">
            Ordenar por
            <select
              className={CONTROL}
              value={orden}
              onChange={(e) => {
                cambiarOrden(e.target.value as OrdenMesa);
                setPagina(1);
              }}
            >
              {ORDENES_MESA.map(({ orden: o, nombre }) => (
                <option key={o} value={o}>
                  {nombre}
                </option>
              ))}
            </select>
          </label>
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-max text-sm" data-testid="tabla-mesas">
              <thead className="text-left text-tinta-tenue">
                <tr>
                  <th scope="col" className={TH}>
                    Sucursal
                  </th>
                  <th scope="col" className={TH}>
                    Mesa
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Cuentas
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Venta
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Minutos promedio
                  </th>
                </tr>
              </thead>
              <tbody>
                {p.filas.map((m) => (
                  <tr
                    key={`${m.sucursalId}|${m.mesa}`}
                    className="border-t border-linea-suave"
                    data-testid="fila-mesa"
                  >
                    <td className={TD}>{m.sucursal}</td>
                    <td className={TD}>{m.mesa}</td>
                    <td className={NUM}>{m.cuentas}</td>
                    <td className={NUM}>{pesos(m.venta)}</td>
                    <td className={NUM}>{m.minutosPromedio ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginador
            pagina={p.pagina}
            paginas={p.paginas}
            total={p.total}
            cambiar={setPagina}
            etiqueta="mesas"
          />
        </>
      )}
      <Cuadre suma={suma} venta={g.venta} testId="cuadre-mesas" />
    </div>
  );
}
