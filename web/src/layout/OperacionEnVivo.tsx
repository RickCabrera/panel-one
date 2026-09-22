import { useAlcance } from '../filtros/alcance';
import { horaEn } from '../filtros/periodo';
import { usePeriodo } from '../filtros/usePeriodo';
import type { Filtro } from '../paginas/inicio/consultas';
import { useConReloj, useMonitorMesas } from '../paginas/mesas/consultas';
import { codificar, decodificar, operacionDe, textoSucursales } from './operacion';

const PUNTO: Record<string, string> = {
  fresca: 'bg-semaforo-ok',
  demorada: 'bg-semaforo-alerta',
  apagado: 'bg-semaforo-sin-dato',
};

/**
 * Operación en vivo (F2-212), en la cabecera de todas las vistas y para todos los roles.
 * Comparte la consulta del Monitor y de "Venta en vivo" (misma queryKey): en esas vistas
 * no sale ninguna petición extra.
 *
 * Sin live region a propósito: con el polling de 20 s, un `role="status"` anunciaría
 * la hora cada vez. El texto completo está en pantalla y en el `aria-label`. El punto es
 * decorativo: todo estado se dice con palabras, nunca sólo con color.
 */
export function OperacionEnVivo() {
  const { empresa, sucursal, sucursalId, sucursales } = useAlcance();
  const { zona } = usePeriodo();
  // Sólo con el alcance validado, igual que las vistas.
  const filtro: Filtro | null =
    empresa && !sucursales.isPending && (!sucursalId || sucursal)
      ? { empresaId: empresa.id, sucursalId: sucursal?.id }
      : null;
  const { data, dataUpdatedAt, isError } = useMonitorMesas(filtro);
  const operacion = decodificar(
    useConReloj((ahora) => codificar(operacionDe(data, dataUpdatedAt, ahora, isError))),
  );

  let punto = PUNTO.apagado;
  let principal: string;
  let detalle: string | null = null;
  switch (operacion.estado) {
    case 'consultando':
      principal = 'Consultando sucursales…';
      break;
    case 'sin-sucursales':
      principal = 'Sin sucursales';
      break;
    case 'sin-lectura':
      principal = 'Sin lectura reciente';
      detalle =
        operacion.total === null ? 'No se pudo consultar' : textoSucursales(0, operacion.total);
      break;
    case 'en-vivo':
      punto = PUNTO[operacion.frescura];
      principal = `${operacion.frescura === 'demorada' ? 'En vivo (con demora)' : 'En vivo'} · ${horaEn(zona, operacion.recibidoAt)}`;
      detalle = textoSucursales(operacion.reportando, operacion.total);
      break;
  }
  const texto = detalle ? `${principal} · ${detalle}` : principal;

  return (
    <div
      data-testid="operacion-en-vivo"
      data-estado={operacion.estado}
      aria-label={`Operación: ${texto}`}
      title={texto}
      className="flex min-w-0 items-center gap-2 text-xs leading-tight"
    >
      <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${punto}`} />
      <span className="min-w-0">
        <span className="block font-medium text-tinta">{principal}</span>
        {detalle && <span className="block text-tinta-tenue">{detalle}</span>}
      </span>
    </div>
  );
}
