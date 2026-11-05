import { LayoutPanelTop, LogOut, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';

import { useAuth, useUsuario } from '../auth/contexto';
import { NOMBRE_ROL } from '../auth/roles';
import { SelectorAlcance } from '../filtros/SelectorAlcance';
import { queryVista, usaPeriodo } from '../filtros/vista';
import { useTema } from '../tema/contexto';
import { InterruptorEstilo } from '../tema/InterruptorEstilo';
import { InterruptorTema } from '../tema/InterruptorTema';
import { Campana } from './Campana';
import { iniciales } from './iniciales';
import { OperacionEnVivo } from './OperacionEnVivo';
import { PeriodoGlobal } from './PeriodoGlobal';
import { MEDIA_HASTA_LG, useMedia } from './useEsMovil';

/** Botón fantasma de la cabecera: icono siempre, texto desde `xl` (el nombre accesible no cambia). */
const BOTON_CABECERA =
  'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-tinta-medio hover:bg-realce hover:text-tinta disabled:opacity-60';
const TEXTO_BOTON = 'sr-only xl:not-sr-only';

/** La cabecera desde `md` (UI-04: en el celular es `CabeceraMovil`). */
export function Topbar() {
  const usuario = useUsuario();
  const { cerrarSesion } = useAuth();
  const [parametros] = useSearchParams();
  const { pathname } = useLocation();
  // Mientras sale (el POST de logout puede tardar), un segundo clic no manda otro.
  const [saliendo, setSaliendo] = useState(false);
  // UI-04: en tableta (md a lg) la operación en vivo va en dos renglones cortos y le deja
  // espacio a la empresa y la sucursal.
  const tableta = useMedia(MEDIA_HASTA_LG);
  // UI-06: en «Noche» la cabecera es negra en los dos temas (vidrio negro, `vidrio-barra`), y en
  // claro lleva dentro la paleta oscura (`zonaOscura`) para que sus controles se lean.
  const { zonaOscura } = useTema();

  return (
    <header
      style={zonaOscura}
      className="print:hidden sticky top-0 z-10 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-linea bg-superficie/95 px-6 py-2 text-tinta backdrop-blur vidrio-barra"
    >
      <OperacionEnVivo compacto={tableta} />
      <div className="min-w-0 flex-1">
        <SelectorAlcance />
      </div>
      <div className="ml-auto flex min-w-0 items-center justify-end gap-1.5">
        <Campana />
        <InterruptorTema />
        <InterruptorEstilo />
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
