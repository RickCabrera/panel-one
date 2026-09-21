import type { Empresa, EstadoAgenteSucursal } from '../../api/tipos';
import { horaEn } from '../../filtros/periodo';
import { edadLegible } from '../inicio/ventaEnVivo';
import { useAhora } from '../mesas/consultas';
import { UMBRAL_DESCONEXION_S } from '../mesas/reglas';
import { edadAhora, estadoAgente, UMBRAL_ALERTA_S, type EstadoAgente } from './reglasAgentes';
import { useEstadoAgentes } from './consultas';
import { CLASE_TABLA } from './estilos';

const TEXTO_ESTADO: Record<EstadoAgente, string> = {
  conectado: 'Conectado',
  desconectado: 'Desconectado',
  'sin-reporte': 'Sin reporte',
};

const COLOR_ESTADO: Record<EstadoAgente, string> = {
  conectado: 'bg-emerald-100 text-emerald-800',
  desconectado: 'bg-red-100 text-red-800',
  'sin-reporte': 'bg-slate-100 text-slate-600',
};

const SIN_DATO = 'Sin dato';

/** "hace 3 min (14:05)" en la zona de la sucursal, o "Sin dato". */
function cuando(edad: number | null, instante: string | null, zona: string): string {
  if (edad === null || instante === null) return SIN_DATO;
  const t = Date.parse(instante);
  return Number.isNaN(t) ? edadLegible(edad) : `${edadLegible(edad)} (${horaEn(zona, t)})`;
}

/**
 * Estado de los agentes (F1-061): una fila por sucursal activa de la empresa del
 * selector. La edad se recalcula cada 5 s contra la última respuesta buena, así que
 * si el API o el agente se caen la fila pasa sola a "Desconectado" sin esperar otra
 * consulta.
 */
export function Agentes({ empresa }: { empresa: Empresa }) {
  const consulta = useEstadoAgentes(empresa.id);
  const ahora = useAhora();

  if (consulta.isPending) {
    return <p className="text-sm text-slate-500">Cargando estado de los agentes…</p>;
  }
  if (consulta.isError && consulta.data === undefined) {
    return (
      <p role="alert" className="text-sm text-red-700">
        No se pudo cargar el estado de los agentes.
      </p>
    );
  }
  const filas = consulta.data;
  const respuestaAt = consulta.dataUpdatedAt;

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Una sucursal pasa a desconectada cuando su agente lleva más de {UMBRAL_DESCONEXION_S} s sin
        reportar. El aviso del menú se prende a los {UMBRAL_ALERTA_S / 60} min. La última lectura
        usa el reloj de la PC del restaurante.
      </p>
      {consulta.isError && (
        <p role="alert" className="text-sm text-amber-700">
          No se pudo actualizar; se muestra la última respuesta, envejeciendo.
        </p>
      )}
      {filas.length === 0 ? (
        <p className="text-sm text-slate-500">Esta empresa no tiene sucursales activas.</p>
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className={CLASE_TABLA}>
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Sucursal</th>
                <th className="py-2 pr-3 font-medium">Estado</th>
                <th className="py-2 pr-3 font-medium">Último reporte</th>
                <th className="py-2 pr-3 font-medium">Última lectura</th>
                <th className="py-2 pr-3 font-medium">Versión agente</th>
                <th className="py-2 pr-3 font-medium">Versión SR</th>
                <th className="py-2 pr-3 font-medium">Cola</th>
                <th className="py-2 font-medium">Último error</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <Fila key={f.sucursalId} fila={f} respuestaAt={respuestaAt} ahora={ahora} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Fila({
  fila,
  respuestaAt,
  ahora,
}: {
  fila: EstadoAgenteSucursal;
  respuestaAt: number;
  ahora: number;
}) {
  const edadContacto = edadAhora(fila.edadContactoSegundos, respuestaAt, ahora);
  const edadLectura = edadAhora(fila.edadLecturaSegundos, respuestaAt, ahora);
  const estado = estadoAgente(edadContacto);
  return (
    <tr aria-label={fila.nombre} className="border-t border-slate-100 align-top">
      <td className="py-2 pr-3 font-medium text-slate-800">{fila.nombre}</td>
      <td className="py-2 pr-3">
        <span
          data-testid="estado-agente"
          data-estado={estado}
          className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${COLOR_ESTADO[estado]}`}
        >
          {TEXTO_ESTADO[estado]}
        </span>
      </td>
      <td className="whitespace-nowrap py-2 pr-3 tabular-nums">
        {cuando(edadContacto, fila.ultimoContactoAt, fila.zonaHoraria)}
      </td>
      <td className="whitespace-nowrap py-2 pr-3 tabular-nums">
        {cuando(edadLectura, fila.ultimaLecturaAt, fila.zonaHoraria)}
      </td>
      <td className="py-2 pr-3">{fila.versionAgente ?? SIN_DATO}</td>
      <td className="py-2 pr-3">{fila.versionSr ?? SIN_DATO}</td>
      <td className="py-2 pr-3 tabular-nums">{fila.tamanoCola ?? SIN_DATO}</td>
      <td className="max-w-xs truncate py-2" title={fila.ultimoError ?? undefined}>
        {fila.ultimoError ?? '—'}
      </td>
    </tr>
  );
}
