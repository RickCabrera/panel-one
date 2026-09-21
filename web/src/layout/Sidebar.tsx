import { NavLink, useSearchParams } from 'react-router';

import { useUsuario } from '../auth/contexto';
import { ROLES_ADMIN } from '../auth/roles';
import { queryAlcance } from '../filtros/alcance';

interface Entrada {
  ruta: string;
  texto: string;
  soloAdmin?: boolean;
}

const ENTRADAS: readonly Entrada[] = [
  { ruta: '/', texto: 'Inicio' },
  { ruta: '/mesas', texto: 'Monitor de Mesas' },
  { ruta: '/tickets', texto: 'Tickets' },
  { ruta: '/reportes', texto: 'Reportes' },
  { ruta: '/admin', texto: 'Administración', soloAdmin: true },
];

export function Sidebar({ abierto, onNavegar }: { abierto: boolean; onNavegar: () => void }) {
  const usuario = useUsuario();
  const [parametros] = useSearchParams();
  // Los enlaces conservan empresa/sucursal: cambiar de vista no pierde el filtro.
  const search = queryAlcance(parametros);
  const entradas = ENTRADAS.filter((e) => !e.soloAdmin || ROLES_ADMIN.includes(usuario.rol));

  return (
    <aside
      id="menu-principal"
      className={`fixed inset-y-0 left-0 z-30 w-64 max-w-[80vw] border-r border-slate-200 bg-white transition-transform md:static md:z-auto md:max-w-none md:translate-x-0 ${
        abierto ? 'translate-x-0' : '-translate-x-full max-md:invisible'
      }`}
    >
      <div className="flex h-14 items-center border-b border-slate-200 px-4">
        <span className="truncate font-semibold text-acento">Monitor SoftRestaurant</span>
      </div>
      <nav aria-label="Principal" className="p-2">
        <ul className="space-y-1">
          {entradas.map((entrada) => (
            <li key={entrada.ruta}>
              <NavLink
                to={{ pathname: entrada.ruta, search }}
                end={entrada.ruta === '/'}
                onClick={onNavegar}
                className={({ isActive }) =>
                  `block truncate rounded-md px-3 py-2 text-sm font-medium ${
                    isActive ? 'bg-acento text-white' : 'text-slate-700 hover:bg-slate-100'
                  }`
                }
              >
                {entrada.texto}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
