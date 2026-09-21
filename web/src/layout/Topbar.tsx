import { useAuth, useUsuario } from '../auth/contexto';
import { NOMBRE_ROL } from '../auth/roles';
import { SelectorAlcance } from '../filtros/SelectorAlcance';

export function Topbar({ menuAbierto, onMenu }: { menuAbierto: boolean; onMenu: () => void }) {
  const usuario = useUsuario();
  const { cerrarSesion } = useAuth();

  return (
    <header className="flex min-w-0 flex-wrap items-start gap-3 border-b border-slate-200 bg-white px-4 py-2 md:items-center">
      <button
        type="button"
        className="rounded-md border border-slate-300 px-2 py-1 text-sm md:hidden"
        aria-label={menuAbierto ? 'Cerrar menú' : 'Abrir menú'}
        aria-expanded={menuAbierto}
        aria-controls="menu-principal"
        onClick={onMenu}
      >
        ☰
      </button>
      <div className="order-3 w-full min-w-0 md:order-none md:w-auto md:flex-1">
        <SelectorAlcance />
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-3">
        <div className="min-w-0 text-right leading-tight">
          <div className="truncate text-sm font-medium">{usuario.nombre}</div>
          <div className="truncate text-xs text-slate-500">{NOMBRE_ROL[usuario.rol]}</div>
        </div>
        <button
          type="button"
          onClick={cerrarSesion}
          className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
        >
          Salir
        </button>
      </div>
    </header>
  );
}
