import { useEffect, useState } from 'react';
import { Outlet } from 'react-router';

import { useNormalizarAlcance } from '../filtros/alcance';
import { renovarEsteDispositivo } from '../pwa/push';
import { Sidebar } from './Sidebar';
import { SinConexion } from './SinConexion';
import { Topbar } from './Topbar';

export function Layout() {
  const [menuAbierto, setMenuAbierto] = useState(false);
  useNormalizarAlcance();

  // F2-146: con sesión, este navegador renueva su registro de avisos push (si lo tiene).
  // Un navegador que no abre el panel en 7 días deja de recibirlos.
  useEffect(() => {
    void renovarEsteDispositivo();
  }, []);

  useEffect(() => {
    if (!menuAbierto) return;
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') setMenuAbierto(false);
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [menuAbierto]);

  return (
    <div className="min-h-screen bg-fondo text-tinta md:flex">
      {menuAbierto && (
        <div
          className="fixed inset-0 z-20 bg-velo md:hidden"
          aria-hidden="true"
          onClick={() => setMenuAbierto(false)}
        />
      )}
      <Sidebar abierto={menuAbierto} onNavegar={() => setMenuAbierto(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar menuAbierto={menuAbierto} onMenu={() => setMenuAbierto((v) => !v)} />
        <SinConexion />
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
