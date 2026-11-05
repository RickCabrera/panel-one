import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';

import { useAuth, useUsuario } from '../../auth/contexto';
import { Logotipo } from '../../marca/Marca';
import { useTema } from '../../tema/contexto';
import { InterruptorEstilo } from '../../tema/InterruptorEstilo';
import { SECCIONES_PLATAFORMA } from './secciones';

/** Foco en arena: sobre el morado del lateral el violeta del acento no se ve (UI-02). */
const FOCO_LATERAL =
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-arena';
const BOTON_LATERAL = `rounded-md border border-lateral-borde px-3 py-1.5 text-sm font-medium text-lateral-tinta hover:bg-lateral-realce disabled:opacity-50 ${FOCO_LATERAL}`;

/**
 * El área de administración de la plataforma (back office de membresías), con su propia barra
 * lateral, como en Tocadiscos: logo + "Administración", las secciones, y abajo quién está
 * dentro, el interruptor de tema oscuro y "Cerrar sesión". Sólo se monta para admin_global
 * (`RequiereRol` en `App.tsx`; la API, además, da 404 a cualquier otro rol).
 */
export function LayoutPlataforma() {
  return (
    <div className="resplandor min-h-screen bg-fondo text-tinta md:flex">
      <BarraLateral />
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}

function BarraLateral() {
  return (
    <aside className="flex shrink-0 flex-col border-b border-lateral-borde bg-lateral text-lateral-tinta md:sticky md:top-0 md:h-screen md:w-60 md:border-r md:border-b-0">
      <div className="px-5 pt-5 pb-4">
        <Link to="/plataforma" className={`inline-block rounded ${FOCO_LATERAL}`}>
          <Logotipo variante="oscuro" className="h-8" />
        </Link>
        <p className="mt-2 text-xs font-semibold text-lateral-tenue">Administración</p>
      </div>
      <nav aria-label="Plataforma" className="min-w-0 overflow-x-auto px-2 pb-2 md:flex-1">
        <ul className="flex gap-1 md:flex-col md:gap-px">
          {SECCIONES_PLATAFORMA.map(({ ruta, texto, icono: Icono, exacta }) => (
            <li key={ruta}>
              <NavLink
                to={ruta}
                end={exacta}
                className={({ isActive }) =>
                  `relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap ${FOCO_LATERAL} ${
                    isActive
                      ? 'bg-acento text-sobre-acento shadow-sm md:before:absolute md:before:inset-y-1.5 md:before:-left-2 md:before:w-1 md:before:rounded-r-full md:before:bg-arena'
                      : 'text-lateral-tinta hover:bg-lateral-realce'
                  }`
                }
              >
                <Icono aria-hidden="true" className="h-4 w-4 shrink-0" />
                {texto}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <PieUsuario />
    </aside>
  );
}

function PieUsuario() {
  const usuario = useUsuario();
  const { cerrarSesion } = useAuth();
  const { tema, elegir } = useTema();
  const [saliendo, setSaliendo] = useState(false);
  const oscuro = tema === 'oscuro';

  return (
    <div className="space-y-3 border-t border-lateral-borde px-5 py-4">
      <div className="min-w-0 leading-tight">
        <div className="truncate text-sm font-semibold">{usuario.nombre}</div>
        <div className="truncate text-xs text-lateral-tenue">{usuario.email}</div>
      </div>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Tema oscuro</span>
        <button
          type="button"
          role="switch"
          aria-checked={oscuro}
          aria-label="Tema oscuro"
          onClick={() => elegir(oscuro ? 'claro' : 'oscuro')}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${FOCO_LATERAL} ${
            oscuro ? 'bg-acento' : 'bg-lateral-realce ring-1 ring-lateral-tenue ring-inset'
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-lateral-tinta shadow transition-all ${
              oscuro ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </button>
      </label>
      {/* UI-06: el estilo de la marca, junto al tema. */}
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>Estilo</span>
        <InterruptorEstilo />
      </div>
      <Link to="/" className={`${BOTON_LATERAL} block text-center`}>
        Ir al panel
      </Link>
      <button
        type="button"
        disabled={saliendo}
        onClick={() => {
          setSaliendo(true);
          void cerrarSesion();
        }}
        className={`${BOTON_LATERAL} w-full`}
      >
        Cerrar sesión
      </button>
    </div>
  );
}
