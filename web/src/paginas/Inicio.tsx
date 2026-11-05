import { RefreshCw } from 'lucide-react';

import { useUsuario } from '../auth/contexto';
import { useMinuto } from '../consultas/useMinuto';
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
import { TarjetaTurnoEnCurso } from './inicio/TurnoEnCurso';
import { ChecklistArranque } from './onboarding/ChecklistArranque';
import { BOTON_SECUNDARIO } from './botones';
import { comparableDelDia } from './resumen/comparables';
import { Vista } from './Vista';

/**
 * UI-05: las tarjetas aparecen una tras otra al abrir el Panel (un solo momento orquestado; con
 * «reducir movimiento», nada). El retraso va por clase, una por posición: es estático y así queda
 * en la hoja de estilos. (No es por la CSP: `style={{}}` de React se aplica por el CSSOM y eso sí
 * funciona con `style-src 'self'`; lo que la CSP no permite son `<style>` o atributos `style` en
 * el HTML que manda el servidor.)
 */
const APARECER = [
  'motion-safe:animate-aparecer',
  'motion-safe:animate-aparecer [animation-delay:60ms]',
  'motion-safe:animate-aparecer [animation-delay:120ms]',
  'motion-safe:animate-aparecer [animation-delay:180ms]',
  'motion-safe:animate-aparecer [animation-delay:240ms]',
  'motion-safe:animate-aparecer [animation-delay:300ms]',
];

export function Inicio() {
  const usuario = useUsuario();
  const { empresa, sucursal, sucursalId, sucursales } = useAlcance();
  // El selector de periodo está en la cabecera (F2-212); aquí sólo se lee.
  const { periodo, rango, hoy, zona } = usePeriodo();
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
  // UI-05: con "Hoy", el hero se compara contra el mismo día de la semana pasada a esta hora:
  // la MISMA consulta (misma llave y caché) que la base de "Hoy" en el Resumen (F2-220). Con
  // otro periodo no se pide (rango null = consulta apagada).
  const minuto = useMinuto();
  const comparable =
    periodo.tipo === 'hoy' && rango !== null ? comparableDelDia(hoy, minuto) : null;
  const base = useVentas('resumen', filtro, comparable?.rango ?? null, true, comparable?.alturaAl);
  // "Refrescar" y "Actualizado" cubren todo lo que se ve: la base, sólo cuando se muestra (un
  // `refetch` de una consulta apagada pediría sin rango).
  const consultas = [resumen, porHora, formas, mesas, ...(comparable ? [base] : [])];

  // "Actualizado" = el dato MÁS VIEJO en pantalla: si una tarjeta no se pudo
  // refrescar, la hora no promete que todo es de hace un momento.
  const exitosas = consultas.filter((c) => c.isSuccess).map((c) => c.dataUpdatedAt);
  const actualizado = exitosas.length > 0 ? Math.min(...exitosas) : null;
  const refrescando = consultas.some((c) => c.isFetching);

  const refrescar = () => {
    for (const consulta of consultas) void consulta.refetch();
  };

  return (
    <Vista
      titulo="Panel de ventas"
      acciones={
        <>
          <span className="text-sm text-tinta-tenue" data-testid="actualizado">
            {actualizado === null
              ? 'Sin datos todavía'
              : `Actualizado ${horaEn(zona, actualizado)}`}
          </span>
          <button
            type="button"
            onClick={refrescar}
            disabled={filtro === null || rango === null || refrescando}
            className={BOTON_SECUNDARIO}
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-3.5 w-3.5 ${refrescando ? 'motion-safe:animate-spin' : ''}`}
            />
            {refrescando ? 'Actualizando…' : 'Refrescar'}
          </button>
        </>
      }
    >
      {/* F2-147: mientras a la empresa le falte algo para recibir datos, se dice qué. Sólo
          admins: el visor no puede resolver ninguno de los pasos. */}
      {empresa && ROLES_ADMIN.includes(usuario.rol) && (
        <div className="mb-4">
          <ChecklistArranque key={empresa.id} empresaId={empresa.id} soloIncompleta />
        </div>
      )}

      {rango === null ? (
        <p className="mt-2 text-sm text-tinta-tenue">
          Corrige el rango de fechas para ver los datos.
        </p>
      ) : (
        /* UI-05: el hero (la venta) manda, con las formas de pago a su lado; abajo, en un
           renglón, lo vivo (mesas y turno) y los KPI. En el celular, una columna: hero, lo
           vivo, los KPI y al final las formas de pago. */
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12 lg:gap-5">
          <TarjetaVentaTotal
            resumen={resumen}
            porHora={porHora}
            rango={rango}
            horaTope={horaTope}
            base={base}
            comparable={comparable}
            className={`md:col-span-2 lg:col-span-8 lg:row-start-1 ${APARECER[0]}`}
          />
          <TarjetaVentaEnVivo consulta={mesas} className={`lg:col-span-3 ${APARECER[2]}`} />
          {/* MVP: lo cobrado en el turno abierto de SR (el corte que todavía no se hace). */}
          <TarjetaTurnoEnCurso filtro={filtro} className={`lg:col-span-3 ${APARECER[3]}`} />
          <TarjetaTicketPromedio
            consulta={resumen}
            porHora={porHora}
            className={`lg:col-span-3 ${APARECER[4]}`}
          />
          <TarjetaDescuentos consulta={resumen} className={`lg:col-span-3 ${APARECER[5]}`} />
          {/* En escritorio, junto al hero (arriba a la derecha); en el celular, al final. */}
          <TarjetaFormasPago
            consulta={formas}
            className={`md:col-span-2 lg:col-span-4 lg:col-start-9 lg:row-start-1 ${APARECER[1]}`}
          />
        </div>
      )}
    </Vista>
  );
}
