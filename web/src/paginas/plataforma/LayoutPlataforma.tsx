import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';

import { useAuth, useUsuario } from '../../auth/contexto';
import { Logo, NOMBRE_PRODUCTO } from '../../marca/Marca';
import { useTema } from '../../tema/contexto';
import { C } from './estilos';
import { SECCIONES_PLATAFORMA } from './secciones';

/**
 * El área de administración de la plataforma (back office de membresías), con su propia barra
 * lateral, como en Tocadiscos: logo + "Administración", las secciones, y abajo quién está
 * dentro, el interruptor de tema oscuro y "Cerrar sesión". Sólo se monta para admin_global
 * (`RequiereRol` en `App.tsx`; la API, además, da 404 a cualquier otro rol).
 */
export function LayoutPlataforma() {
  return (
    <div className="min-h-screen bg-fondo text-tinta md:flex">
      <BarraLateral />
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}

function BarraLateral() {
  return (
    <aside className="flex shrink-0 flex-col border-b border-linea bg-superficie md:sticky md:top-0 md:h-screen md:w-60 md:border-r md:border-b-0">
      <div className="px-5 pt-5 pb-3">
        <Link to="/plataforma" className="inline-flex items-center gap-2 text-acento-texto">
          <Logo className="h-8 w-8 shrink-0" />
          <span className="text-lg font-bold text-tinta">{NOMBRE_PRODUCTO}</span>
        </Link>
        <p className="mt-1 text-sm text-tinta-suave">Administración</p>
      </div>
      <nav aria-label="Plataforma" className="min-w-0 overflow-x-auto px-3 md:flex-1">
        <ul className="flex gap-1 md:flex-col">
          {SECCIONES_PLATAFORMA.map(({ ruta, texto, icono: Icono, exacta }) => (
            <li key={ruta}>
              <NavLink
                to={ruta}
                end={exacta}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap ${
                    isActive ? 'bg-acento text-sobre-acento' : 'text-tinta-medio hover:bg-realce'
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
    <div className="space-y-3 border-t border-linea px-5 py-4">
      <div className="min-w-0 leading-tight">
        <div className="truncate text-sm font-semibold">{usuario.nombre}</div>
        <div className="truncate text-xs text-tinta-tenue">{usuario.email}</div>
      </div>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Tema oscuro</span>
        <button
          type="button"
          role="switch"
          aria-checked={oscuro}
          aria-label="Tema oscuro"
          onClick={() => elegir(oscuro ? 'claro' : 'oscuro')}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            oscuro ? 'bg-acento' : 'bg-realce-fuerte'
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-superficie shadow transition-all ${
              oscuro ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </button>
      </label>
      <Link to="/" className={`${C.secundario} block text-center`}>
        Ir al panel
      </Link>
      <button
        type="button"
        disabled={saliendo}
        onClick={() => {
          setSaliendo(true);
          void cerrarSesion();
        }}
        className={`${C.secundario} w-full`}
      >
        Cerrar sesión
      </button>
    </div>
  );
}
