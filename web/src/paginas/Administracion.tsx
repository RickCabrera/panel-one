import { useSearchParams } from 'react-router';

import { useUsuario } from '../auth/contexto';
import { useAlcance } from '../filtros/alcance';
import { Agentes } from './admin/Agentes';
import { Empresas } from './admin/Empresas';
import { Sucursales } from './admin/Sucursales';
import { Usuarios } from './admin/Usuarios';
import { Vista } from './Vista';

type Pestana = 'sucursales' | 'usuarios' | 'agentes' | 'empresas';

const PARAM_PESTANA = 'tab';

const TEXTO: Record<Pestana, string> = {
  sucursales: 'Sucursales',
  usuarios: 'Usuarios',
  agentes: 'Agentes',
  empresas: 'Empresas',
};

/**
 * Administración (F1-060). La pestaña vive en la URL (`?tab=`), como el alcance:
 * un enlace copiado abre la misma pestaña. Sucursales y Usuarios trabajan sobre la
 * empresa del selector del Topbar; Empresas es sólo de admin_global. Agentes
 * (F1-061) es el estado del agente de cada sucursal, también sobre esa empresa.
 */
export function Administracion() {
  const usuario = useUsuario();
  const { empresa } = useAlcance();
  const [parametros, setParametros] = useSearchParams();
  const pestanas: Pestana[] =
    usuario.rol === 'admin_global'
      ? ['sucursales', 'usuarios', 'agentes', 'empresas']
      : ['sucursales', 'usuarios', 'agentes'];
  const pedida = parametros.get(PARAM_PESTANA) as Pestana | null;
  const actual: Pestana = pedida && pestanas.includes(pedida) ? pedida : 'sucursales';

  function elegir(p: Pestana) {
    setParametros((previos) => {
      const nuevos = new URLSearchParams(previos);
      nuevos.set(PARAM_PESTANA, p);
      return nuevos;
    });
  }

  let contenido;
  if (actual === 'empresas') {
    contenido = <Empresas />;
  } else if (!empresa) {
    contenido = <p className="text-sm text-slate-500">Cargando empresa…</p>;
  } else if (actual === 'agentes') {
    contenido = <Agentes key={empresa.id} empresa={empresa} />;
  } else if (actual === 'usuarios') {
    contenido = <Usuarios key={empresa.id} empresa={empresa} />;
  } else {
    contenido = <Sucursales key={empresa.id} empresa={empresa} />;
  }

  return (
    <Vista titulo="Administración">
      <div role="tablist" aria-label="Secciones de administración" className="mb-4 flex gap-2">
        {pestanas.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={p === actual}
            onClick={() => elegir(p)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              p === actual ? 'bg-acento text-white' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            {TEXTO[p]}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={TEXTO[actual]}>
        {contenido}
      </div>
    </Vista>
  );
}
