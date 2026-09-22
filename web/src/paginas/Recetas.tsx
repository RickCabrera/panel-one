import { Fragment, useState } from 'react';

import { useFiltroAlcance } from '../alertas/consultas';
import type {
  ConsumoTeorico,
  FilaConsumo,
  ProductoReceta,
  Recetas as DatosRecetas,
} from '../api/tipos';
import { pesos } from '../dinero/dinero';
import { usePeriodo } from '../filtros/usePeriodo';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from './inicio/Tarjeta';
import { nombreInsumo } from './movimientos/reglas';
import { useConsumoTeorico, useRecetas } from './recetas/consultas';
import {
  AYUDA_MOTIVO,
  conSigno,
  filtrarRecetas,
  motivoSucursal,
  nombreProducto,
  sentidoVariacion,
  TEXTO_MOTIVO,
  textoPorcentaje,
  vacioConsumo,
  vacioRecetas,
} from './recetas/reglas';
import { cantidad } from './tickets/formato';
import { Vista } from './Vista';

const TH = 'px-2 py-1 font-medium';
const TD = 'px-2 py-2';
const NUM = 'px-2 py-2 text-right tabular-nums whitespace-nowrap';
const CONTROL =
  'min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-1 text-sm focus:border-acento-borde focus:outline-none disabled:opacity-50';
const ENLACE = 'text-left text-acento-texto underline-offset-2 hover:underline';

const cant = (v: string | null) => (v === null ? '—' : cantidad(v));
const dinero = (v: string | null) => (v === null ? '—' : pesos(v));
const COLOR_SENTIDO = {
  Faltante: 'text-peligro',
  Sobrante: 'text-tinta-medio',
  'Sin diferencia': 'text-tinta-tenue',
  'Sin lectura': 'text-tinta-tenue',
} as const;

/**
 * Recetas de SoftRestaurant (F2-125): el consumo TEÓRICO (lo vendido × su receta) contra el REAL
 * (lo que las pólizas del POS sacaron por consumo, merma y ajuste), con un ranking de variaciones
 * para buscar mermas o robos, y la receta de cada producto con su costo. Lo que no se puede
 * calcular se dice y se explica; nunca un $0.00 inventado.
 */
export function Recetas() {
  const filtro = useFiltroAlcance();
  const { rango } = usePeriodo();
  const consumo = useConsumoTeorico(filtro, rango);
  const recetas = useRecetas(filtro);
  const variasSucursales = filtro !== null && !filtro.sucursalId;

  return (
    <Vista titulo="Recetas">
      <p className="mb-4 text-sm text-tinta-tenue">
        Lo que las ventas del periodo debieron consumir según las recetas de SoftRestaurant, contra
        lo que el inventario del POS registró como consumo, merma y ajuste. Una variación grande es
        una pista (merma, robo, porciones o una receta desactualizada), no una conclusión.
      </p>
      {rango === null ? (
        <Tarjeta titulo="Consumo teórico contra real">
          <Vacio>El rango de fechas no es válido: corrígelo en la cabecera para consultar.</Vacio>
        </Tarjeta>
      ) : filtro === null ? (
        <Tarjeta titulo="Consumo teórico contra real">
          <Esqueleto lineas={4} />
        </Tarjeta>
      ) : (
        <SegunEstado consulta={consumo} esqueleto={<Esqueleto lineas={6} />}>
          {(r) => <Consumo r={r} variasSucursales={variasSucursales} />}
        </SegunEstado>
      )}
      <div className="mt-4">
        {filtro === null ? (
          <Tarjeta titulo="Recetas por producto">
            <Esqueleto lineas={4} />
          </Tarjeta>
        ) : (
          <SegunEstado consulta={recetas} esqueleto={<Esqueleto lineas={6} />}>
            {(r) => <ListaRecetas r={r} variasSucursales={variasSucursales} />}
          </SegunEstado>
        )}
      </div>
    </Vista>
  );
}

function Consumo({ r, variasSucursales }: { r: ConsumoTeorico; variasSucursales: boolean }) {
  const v = vacioConsumo(r);
  if (v.tipo === 'sin-calculo') {
    return (
      <Tarjeta titulo="Consumo teórico contra real">
        <div className="space-y-2 text-sm" data-testid="consumo-vacio">
          {v.porque.map((p) => (
            <p key={p}>{p}</p>
          ))}
          <p className="text-tinta-medio">{v.falta}</p>
        </div>
      </Tarjeta>
    );
  }
  const avisos = r.sucursales.map(motivoSucursal).filter((m): m is string => m !== null);
  const sucursal = (id: string) => r.sucursales.find((s) => s.sucursalId === id)?.sucursal ?? '';
  return (
    <>
      <Tarjeta titulo="Consumo teórico contra real">
        {avisos.length > 0 && (
          <ul className="mb-3 space-y-1 text-sm text-tinta-medio" data-testid="avisos-consumo">
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
        <details className="mb-3 text-sm text-tinta-medio">
          <summary className="cursor-pointer">Cómo se calcula</summary>
          <div className="mt-2 space-y-2">
            <p>
              <strong>Teórico</strong>: lo vendido en el periodo (cuentas cerradas, sin las
              canceladas) por la receta de cada producto, en la unidad del insumo. El producto del
              ticket se reconoce por su nombre en el catálogo de su sucursal.
            </p>
            <p>
              <strong>Real</strong>: lo que salió del inventario por pólizas de consumo, merma y
              ajuste (un ajuste a favor resta). Las compras y los traspasos no cuentan.{' '}
              <strong>Variación</strong> = real − teórico; positiva es un faltante. El importe usa
              el costo de esas mismas salidas (sin IVA).
            </p>
            <p>
              Si SoftRestaurant descuenta el inventario por receta al vender, su columna de consumo
              ya es su propio teórico: entonces la diferencia útil está en merma y ajuste. Con datos
              de demostración la variación es sintética.
            </p>
          </div>
        </details>
        {v.tipo === 'periodo-vacio' ? (
          <Vacio>{v.porque}</Vacio>
        ) : r.filas.length === 0 ? (
          <Vacio>Ningún insumo con consumo en el periodo.</Vacio>
        ) : (
          <TablaConsumo filas={r.filas} variasSucursales={variasSucursales} sucursal={sucursal} />
        )}
      </Tarjeta>
      {r.aparte.length > 0 && (
        <Tarjeta titulo="Vendido sin receta que explotar" className="mt-4">
          <p className="mb-2 text-sm text-tinta-medio">
            Estos productos se vendieron pero no entran al teórico. El resto del cálculo no se
            detiene por ellos.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="tabla-aparte">
              <thead className="text-left text-tinta-suave">
                <tr>
                  <th className={TH}>Producto</th>
                  {variasSucursales && <th className={TH}>Sucursal</th>}
                  <th className={TH}>Por qué</th>
                  <th className={`${TH} text-right`}>Cantidad</th>
                  <th className={`${TH} text-right`}>Importe</th>
                </tr>
              </thead>
              <tbody>
                {r.aparte.map((a) => (
                  <tr
                    key={`${a.sucursalId}|${a.motivo}|${a.producto}`}
                    className="border-t border-linea"
                  >
                    <td className={TD}>{a.producto}</td>
                    {variasSucursales && <td className={TD}>{a.sucursal}</td>}
                    <td className={TD}>
                      {TEXTO_MOTIVO[a.motivo]}
                      <span className="block text-xs text-tinta-tenue">
                        {AYUDA_MOTIVO[a.motivo]}
                      </span>
                    </td>
                    <td className={NUM}>{cantidad(a.cantidad)}</td>
                    <td className={NUM}>{pesos(a.importe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tarjeta>
      )}
    </>
  );
}

function TablaConsumo({
  filas,
  variasSucursales,
  sucursal,
}: {
  filas: FilaConsumo[];
  variasSucursales: boolean;
  sucursal: (id: string) => string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="tabla-consumo">
        <caption className="sr-only">
          Ranking de variaciones: primero lo que más dinero falta.
        </caption>
        <thead className="text-left text-tinta-suave">
          <tr>
            <th className={TH}>Insumo</th>
            {variasSucursales && <th className={TH}>Sucursal</th>}
            <th className={`${TH} text-right`}>Teórico</th>
            <th className={`${TH} text-right`}>Consumo</th>
            <th className={`${TH} text-right`}>Merma</th>
            <th className={`${TH} text-right`}>Ajuste</th>
            <th className={`${TH} text-right`}>Real</th>
            <th className={`${TH} text-right`}>Variación</th>
            <th className={`${TH} text-right`}>%</th>
            <th className={`${TH} text-right`}>Importe</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            const s = sentidoVariacion(f);
            return (
              <tr key={`${f.sucursalId}|${f.insumoOrigenSrId}`} className="border-t border-linea">
                <td className={TD}>
                  {nombreInsumo(f)}
                  {f.unidad && <span className="text-tinta-tenue"> · {f.unidad}</span>}
                  {f.sinTeorico && (
                    <span className="ml-1 text-xs text-tinta-medio">
                      (ningún producto vendido lo explica)
                    </span>
                  )}
                </td>
                {variasSucursales && <td className={TD}>{sucursal(f.sucursalId)}</td>}
                <td className={NUM}>{cantidad(f.teorico)}</td>
                <td className={NUM}>{cant(f.consumo)}</td>
                <td className={NUM}>{cant(f.merma)}</td>
                <td className={NUM}>{cant(f.ajuste)}</td>
                <td className={NUM}>{cant(f.real)}</td>
                <td className={`${NUM} ${COLOR_SENTIDO[s]}`}>
                  {f.variacion === null ? '—' : conSigno(f.variacion)}
                  <span className="block text-xs">{s}</span>
                </td>
                <td className={NUM}>{textoPorcentaje(f.porcentaje)}</td>
                <td className={NUM}>{dinero(f.importeVariacion)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ListaRecetas({ r, variasSucursales }: { r: DatosRecetas; variasSucursales: boolean }) {
  const [q, setQ] = useState('');
  const [abierta, setAbierta] = useState<string | null>(null);
  const v = vacioRecetas(r);
  if (v.tipo === 'sin-recetas') {
    return (
      <Tarjeta titulo="Recetas por producto">
        <div className="space-y-2 text-sm" data-testid="recetas-vacio">
          <p>{v.porque}</p>
          <p className="text-tinta-medio">{v.falta}</p>
        </div>
      </Tarjeta>
    );
  }
  const sucursal = (id: string) => r.sucursales.find((s) => s.sucursalId === id)?.sucursal ?? '';
  const filas = filtrarRecetas(r.productos, q);
  const conReceta = filas.filter((p) => p.conReceta);
  const sinReceta = filas.filter((p) => !p.conReceta);
  const llave = (p: ProductoReceta) => `${p.sucursalId}|${p.productoOrigenSrId}`;
  return (
    <Tarjeta titulo="Recetas por producto">
      <p className="mb-3 text-sm text-tinta-medio">
        El costo es la suma de cada insumo por su costo promedio en existencias, sin IVA. El % se
        calcula sobre el precio del POS, que puede traer IVA.
      </p>
      <label className="mb-3 flex flex-wrap items-center gap-2 text-sm text-tinta-suave">
        Buscar
        <input
          type="search"
          className={CONTROL}
          value={q}
          maxLength={100}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nombre o clave"
        />
      </label>
      {r.truncado && (
        <p className="mb-2 text-sm text-tinta-medio">
          Se muestran los primeros {r.productos.length} de {r.total} productos.
        </p>
      )}
      {conReceta.length === 0 ? (
        <Vacio>Ningún producto con receta coincide con la búsqueda.</Vacio>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="tabla-recetas">
            <thead className="text-left text-tinta-suave">
              <tr>
                <th className={TH}>Producto</th>
                {variasSucursales && <th className={TH}>Sucursal</th>}
                <th className={`${TH} text-right`}>Insumos</th>
                <th className={`${TH} text-right`}>Costo</th>
                <th className={`${TH} text-right`}>Precio</th>
                <th className={`${TH} text-right`}>% del precio</th>
              </tr>
            </thead>
            <tbody>
              {conReceta.map((p) => {
                const k = llave(p);
                const abiertaEsta = abierta === k;
                return (
                  <Fragment key={k}>
                    <tr className="border-t border-linea">
                      <td className={TD}>
                        <button
                          type="button"
                          className={ENLACE}
                          aria-expanded={abiertaEsta}
                          onClick={() => setAbierta(abiertaEsta ? null : k)}
                        >
                          {nombreProducto(p)}
                        </button>
                        {!p.vigente && p.enCatalogo && (
                          <span className="ml-1 text-xs text-tinta-medio">(de baja)</span>
                        )}
                      </td>
                      {variasSucursales && <td className={TD}>{sucursal(p.sucursalId)}</td>}
                      <td className={NUM}>{p.renglones.length}</td>
                      <td className={NUM}>
                        {dinero(p.costo)}
                        {p.costoIncompleto && (
                          <span className="block text-xs text-tinta-medio">incompleto</span>
                        )}
                      </td>
                      <td className={NUM}>{dinero(p.precio)}</td>
                      <td className={NUM}>{textoPorcentaje(p.porcentajePrecio)}</td>
                    </tr>
                    {abiertaEsta && (
                      <tr>
                        <td colSpan={variasSucursales ? 6 : 5} className="bg-realce px-2 py-2">
                          <DetalleReceta p={p} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {sinReceta.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-tinta-suave">Productos sin receta</h3>
          <p className="mt-1 text-sm text-tinta-medio" data-testid="sin-receta">
            {sinReceta
              .map((p) =>
                variasSucursales
                  ? `${nombreProducto(p)} (${sucursal(p.sucursalId)})`
                  : nombreProducto(p),
              )
              .join(', ')}
          </p>
        </div>
      )}
    </Tarjeta>
  );
}

function DetalleReceta({ p }: { p: ProductoReceta }) {
  return (
    <table className="w-full text-sm" aria-label={`Receta de ${nombreProducto(p)}`}>
      <thead className="text-left text-tinta-suave">
        <tr>
          <th className={TH}>Insumo</th>
          <th className={`${TH} text-right`}>Por unidad vendida</th>
          <th className={`${TH} text-right`}>Costo unitario</th>
          <th className={`${TH} text-right`}>Importe</th>
        </tr>
      </thead>
      <tbody>
        {p.renglones.map((x, i) => (
          <tr key={`${x.insumoOrigenSrId}|${i}`}>
            <td className={TD}>{nombreInsumo(x)}</td>
            <td className={NUM}>
              {cantidad(x.cantidad)}
              {x.unidad && <span className="text-tinta-tenue"> {x.unidad}</span>}
            </td>
            <td className={NUM}>{x.costo === null ? 'Sin costo' : pesos(x.costo)}</td>
            <td className={NUM}>{dinero(x.importe)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
