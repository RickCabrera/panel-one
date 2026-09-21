import { useEffect, useState } from 'react';
import { Outlet } from 'react-router';

import { useNormalizarAlcance } from '../filtros/alcance';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function Layout() {
  const [menuAbierto, setMenuAbierto] = useState(false);
  useNormalizarAlcance();

  useEffect(() => {
    if (!menuAbierto) return;
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') setMenuAbierto(false);
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [menuAbierto]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 md:flex">
      {menuAbierto && (
        <div
          className="fixed inset-0 z-20 bg-black/30 md:hidden"
          aria-hidden="true"
          onClick={() => setMenuAbierto(false)}
        />
      )}
      <Sidebar abierto={menuAbierto} onNavegar={() => setMenuAbierto(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar menuAbierto={menuAbierto} onMenu={() => setMenuAbierto((v) => !v)} />
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
