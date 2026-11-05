import { errorDeRango, TIPOS_PERIODO, type Periodo, type Rango } from './periodo';

const CLASE_FECHA =
  'min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-1 text-sm focus:border-acento-borde focus:outline-none max-md:h-11 max-md:flex-1 max-md:text-base';

const CLASE_OPCION =
  'min-w-0 shrink-0 rounded-md px-2.5 py-1 text-sm font-medium max-md:min-h-10 max-md:px-1 max-md:text-xs max-md:leading-tight max-md:text-balance';

/**
 * Hoy / Esta semana / Este mes / Mes anterior / Rango. Al pasar a "Rango" se
 * precarga el rango que se estaba viendo, para no arrancar con uno inválido.
 *
 * Desde F2-212 vive en la cabecera y es el único del panel. Un rango invertido no se
 * corrige en silencio (quien teclea día por día pasa por fechas intermedias): se
 * explica, y con él `rangoDe` da `null` y ninguna vista consulta. `min`/`max` hacen
 * que el calendario nativo ya no ofrezca las fechas que lo invertirían.
 *
 * UI-04: en el celular (< md) es una rejilla de cinco celdas iguales a todo lo ancho, de 44 px
 * de alto, en vez de una tira: así ninguna etiqueta se corta a la mitad ni hay que deslizar
 * para encontrar la elegida (a 360 px las cinco no caben en un renglón). Una etiqueta larga
 * («Mes anterior») pasa a dos renglones dentro de su celda. Las fechas del rango, una por
 * renglón a todo lo ancho.
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
      <div
        role="group"
        aria-label="Periodo"
        className="grid w-full grid-cols-5 gap-0.5 rounded-lg bg-realce p-0.5 md:inline-flex md:w-fit md:max-w-full md:overflow-x-auto md:whitespace-nowrap md:[scrollbar-width:none]"
      >
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
              className={`${CLASE_OPCION} ${
                activo
                  ? 'bg-acento text-sobre-acento shadow-xs ring-1 ring-acento-borde ring-inset'
                  : 'text-tinta-suave hover:bg-superficie hover:text-tinta'
              }`}
            >
              {nombre}
            </button>
          );
        })}
      </div>
      {periodo.tipo === 'rango' && (
        <div className="flex flex-wrap items-center gap-2 text-sm max-md:flex-col max-md:items-stretch">
          <label className="flex items-center gap-1 max-md:gap-2">
            <span className="max-md:w-12">Desde</span>
            <input
              type="date"
              className={CLASE_FECHA}
              value={periodo.desde ?? ''}
              max={periodo.hasta || undefined}
              onChange={(e) => onCambiar({ ...periodo, desde: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-1 max-md:gap-2">
            <span className="max-md:w-12">Hasta</span>
            <input
              type="date"
              className={CLASE_FECHA}
              value={periodo.hasta ?? ''}
              min={periodo.desde || undefined}
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
