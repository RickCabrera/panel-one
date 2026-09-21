import { Link, NavLink, useSearchParams } from 'react-router';

import { useUsuario } from '../auth/contexto';
import { ROLES_ADMIN } from '../auth/roles';
import { queryAlcance, useAlcance } from '../filtros/alcance';
import { sinReportar, UMBRAL_ALERTA_S } from '../paginas/admin/reglasAgentes';
import { useEstadoAgentes } from '../paginas/admin/consultas';
import { useAhora } from '../paginas/mesas/consultas';

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
  const esAdmin = ROLES_ADMIN.includes(usuario.rol);
  const entradas = ENTRADAS.filter((e) => !e.soloAdmin || esAdmin);

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
            <li key={entrada.ruta} className="flex items-center gap-1">
              <NavLink
                to={{ pathname: entrada.ruta, search }}
                end={entrada.ruta === '/'}
                onClick={onNavegar}
                className={({ isActive }) =>
                  `block min-w-0 flex-1 truncate rounded-md px-3 py-2 text-sm font-medium ${
                    isActive ? 'bg-acento text-white' : 'text-slate-700 hover:bg-slate-100'
                  }`
                }
              >
                {entrada.texto}
              </NavLink>
              {entrada.ruta === '/admin' && <AlertaAgentes search={search} onNavegar={onNavegar} />}
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}

/**
 * Badge de F1-061: cuántas sucursales de la empresa del selector llevan más de 10 min
 * sin reportar. Sólo se monta para admins (el visor ni siquiera hace la petición) y
 * comparte la consulta con la pestaña Agentes. Enlaza a esa pestaña conservando el
 * alcance.
 */
function AlertaAgentes({ search, onNavegar }: { search: string; onNavegar: () => void }) {
  const { empresa } = useAlcance();
  const consulta = useEstadoAgentes(empresa?.id);
  const ahora = useAhora();
  if (consulta.data === undefined) return null;
  const caidas = sinReportar(consulta.data, consulta.dataUpdatedAt, ahora);
  if (caidas.length === 0) return null;

  const destino = new URLSearchParams(search);
  destino.set('tab', 'agentes');
  const texto =
    caidas.length === 1
      ? `1 sucursal lleva más de ${UMBRAL_ALERTA_S / 60} min sin reportar`
      : `${caidas.length} sucursales llevan más de ${UMBRAL_ALERTA_S / 60} min sin reportar`;
  return (
    <Link
      to={{ pathname: '/admin', search: `?${destino.toString()}` }}
      onClick={onNavegar}
      aria-label={texto}
      title={texto}
      data-testid="alerta-agentes"
      className="shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white"
    >
      {caidas.length}
    </Link>
  );
}
