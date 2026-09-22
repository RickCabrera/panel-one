import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { useFiltroAlcance } from '../alertas/consultas';
import type { Menu as MenuDatos, ProductoMenu, SucursalMenu } from '../api/tipos';
import { pesos } from '../dinero/dinero';
import { usePeriodo } from '../filtros/usePeriodo';
import { queryVista } from '../filtros/vista';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from './inicio/Tarjeta';
import { useMenu, useSinCatalogo } from './productos/consultas';
import { Vista } from './Vista';

/** Lo que dice cada celda de precio. Nunca un `$0.00` inventado. */
function Celda({ producto, sucursal }: { producto: ProductoMenu; sucursal: SucursalMenu }) {
  const filas = producto.precios.filter((p) => p.sucursalId === sucursal.sucursalId);
  if (filas.length === 0) {
    return (
      <span className="text-tinta-tenue" title="No está en el catálogo de esta sucursal">
        —<span className="sr-only">No está en esta sucursal</span>
      </span>
    );
  }
  return (
    <>
      {filas.map((f) => (
        <div key={f.productoId}>
          {f.precio === null ? (
            <span className="text-tinta-tenue">Sin precio</span>
          ) : (
            <span className="tabular-nums">{pesos(f.precio)}</span>
          )}
          {!f.vigente && <span className="ml-1 text-xs text-tinta-tenue">(baja en el POS)</span>}
        </div>
      ))}
    </>
  );
}

function Insignias({ p }: { p: ProductoMenu }) {
  return (
    <div className="mt-0.5 flex flex-wrap gap-1 text-xs">
      {p.discrepancia && (
        <span className="rounded bg-aviso-fondo px-1.5 py-0.5 font-semibold text-aviso">
          Precio distinto: {pesos(p.precioMin!)} a {pesos(p.precioMax!)}
        </span>
      )}
      {p.gruposDistintos && (
        <span className="rounded bg-realce px-1.5 py-0.5 text-tinta-medio">
          En otro grupo en alguna sucursal
        </span>
      )}
      {p.duplicadoEnSucursal && (
        <span className="rounded bg-realce px-1.5 py-0.5 text-tinta-medio">
          Clave repetida en una sucursal
        </span>
      )}
      {p.criterio === 'nombre' && (
        <span className="rounded bg-realce px-1.5 py-0.5 text-tinta-medio">
          Sin clave: cruzado por nombre
        </span>
      )}
    </div>
  );
}

function Resumen({ m }: { m: MenuDatos }) {
  if (m.sucursales.length < 2) {
    return (
      <p>
        Con una sola sucursal a la vista no hay precios que comparar. Elige “Todas las sucursales”
        para ver las diferencias.
      </p>
    );
  }
  return m.discrepancias === 0 ? (
    <p data-testid="menu-resumen">
      Los {m.productos} productos del menú tienen el mismo precio en todas las sucursales que los
      tienen.
    </p>
  ) : (
    <p data-testid="menu-resumen">
      <strong className="text-aviso">
        {m.discrepancias} producto{m.discrepancias === 1 ? '' : 's'} con precio distinto entre
        sucursales
      </strong>{' '}
      de {m.productos} en el menú.
    </p>
  );
}

/**
 * Orquestador de menú (F2-145): el menú de cada sucursal, lado a lado y por categoría, con
 * los precios distintos señalados, y lo que se vendió sin estar en el catálogo. Sólo
 * lectura: el menú lo manda el POS.
 */
export function Menu() {
  const filtro = useFiltroAlcance();
  const { rango } = usePeriodo();
  const [parametros] = useSearchParams();
  const [soloDistintos, setSoloDistintos] = useState(false);
  const menu = useMenu(filtro);
  const sinCatalogo = useSinCatalogo(filtro, rango);

  return (
    <Vista titulo="Orquestador de menú">
      <p className="mb-4 text-sm text-tinta-tenue">
        El menú tal como lo tiene el POS de cada sucursal. Los precios se muestran como los reporta
        el POS (no se sabe todavía si incluyen IVA) y aquí no se cambian. El mismo producto se
        reconoce en otra sucursal por su clave del POS; si no tiene clave, por su nombre. Los datos
        propios de cada producto se editan en{' '}
        <Link
          to={{ pathname: '/productos', search: queryVista(parametros) }}
          className="text-acento-texto underline-offset-2 hover:underline"
        >
          Productos
        </Link>
        .
      </p>

      <SegunEstado consulta={menu} esqueleto={<Esqueleto lineas={6} />}>
        {(m) => {
          const nunca = m.sucursales.filter((s) => s.sincronizadoAt === null);
          if (m.productos === 0) {
            return (
              <Tarjeta titulo="Menú">
                <Vacio>
                  {m.sucursales.length === 0
                    ? 'Esta empresa todavía no tiene sucursales.'
                    : nunca.length === m.sucursales.length
                      ? 'Todavía no hay catálogo de productos: ninguna sucursal ha enviado su primera sincronización completa. Hace falta el agente instalado y conectado, con la lectura de catálogos del POS.'
                      : 'Los catálogos sincronizados no tienen productos vigentes.'}
                </Vacio>
              </Tarjeta>
            );
          }
          const categorias = m.categorias
            .map((c) => ({
              ...c,
              productos: soloDistintos ? c.productos.filter((p) => p.discrepancia) : c.productos,
            }))
            .filter((c) => c.productos.length > 0);
          return (
            <>
              <Tarjeta titulo="Precios entre sucursales">
                <div className="text-sm">
                  <Resumen m={m} />
                  {nunca.length > 0 && (
                    <p className="mt-1 text-tinta-medio" data-testid="menu-sin-sincronizar">
                      Sin catálogo sincronizado: {nunca.map((s) => s.sucursal).join(', ')}. Sus
                      columnas salen vacías hasta que su agente mande el catálogo.
                    </p>
                  )}
                  {m.truncado && (
                    <p role="alert" className="mt-1 text-peligro">
                      El catálogo es más grande de lo que esta vista muestra: sólo se ven los
                      primeros 5000 renglones y las cifras no están completas.
                    </p>
                  )}
                  <label className="mt-3 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={soloDistintos}
                      onChange={(e) => setSoloDistintos(e.target.checked)}
                    />
                    Sólo productos con precio distinto
                  </label>
                </div>
              </Tarjeta>

              {categorias.length === 0 ? (
                <Tarjeta titulo="Menú" className="mt-4">
                  <Vacio>Ningún producto tiene precio distinto entre sucursales.</Vacio>
                </Tarjeta>
              ) : (
                categorias.map((c) => (
                  <Tarjeta key={c.grupo ?? ''} titulo={c.grupo ?? 'Sin grupo'} className="mt-4">
                    <div className="overflow-x-auto">
                      <table
                        className="w-full min-w-0 text-left text-sm"
                        data-testid="menu-categoria"
                      >
                        <thead className="text-xs text-tinta-suave">
                          <tr>
                            <th className="py-1 pr-3 font-medium">Producto</th>
                            {m.sucursales.map((s) => (
                              <th key={s.sucursalId} className="py-1 pr-3 text-right font-medium">
                                {s.sucursal}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-linea">
                          {c.productos.map((p) => (
                            <tr
                              key={p.llave}
                              data-discrepancia={p.discrepancia ? 'si' : 'no'}
                              className="align-top"
                            >
                              <td className="py-2 pr-3">
                                <div className="font-medium">{p.nombre}</div>
                                <div className="text-xs text-tinta-tenue">
                                  {p.clave ?? 'Sin clave'}
                                </div>
                                <Insignias p={p} />
                              </td>
                              {m.sucursales.map((s) => (
                                <td
                                  key={s.sucursalId}
                                  className="py-2 pr-3 text-right whitespace-nowrap"
                                >
                                  <Celda producto={p} sucursal={s} />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Tarjeta>
                ))
              )}
            </>
          );
        }}
      </SegunEstado>

      <Tarjeta titulo="Vendidos sin estar en el catálogo" className="mt-4">
        <p className="mb-2 text-xs text-tinta-tenue">
          Productos de las cuentas cerradas del periodo cuyo nombre no está en el catálogo de su
          sucursal. Se comparan por nombre (el ticket no trae la clave): un producto que se renombró
          en el POS dentro del periodo aparece aquí con su nombre anterior. El importe es la suma de
          las partidas, antes del descuento de la cuenta.
        </p>
        {rango === null ? (
          <Vacio>Elige un periodo válido para revisar lo vendido.</Vacio>
        ) : (
          <SegunEstado consulta={sinCatalogo} esqueleto={<Esqueleto lineas={3} />}>
            {(v) => (
              <>
                {v.sucursalesSinCatalogo.length > 0 && (
                  <p
                    className="mb-2 text-sm text-tinta-medio"
                    data-testid="sin-catalogo-pendientes"
                  >
                    No se revisan {v.sucursalesSinCatalogo.map((s) => s.sucursal).join(', ')}:
                    todavía no tienen una sincronización completa de su catálogo, y contra un
                    catálogo incompleto todo parecería “sin catálogo”.
                  </p>
                )}
                {v.filas.length === 0 ? (
                  <Vacio>
                    {v.sucursalesSinCatalogo.length === 0
                      ? 'Todo lo vendido en el periodo está en el catálogo de su sucursal.'
                      : menu.data && v.sucursalesSinCatalogo.length >= menu.data.sucursales.length
                        ? 'Ninguna sucursal tiene todavía su catálogo completo: no hay contra qué comparar lo vendido.'
                        : 'En las sucursales con catálogo completo, todo lo vendido en el periodo está en su catálogo.'}
                  </Vacio>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-0 text-left text-sm" data-testid="sin-catalogo">
                      <thead className="text-xs text-tinta-suave">
                        <tr>
                          <th className="py-1 pr-3 font-medium">
                            Producto (como llegó en el ticket)
                          </th>
                          <th className="py-1 pr-3 font-medium">Sucursal</th>
                          <th className="py-1 pr-3 text-right font-medium">Partidas</th>
                          <th className="py-1 pr-3 text-right font-medium">Cantidad</th>
                          <th className="py-1 pr-3 text-right font-medium">Importe</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-linea">
                        {v.filas.map((f) => (
                          <tr key={`${f.sucursalId}|${f.producto}`}>
                            <td className="py-2 pr-3">
                              {f.producto}
                              {f.variantes > 1 && (
                                <span className="ml-1 text-xs text-tinta-tenue">
                                  ({f.variantes} escrituras)
                                </span>
                              )}
                            </td>
                            <td className="py-2 pr-3">{f.sucursal}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{f.partidas}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{f.cantidad}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {pesos(f.importe)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {v.truncado && (
                      <p role="alert" className="mt-2 text-sm text-peligro">
                        Hay {v.total} renglones; sólo se muestran los primeros {v.filas.length}.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </SegunEstado>
        )}
      </Tarjeta>
    </Vista>
  );
}
