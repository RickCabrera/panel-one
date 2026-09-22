import { useAlcance } from './alcance';

const CLASE_SELECT =
  'w-full min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-1.5 text-sm focus:border-acento-borde focus:outline-none sm:w-auto sm:max-w-56';

function etiqueta(nombre: string, activo: boolean): string {
  // Las inactivas se muestran: ocultarlas rompería el deep-link al histórico de
  // una sucursal dada de baja.
  return activo ? nombre : `${nombre} (inactiva)`;
}

export function SelectorAlcance() {
  const { empresa, sucursalId, empresas, sucursales, elegirEmpresa, elegirSucursal } = useAlcance();

  let selectorEmpresa;
  if (empresas.isPending) {
    selectorEmpresa = <span className="text-sm text-tinta-tenue">Cargando empresas…</span>;
  } else if (empresas.isError) {
    selectorEmpresa = (
      <span role="alert" className="text-sm text-peligro">
        No se pudieron cargar las empresas.
      </span>
    );
  } else if (empresas.data.length === 1) {
    const unica = empresas.data[0];
    selectorEmpresa = (
      <span className="truncate text-sm font-medium" data-testid="empresa-unica">
        {etiqueta(unica.nombre, unica.activo)}
      </span>
    );
  } else {
    selectorEmpresa = (
      <select
        aria-label="Empresa"
        className={CLASE_SELECT}
        value={empresa?.id ?? ''}
        onChange={(e) => elegirEmpresa(e.target.value)}
      >
        {!empresa && <option value="">Elige una empresa</option>}
        {empresas.data.map((e) => (
          <option key={e.id} value={e.id}>
            {etiqueta(e.nombre, e.activo)}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
      {selectorEmpresa}
      <select
        aria-label="Sucursal"
        className={CLASE_SELECT}
        disabled={!sucursales.isSuccess}
        value={sucursales.isSuccess ? (sucursalId ?? '') : ''}
        onChange={(e) => elegirSucursal(e.target.value || null)}
      >
        <option value="">Todas las sucursales</option>
        {sucursales.data?.map((s) => (
          <option key={s.id} value={s.id}>
            {etiqueta(s.nombre, s.activo)}
          </option>
        ))}
      </select>
      {sucursales.isError && (
        <span role="alert" className="text-sm text-peligro">
          No se pudieron cargar las sucursales.
        </span>
      )}
    </div>
  );
}
