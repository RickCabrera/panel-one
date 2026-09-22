import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useFiltroAlcance } from '../alertas/consultas';
import { ErrorApi } from '../api/cliente';
import type { CanalNegocio, FilaMapeoArea } from '../api/tipos';
import { useUsuario } from '../auth/contexto';
import { ROLES_ADMIN } from '../auth/roles';
import { useAlcance } from '../filtros/alcance';
import { incluyeHoy } from '../filtros/periodo';
import { usePeriodo } from '../filtros/usePeriodo';
import { BotonCsv } from './analisis/Bloques';
import { useAnalisis } from './analisis/consultas';
import { BloqueAreas } from './areas/Bloques';
import { asignarCanal, useMapeoAreas } from './areas/consultas';
import { areasACsv, nombreCsvAreas } from './areas/csv';
import { CANALES, canalTexto, mapeoPorSucursal, NOMBRE_CANAL } from './areas/reglas';
import { ESTACIONES_PENDIENTES } from './areas/textos';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from './inicio/Tarjeta';
import { Vista } from './Vista';

const TH = 'px-2 py-1 font-medium';
const TD = 'px-2 py-2';
const CONTROL =
  'min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-1 text-sm focus:border-acento-borde focus:outline-none disabled:opacity-50';

/**
 * Áreas y canales (F2-233): la venta del periodo por canal de negocio y por área del POS, y el
 * mapeo área → canal, que es NUESTRO (cada restaurante nombra sus áreas distinto). Cambiar el
 * canal de un área recalcula cualquier periodo al instante, sin re-ingerir nada.
 */
export function Areas() {
  const filtro = useFiltroAlcance();
  const { rango, hoy } = usePeriodo();
  const { sucursal } = useAlcance();
  const usuario = useUsuario();
  const esAdmin = ROLES_ADMIN.includes(usuario.rol);
  const auto = rango !== null && incluyeHoy(rango, hoy);
  const venta = useAnalisis('por-area', filtro, rango, auto);
  const mapeo = useMapeoAreas(filtro);

  return (
    <Vista titulo="Áreas y canales">
      <p className="mb-4 text-sm text-tinta-tenue">
        Cada cuenta del POS dice en qué área se atendió (comedor, terraza, barra…). El canal de
        negocio de cada área lo decides aquí, porque cada restaurante nombra las suyas distinto. Lo
        que no se puede clasificar se muestra aparte, nunca repartido a ojo.
      </p>
      <div className="grid min-w-0 grid-cols-1 gap-4">
        <Tarjeta titulo="Venta del periodo por canal y por área">
          {rango === null ? (
            <Vacio>Elige un periodo válido para ver la venta por canal.</Vacio>
          ) : (
            <SegunEstado consulta={venta} esqueleto={<Esqueleto lineas={5} />}>
              {(datos) => (
                <>
                  {datos.cuentas > 0 && (
                    <div className="mb-2 flex justify-end">
                      <BotonCsv
                        nombre={nombreCsvAreas(rango, sucursal?.nombre)}
                        generar={() => areasACsv(datos)}
                        testId="areas-csv"
                      />
                    </div>
                  )}
                  <BloqueAreas datos={datos} />
                </>
              )}
            </SegunEstado>
          )}
        </Tarjeta>

        <Tarjeta titulo="Canal de cada área">
          <SegunEstado consulta={mapeo} esqueleto={<Esqueleto lineas={4} />}>
            {(m) => (
              <div className="flex min-w-0 flex-col gap-4" data-testid="mapeo-areas">
                {!esAdmin && (
                  <p className="text-sm text-tinta-tenue">
                    Sólo un administrador puede cambiar el canal de un área.
                  </p>
                )}
                {m.truncado && (
                  <p className="text-sm text-aviso">
                    Hay más áreas de las que se muestran: la lista está cortada.
                  </p>
                )}
                {mapeoPorSucursal(m).map((s) => (
                  <section key={s.sucursalId} className="min-w-0" aria-label={s.sucursal}>
                    <h3 className="mb-1 text-sm font-medium">{s.sucursal}</h3>
                    {s.ultimaCompletaAt === null ? (
                      <p className="text-sm text-tinta-tenue" data-testid="mapeo-sin-catalogo">
                        Esta sucursal todavía no manda su catálogo de áreas: no hay áreas que
                        asignar. Hace falta que el agente de la sucursal sincronice sus catálogos
                        (un administrador puede pedirlo desde Productos → Pedir sincronización).
                      </p>
                    ) : s.areas.length === 0 ? (
                      <p className="text-sm text-tinta-tenue">
                        El catálogo de áreas de esta sucursal llegó vacío.
                      </p>
                    ) : (
                      <TablaMapeo
                        empresaId={filtro!.empresaId}
                        areas={s.areas}
                        editable={esAdmin}
                      />
                    )}
                  </section>
                ))}
              </div>
            )}
          </SegunEstado>
        </Tarjeta>

        <Tarjeta titulo="Estaciones">
          <p className="py-2 text-sm text-tinta-tenue" data-testid="estaciones-pendiente">
            {ESTACIONES_PENDIENTES}
          </p>
        </Tarjeta>
      </div>
    </Vista>
  );
}

function TablaMapeo({
  empresaId,
  areas,
  editable,
}: {
  empresaId: string;
  areas: FilaMapeoArea[];
  editable: boolean;
}) {
  const cliente = useQueryClient();
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cambiar = async (a: FilaMapeoArea, valor: string) => {
    const canal = valor === '' ? null : (valor as CanalNegocio);
    setGuardando(a.id);
    setError(null);
    try {
      await asignarCanal(empresaId, a.id, canal);
      await Promise.all([
        cliente.invalidateQueries({ queryKey: ['catalogos', 'areas-mapeo'] }),
        cliente.invalidateQueries({ queryKey: ['ventas', 'por-area'] }),
      ]);
    } catch (e) {
      setError(
        `No se guardó el canal de ${a.nombre}. ${e instanceof ErrorApi ? e.message : 'Error inesperado.'}`,
      );
    } finally {
      setGuardando(null);
    }
  };

  return (
    <>
      {error && (
        <p role="alert" className="mb-1 text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead className="text-left text-tinta-tenue">
            <tr>
              <th scope="col" className={TH}>
                Área
              </th>
              <th scope="col" className={TH}>
                Id en el POS
              </th>
              <th scope="col" className={TH}>
                Estado
              </th>
              <th scope="col" className={TH}>
                Canal
              </th>
            </tr>
          </thead>
          <tbody>
            {areas.map((a) => (
              <tr key={a.id} className="border-t border-linea" data-area={a.origenSrId}>
                <td className={TD}>{a.nombre}</td>
                <td className={`${TD} tabular-nums`}>{a.origenSrId}</td>
                <td className={TD}>{a.activo ? 'En el catálogo' : 'Ya no está en el POS'}</td>
                <td className={TD}>
                  {editable ? (
                    <select
                      className={CONTROL}
                      aria-label={`Canal de ${a.nombre}`}
                      value={a.canal ?? ''}
                      disabled={guardando !== null}
                      onChange={(e) => void cambiar(a, e.target.value)}
                    >
                      <option value="">Sin asignar</option>
                      {CANALES.map((c) => (
                        <option key={c} value={c}>
                          {NOMBRE_CANAL[c]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    canalTexto(a.canal)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
