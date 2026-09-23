import { Fragment, useState } from 'react';

import { useFiltroAlcance } from '../alertas/consultas';
import type { CompraResumen, Compras as DatosCompras } from '../api/tipos';
import { descargar, ErrorCsv, nombreCsv } from '../csv/csv';
import { pesos } from '../dinero/dinero';
import { useAlcance } from '../filtros/alcance';
import { usePeriodo } from '../filtros/usePeriodo';
import { useCompra, useCompras } from './finanzas/consultas';
import { comprasACsv, sucursalesSinCompras, vacioCompras } from './finanzas/reglas';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from './inicio/Tarjeta';
import { cantidad, fechaHoraEn, fechaParaTabla } from './tickets/formato';
import { Vista } from './Vista';

const TH = 'px-2 py-1 font-medium';
const TD = 'px-2 py-2';
const NUM = 'px-2 py-2 text-right tabular-nums whitespace-nowrap';
const BOTON =
  'rounded-md border border-linea-fuerte bg-superficie px-3 py-1 text-sm text-tinta-medio hover:bg-realce disabled:opacity-50';
const ENLACE = 'text-left text-acento-texto underline-offset-2 hover:underline';

/**
 * Compras (F2-126): las compras a proveedor que SoftRestaurant registró en el periodo, leídas por
 * el agente. Resumen por proveedor, la lista con su detalle y el CSV. Una compra cancelada se ve
 * marcada y no suma. Nada de esto se escribe en SoftRestaurant.
 */
export function Compras() {
  const filtro = useFiltroAlcance();
  const { rango } = usePeriodo();
  const compras = useCompras(filtro, rango);

  return (
    <Vista titulo="Compras">
      <p className="mb-4 text-sm text-tinta-tenue">
        Las compras a proveedor registradas en SoftRestaurant, sin IVA. Para ver lo que dejó el
        periodo, ve a Gastos y utilidad: ahí el costo es lo que las ventas consumieron, no lo que se
        compró.
      </p>
      {rango === null ? (
        <Tarjeta titulo="Compras del periodo">
          <Vacio>El rango de fechas no es válido: corrígelo en la cabecera para consultar.</Vacio>
        </Tarjeta>
      ) : filtro === null ? (
        <Tarjeta titulo="Compras del periodo">
          <Esqueleto lineas={4} />
        </Tarjeta>
      ) : (
        <SegunEstado consulta={compras} esqueleto={<Esqueleto lineas={6} />}>
          {(c) => (
            <ListaCompras
              c={c}
              empresaId={filtro.empresaId}
              desde={rango.desde}
              hasta={rango.hasta}
            />
          )}
        </SegunEstado>
      )}
    </Vista>
  );
}

function ListaCompras({
  c,
  empresaId,
  desde,
  hasta,
}: {
  c: DatosCompras;
  empresaId: string;
  desde: string;
  hasta: string;
}) {
  const { sucursales, sucursal } = useAlcance();
  const [abierta, setAbierta] = useState<string | null>(null);
  const [errorCsv, setErrorCsv] = useState<string | null>(null);
  const vacio = vacioCompras(c);
  const sinLector = sucursalesSinCompras(c);
  const suc = (id: string) => sucursales.data?.find((s) => s.id === id);
  const nombre = (id: string) =>
    suc(id)?.nombre ?? c.sucursales.find((s) => s.sucursalId === id)?.sucursal ?? '';
  const fechaHora = (x: CompraResumen) => {
    const zona = suc(x.sucursalId)?.zonaHoraria;
    return zona ? fechaHoraEn(zona, x.fecha) : null;
  };
  const exportar = () => {
    try {
      descargar(
        nombreCsv('compras', desde, hasta, sucursal?.nombre),
        comprasACsv(c.compras, nombre, fechaHora),
      );
      setErrorCsv(null);
    } catch (err) {
      setErrorCsv(err instanceof ErrorCsv ? err.message : 'No se pudo generar el archivo.');
    }
  };

  if (vacio) {
    return (
      <Tarjeta titulo="Compras del periodo">
        <Vacio>
          <span data-testid={`compras-vacio-${vacio.tipo}`}>{vacio.texto}</span>
        </Vacio>
      </Tarjeta>
    );
  }
  const variasSucursales = c.sucursales.length > 1;
  return (
    <>
      <Tarjeta titulo="Por proveedor">
        <p className="mb-2 text-sm">
          Total del periodo sin canceladas:{' '}
          <span className="font-medium tabular-nums" data-testid="compras-total">
            {pesos(c.total)}
          </span>
        </p>
        {sinLector.length > 0 && (
          <p className="mb-2 text-sm text-aviso" data-testid="compras-sin-lector">
            {sinLector.join(', ')}: todavía no manda compras (llegan con el lector de compras,
            F2-241). Su ausencia no quiere decir que no compró.
          </p>
        )}
        <ul className="space-y-1 text-sm" data-testid="por-proveedor">
          {c.porProveedor.map((p) => (
            <li
              key={`${p.sucursalId}|${p.proveedorOrigenSrId ?? ''}`}
              className="flex justify-between gap-2"
            >
              <span className="min-w-0 truncate">
                {p.proveedor ??
                  (p.proveedorOrigenSrId
                    ? `Proveedor ${p.proveedorOrigenSrId} (sin catálogo)`
                    : 'Sin proveedor')}
                {variasSucursales && (
                  <span className="text-tinta-tenue"> · {nombre(p.sucursalId)}</span>
                )}
                <span className="text-tinta-tenue">
                  {' '}
                  · {p.compras} {p.compras === 1 ? 'compra' : 'compras'}
                </span>
              </span>
              <span className="tabular-nums">{pesos(p.total)}</span>
            </li>
          ))}
        </ul>
      </Tarjeta>
      <div className="mt-4">
        <Tarjeta titulo="Compras del periodo">
          {c.truncado && (
            <p className="mb-2 text-sm text-aviso" data-testid="compras-truncado">
              Hay {c.totalCompras} compras en el periodo y se muestran las 2000 más recientes: la
              lista y su CSV van recortados (el total y el resumen por proveedor no). Acota el
              periodo o elige una sucursal.
            </p>
          )}
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-max text-sm" data-testid="tabla-compras">
              <thead className="text-left text-tinta-tenue">
                <tr>
                  <th scope="col" className={TH}>
                    Fecha
                  </th>
                  {variasSucursales && (
                    <th scope="col" className={TH}>
                      Sucursal
                    </th>
                  )}
                  <th scope="col" className={TH}>
                    Folio
                  </th>
                  <th scope="col" className={TH}>
                    Proveedor
                  </th>
                  <th scope="col" className={TH}>
                    Almacén
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Total sin IVA
                  </th>
                </tr>
              </thead>
              <tbody>
                {c.compras.map((x) => {
                  const fh = fechaHora(x);
                  return (
                    <Fragment key={x.id}>
                      <tr
                        className={`border-t border-linea-suave ${x.cancelada ? 'text-tinta-tenue' : ''}`}
                      >
                        <td className={TD}>
                          {fh ? `${fechaParaTabla(fh.fecha)} ${fh.hora}` : 'Sin dato'}
                        </td>
                        {variasSucursales && <td className={TD}>{nombre(x.sucursalId)}</td>}
                        <td className={TD}>
                          <button
                            type="button"
                            className={ENLACE}
                            aria-expanded={abierta === x.id}
                            onClick={() => setAbierta(abierta === x.id ? null : x.id)}
                          >
                            {x.folio}
                          </button>
                          {x.cancelada && <span className="ml-1">(cancelada)</span>}
                        </td>
                        <td className={TD}>
                          {x.proveedor ?? (x.proveedorOrigenSrId ? `${x.proveedorOrigenSrId} (sin catálogo)` : '—')}
                        </td>
                        <td className={TD}>
                          {x.almacen ?? (x.almacenOrigenSrId ? `${x.almacenOrigenSrId} (sin catálogo)` : '—')}
                        </td>
                        <td className={`${NUM} ${x.cancelada ? 'line-through' : ''}`}>
                          {pesos(x.total)}
                        </td>
                      </tr>
                      {abierta === x.id && (
                        <tr>
                          <td colSpan={variasSucursales ? 6 : 5} className="bg-realce px-2 py-2">
                            <Detalle empresaId={empresaId} id={x.id} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className={BOTON} onClick={exportar}>
              Exportar CSV
            </button>
            {errorCsv && (
              <p role="alert" className="text-sm text-peligro">
                {errorCsv}
              </p>
            )}
          </div>
        </Tarjeta>
      </div>
    </>
  );
}

function Detalle({ empresaId, id }: { empresaId: string; id: string }) {
  const compra = useCompra(empresaId, id);
  return (
    <SegunEstado consulta={compra} esqueleto={<Esqueleto lineas={2} />}>
      {(d) => (
        <table className="w-full text-xs" data-testid="detalle-compra">
          <thead className="text-left text-tinta-tenue">
            <tr>
              <th scope="col" className={TH}>
                Insumo
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Cantidad
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Costo unitario
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Importe
              </th>
            </tr>
          </thead>
          <tbody>
            {d.detalle.map((p) => (
              <tr key={p.renglon}>
                <td className="px-2 py-1">
                  {p.insumo ?? `${p.insumoOrigenSrId} (sin catálogo)`}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {cantidad(p.cantidad)}
                  {p.unidad ? ` ${p.unidad}` : ''}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">{pesos(p.costoUnitario)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{pesos(p.importe)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SegunEstado>
  );
}
