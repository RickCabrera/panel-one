import { useState } from 'react';

import type { VentaPorArea } from '../../api/tipos';
import { pesos } from '../../dinero/dinero';
import { Cuadre, Paginador } from '../analisis/Bloques';
import { paginar } from '../analisis/reglas';
import {
  canalTexto,
  estadoArea,
  filasCanal,
  motivoVacio,
  nombreArea,
  participacionArea,
  SIN_CANAL,
  sinCatalogo,
  sumaCanales,
} from './reglas';

const TH = 'px-2 py-1 font-medium';
const TD = 'px-2 py-1';
const NUM = 'px-2 py-1 text-right tabular-nums whitespace-nowrap';

/**
 * Venta por canal y por área del periodo (F2-233), la misma en Análisis y en Áreas y canales.
 * La tabla por canal lleva "área sin canal asignado" y "sin clasificar" como renglones propios:
 * nada se reparte a ojo, y su Σ es la venta del periodo. La tabla por área va de 50 en 50.
 */
export function BloqueAreas({ datos }: { datos: VentaPorArea }) {
  const [pagina, setPagina] = useState(1);
  const vacio = motivoVacio(datos);
  const faltan = sinCatalogo(datos);
  const canales = filasCanal(datos);
  const p = paginar(datos.areas, pagina);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {faltan.length > 0 && (
        <p className="text-sm text-aviso" data-testid="areas-sin-catalogo">
          {faltan.join(', ')}: el agente todavía no ha mandado su catálogo de áreas, así que sus
          áreas no tienen nombre ni canal y su venta cuenta como "{SIN_CANAL}".
          Hace falta que el agente de la sucursal sincronice sus catálogos.
        </p>
      )}
      {vacio !== null && (
        <p className="py-2 text-sm text-tinta-tenue" data-testid="areas-vacio">
          {vacio}
        </p>
      )}
      {datos.cuentas > 0 && (
        <>
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-max text-sm" data-testid="tabla-canales">
              <caption className="pb-1 text-left text-xs text-tinta-tenue">Por canal</caption>
              <thead className="text-left text-tinta-tenue">
                <tr>
                  <th scope="col" className={TH}>
                    Canal
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Venta
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Cuentas
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Participación
                  </th>
                </tr>
              </thead>
              <tbody>
                {canales.map((c) => (
                  <tr key={c.llave} className="border-t border-linea" data-canal={c.llave}>
                    <td className={TD}>{c.nombre}</td>
                    <td className={NUM}>{pesos(c.venta)}</td>
                    <td className={NUM}>{c.cuentas}</td>
                    <td className={NUM}>{c.participacion ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Cuadre suma={sumaCanales(datos)} venta={datos.venta} testId="cuadre-areas" />
        </>
      )}
      {datos.areas.length > 0 && (
        <>
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-max text-sm" data-testid="tabla-areas">
              <caption className="pb-1 text-left text-xs text-tinta-tenue">Por área</caption>
              <thead className="text-left text-tinta-tenue">
                <tr>
                  <th scope="col" className={TH}>
                    Sucursal
                  </th>
                  <th scope="col" className={TH}>
                    Área
                  </th>
                  <th scope="col" className={TH}>
                    Estado
                  </th>
                  <th scope="col" className={TH}>
                    Canal
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Venta
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Cuentas
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Participación
                  </th>
                </tr>
              </thead>
              <tbody>
                {p.filas.map((a) => (
                  <tr key={`${a.sucursalId}|${a.areaOrigenSrId}`} className="border-t border-linea">
                    <td className={TD}>{a.sucursal}</td>
                    <td className={TD}>{nombreArea(a)}</td>
                    <td className={TD}>{estadoArea(a)}</td>
                    <td className={TD}>{canalTexto(a.canal)}</td>
                    <td className={NUM}>{pesos(a.venta)}</td>
                    <td className={NUM}>{a.cuentas}</td>
                    <td className={NUM}>{participacionArea(a, datos) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginador
            pagina={p.pagina}
            paginas={p.paginas}
            total={datos.areas.length}
            cambiar={setPagina}
            etiqueta="areas"
          />
        </>
      )}
    </div>
  );
}
