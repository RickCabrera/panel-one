import { errorDeRango, TIPOS_PERIODO, type Periodo, type Rango } from '../../filtros/periodo';

const CLASE_FECHA =
  'min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-1 text-sm focus:border-acento-borde focus:outline-none';

/**
 * Hoy / Esta semana / Este mes / Mes anterior / Rango. Al pasar a "Rango" se
 * precarga el rango que se estaba viendo, para no arrancar con uno inválido.
 */
export function SelectorPeriodo({
  periodo,
  rangoActual,
  onCambiar,
}: {
  periodo: Periodo;
  rangoActual: Rango | null;
  onCambiar: (periodo: Periodo) => void;
}) {
  const error =
    periodo.tipo === 'rango' ? errorDeRango(periodo.desde ?? '', periodo.hasta ?? '') : null;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div role="group" aria-label="Periodo" className="flex flex-wrap gap-1">
        {TIPOS_PERIODO.map(({ tipo, nombre }) => {
          const activo = periodo.tipo === tipo;
          return (
            <button
              key={tipo}
              type="button"
              aria-pressed={activo}
              onClick={() => {
                if (activo) return;
                onCambiar(
                  tipo === 'rango'
                    ? { tipo, desde: rangoActual?.desde ?? '', hasta: rangoActual?.hasta ?? '' }
                    : { tipo },
                );
              }}
              className={
                activo
                  ? 'rounded-md border border-acento bg-acento px-3 py-1 text-sm text-sobre-acento'
                  : 'rounded-md border border-linea-fuerte bg-superficie px-3 py-1 text-sm hover:bg-realce'
              }
            >
              {nombre}
            </button>
          );
        })}
      </div>
      {periodo.tipo === 'rango' && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1">
            Desde
            <input
              type="date"
              className={CLASE_FECHA}
              value={periodo.desde ?? ''}
              onChange={(e) => onCambiar({ ...periodo, desde: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-1">
            Hasta
            <input
              type="date"
              className={CLASE_FECHA}
              value={periodo.hasta ?? ''}
              onChange={(e) => onCambiar({ ...periodo, hasta: e.target.value })}
            />
          </label>
          {error && (
            <span role="alert" className="text-peligro">
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
