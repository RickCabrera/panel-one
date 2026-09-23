import { useUsuario } from '../auth/contexto';
import { ROLES_ADMIN } from '../auth/roles';
import { useAlcance } from '../filtros/alcance';
import { horaEn, incluyeHoy } from '../filtros/periodo';
import { useHoraEn } from '../filtros/useHoy';
import { usePeriodo } from '../filtros/usePeriodo';
import { useMesasAbiertas, useVentas, type Filtro } from './inicio/consultas';
import {
  TarjetaDescuentos,
  TarjetaFormasPago,
  TarjetaTicketPromedio,
  TarjetaVentaEnVivo,
  TarjetaVentaTotal,
} from './inicio/Tarjetas';
import { ChecklistArranque } from './onboarding/ChecklistArranque';
import { Vista } from './Vista';

export function Inicio() {
  const usuario = useUsuario();
  const { empresa, sucursal, sucursalId, sucursales } = useAlcance();
  // El selector de periodo está en la cabecera (F2-212); aquí sólo se lee.
  const { rango, hoy, zona } = usePeriodo();
  const autoRefresco = rango !== null && incluyeHoy(rango, hoy);
  // Sólo hoy: la gráfica por hora termina en la hora en curso de la zona del panel.
  const horaActual = useHoraEn(zona);
  const horaTope =
    rango !== null && rango.desde === hoy && rango.hasta === hoy ? horaActual : undefined;

  // Sólo con el alcance validado: la empresa está en tu lista y, si la URL trae
  // sucursal, también está en la lista de esa empresa. Y con la lista de sucursales
  // ya resuelta, porque de ella sale la zona de "hoy": consultar antes sería pedir
  // un día y enseguida otro.
  const filtro: Filtro | null =
    empresa && !sucursales.isPending && (!sucursalId || sucursal)
      ? { empresaId: empresa.id, sucursalId: sucursal?.id }
      : null;

  const resumen = useVentas('resumen', filtro, rango, autoRefresco);
  const porHora = useVentas('por-hora', filtro, rango, autoRefresco);
  const formas = useVentas('formas-pago', filtro, rango, autoRefresco);
  const mesas = useMesasAbiertas(filtro);
  const consultas = [resumen, porHora, formas, mesas];

  // "Actualizado" = el dato MÁS VIEJO en pantalla: si una tarjeta no se pudo
  // refrescar, la hora no promete que todo es de hace un momento.
  const exitosas = consultas.filter((c) => c.isSuccess).map((c) => c.dataUpdatedAt);
  const actualizado = exitosas.length > 0 ? Math.min(...exitosas) : null;
  const refrescando = consultas.some((c) => c.isFetching);

  const refrescar = () => {
    for (const consulta of consultas) void consulta.refetch();
  };

  return (
    <Vista titulo="Panel de ventas">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-end">
        <div className="flex items-center gap-3 text-sm text-tinta-tenue">
          <span data-testid="actualizado">
            {actualizado === null
              ? 'Sin datos todavía'
              : `Actualizado ${horaEn(zona, actualizado)}`}
          </span>
          <button
            type="button"
            onClick={refrescar}
            disabled={filtro === null || rango === null || refrescando}
            className="rounded-md border border-linea-fuerte bg-superficie px-3 py-1 text-sm text-tinta-medio hover:bg-realce disabled:opacity-50"
          >
            {refrescando ? 'Actualizando…' : 'Refrescar'}
          </button>
        </div>
      </div>

      {/* F2-147: mientras a la empresa le falte algo para recibir datos, se dice qué. Sólo
          admins: el visor no puede resolver ninguno de los pasos. */}
      {empresa && ROLES_ADMIN.includes(usuario.rol) && (
        <div className="mt-4">
          <ChecklistArranque key={empresa.id} empresaId={empresa.id} soloIncompleta />
        </div>
      )}

      {rango === null ? (
        <p className="mt-6 text-sm text-tinta-tenue">
          Corrige el rango de fechas para ver los datos.
        </p>
      ) : (
        <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
          <TarjetaVentaTotal
            resumen={resumen}
            porHora={porHora}
            rango={rango}
            horaTope={horaTope}
          />
          <TarjetaFormasPago consulta={formas} />
          <TarjetaVentaEnVivo consulta={mesas} />
          <TarjetaTicketPromedio consulta={resumen} />
          <TarjetaDescuentos consulta={resumen} />
        </div>
      )}
    </Vista>
  );
}
