import { LayoutPanelTop, LogOut, Menu, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';

import { useAuth, useUsuario } from '../auth/contexto';
import { NOMBRE_ROL } from '../auth/roles';
import { SelectorAlcance } from '../filtros/SelectorAlcance';
import { SelectorPeriodo } from '../filtros/SelectorPeriodo';
import { usePeriodo } from '../filtros/usePeriodo';
import { queryVista, usaPeriodo } from '../filtros/vista';
import { Isotipo } from '../marca/Marca';
import { InterruptorTema } from '../tema/InterruptorTema';
import { Campana } from './Campana';
import { OperacionEnVivo } from './OperacionEnVivo';

/** El único selector de periodo del panel (F2-212); lo leen todas las vistas con periodo. */
function PeriodoGlobal() {
  const { periodo, rango, cambiarPeriodo } = usePeriodo();
  return <SelectorPeriodo periodo={periodo} rangoActual={rango} onCambiar={cambiarPeriodo} />;
}

/** Botón fantasma de la cabecera: icono siempre, texto desde `xl` (el nombre accesible no cambia). */
const BOTON_CABECERA =
  'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-tinta-medio hover:bg-realce hover:text-tinta disabled:opacity-60';
const TEXTO_BOTON = 'sr-only xl:not-sr-only';

/** Las iniciales del nombre, para el avatar (dos letras como mucho). */
function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  return (
    (partes[0]?.[0] ?? '') + (partes.length > 1 ? (partes.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}

export function Topbar({ menuAbierto, onMenu }: { menuAbierto: boolean; onMenu: () => void }) {
  const usuario = useUsuario();
  const { cerrarSesion } = useAuth();
  const [parametros] = useSearchParams();
  const { pathname } = useLocation();
  // Mientras sale (el POST de logout puede tardar), un segundo clic no manda otro.
  const [saliendo, setSaliendo] = useState(false);

  return (
    <header className="print:hidden sticky top-0 z-10 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-linea bg-superficie/95 px-4 py-2 backdrop-blur md:px-6">
      <button
        type="button"
        className="rounded-md p-1.5 text-tinta-medio hover:bg-realce md:hidden"
        aria-label={menuAbierto ? 'Cerrar menú' : 'Abrir menú'}
        aria-expanded={menuAbierto}
        aria-controls="menu-principal"
        onClick={onMenu}
      >
        {menuAbierto ? (
          <X aria-hidden="true" className="h-5 w-5" />
        ) : (
          <Menu aria-hidden="true" className="h-5 w-5" />
        )}
      </button>
      {/* En el teléfono el lateral está cerrado: la marca se asoma aquí. */}
      <Isotipo className="h-7 w-7 md:hidden" />
      <OperacionEnVivo />
      <div className="order-3 w-full min-w-0 md:order-none md:w-auto md:flex-1">
        <SelectorAlcance />
      </div>
      <div className="ml-auto flex min-w-0 items-center justify-end gap-1.5">
        <Campana />
        <InterruptorTema />
        <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-linea sm:block" />
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-arena font-titulo text-xs font-semibold text-lateral sm:flex"
          >
            {iniciales(usuario.nombre)}
          </span>
          <div className="hidden min-w-0 leading-tight lg:block">
            <div className="max-w-40 truncate text-sm font-medium">{usuario.nombre}</div>
            <div className="max-w-40 truncate text-xs text-tinta-tenue">
              {NOMBRE_ROL[usuario.rol]}
            </div>
          </div>
        </div>
        {/* Membresías: el panel de plataforma, sólo para admin_global. */}
        {usuario.rol === 'admin_global' && (
          <Link to="/plataforma" className={BOTON_CABECERA} title="Plataforma">
            <LayoutPanelTop aria-hidden="true" className="h-4 w-4" />
            <span className={TEXTO_BOTON}>Plataforma</span>
          </Link>
        )}
        {/* Para todos los roles (F1-060): cambio de contraseña propio. */}
        <Link
          to={{ pathname: '/cuenta', search: queryVista(parametros) }}
          className={BOTON_CABECERA}
          title="Mi cuenta"
        >
          <UserRound aria-hidden="true" className="h-4 w-4" />
          <span className={TEXTO_BOTON}>Mi cuenta</span>
        </Link>
        <button
          type="button"
          onClick={() => {
            setSaliendo(true);
            void cerrarSesion();
          }}
          disabled={saliendo}
          className={BOTON_CABECERA}
          title="Salir"
        >
          <LogOut aria-hidden="true" className="h-4 w-4" />
          <span className={TEXTO_BOTON}>Salir</span>
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
