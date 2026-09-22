import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';

import { useAuth, useUsuario } from '../auth/contexto';
import { NOMBRE_ROL } from '../auth/roles';
import { SelectorAlcance } from '../filtros/SelectorAlcance';
import { SelectorPeriodo } from '../filtros/SelectorPeriodo';
import { usePeriodo } from '../filtros/usePeriodo';
import { queryVista, usaPeriodo } from '../filtros/vista';
import { InterruptorTema } from '../tema/InterruptorTema';
import { Campana } from './Campana';
import { OperacionEnVivo } from './OperacionEnVivo';

/** El único selector de periodo del panel (F2-212); lo leen todas las vistas con periodo. */
function PeriodoGlobal() {
  const { periodo, rango, cambiarPeriodo } = usePeriodo();
  return <SelectorPeriodo periodo={periodo} rangoActual={rango} onCambiar={cambiarPeriodo} />;
}

export function Topbar({ menuAbierto, onMenu }: { menuAbierto: boolean; onMenu: () => void }) {
  const usuario = useUsuario();
  const { cerrarSesion } = useAuth();
  const [parametros] = useSearchParams();
  const { pathname } = useLocation();
  // Mientras sale (el POST de logout puede tardar), un segundo clic no manda otro.
  const [saliendo, setSaliendo] = useState(false);

  return (
    <header className="print:hidden flex min-w-0 flex-wrap items-start gap-3 border-b border-linea bg-superficie px-4 py-2 md:items-center">
      <button
        type="button"
        className="rounded-md border border-linea-fuerte px-2 py-1 text-sm md:hidden"
        aria-label={menuAbierto ? 'Cerrar menú' : 'Abrir menú'}
        aria-expanded={menuAbierto}
        aria-controls="menu-principal"
        onClick={onMenu}
      >
        ☰
      </button>
      <OperacionEnVivo />
      <div className="order-3 w-full min-w-0 md:order-none md:w-auto md:flex-1">
        <SelectorAlcance />
      </div>
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-3">
        <Campana />
        <InterruptorTema />
        <div className="min-w-0 text-right leading-tight">
          <div className="truncate text-sm font-medium">{usuario.nombre}</div>
          <div className="truncate text-xs text-tinta-tenue">{NOMBRE_ROL[usuario.rol]}</div>
        </div>
        {/* Para todos los roles (F1-060): cambio de contraseña propio. */}
        <Link
          to={{ pathname: '/cuenta', search: queryVista(parametros) }}
          className="shrink-0 rounded-md border border-linea-fuerte px-3 py-1.5 text-sm hover:bg-realce"
        >
          Mi cuenta
        </Link>
        <button
          type="button"
          onClick={() => {
            setSaliendo(true);
            void cerrarSesion();
          }}
          disabled={saliendo}
          className="shrink-0 rounded-md border border-linea-fuerte px-3 py-1.5 text-sm hover:bg-realce disabled:opacity-60"
        >
          Salir
        </button>
      </div>
      {usaPeriodo(pathname) && (
        <div className="order-4 w-full min-w-0">
          <PeriodoGlobal />
        </div>
      )}
    </header>
  );
}
