import type { Rango } from '../../filtros/periodo';
import { MODOS_B, type ModoB, type SeleccionB } from './periodoB';

const CONTROL =
  'min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-1 text-sm focus:border-acento-borde focus:outline-none';

/**
 * Los controles del periodo B (F2-140): el modo y, en "Otro rango", sus dos fechas. Los usan
 * Comparativos y Ventas por canal (F2-144); quien lo monta escribe la selección en la URL
 * (`escribirB`). Al pasar a "Otro rango" arranca con el B que se veía (o con A).
 */
export function SelectorB({
  seleccion,
  rangoA,
  rangoB,
  onCambiar,
}: {
  seleccion: SeleccionB;
  rangoA: Rango | null;
  rangoB: Rango | null;
  onCambiar: (nueva: SeleccionB) => void;
}) {
  const elegirModo = (modo: ModoB) =>
    onCambiar(
      modo === 'rango'
        ? {
            modo,
            desde: rangoB?.desde ?? rangoA?.desde ?? '',
            hasta: rangoB?.hasta ?? rangoA?.hasta ?? '',
          }
        : { modo },
    );
  return (
    <>
      <label className="flex min-w-0 items-center gap-1">
        Comparar contra
        <select
          className={CONTROL}
          value={seleccion.modo}
          onChange={(e) => elegirModo(e.target.value as ModoB)}
        >
          {MODOS_B.map(({ modo, nombre }) => (
            <option key={modo} value={modo}>
              {nombre}
            </option>
          ))}
        </select>
      </label>
      {seleccion.modo === 'rango' && (
        <>
          <label className="flex min-w-0 items-center gap-1">
            B desde
            <input
              type="date"
              className={CONTROL}
              value={seleccion.desde ?? ''}
              max={seleccion.hasta || undefined}
              onChange={(e) => onCambiar({ ...seleccion, desde: e.target.value })}
            />
          </label>
          <label className="flex min-w-0 items-center gap-1">
            B hasta
            <input
              type="date"
              className={CONTROL}
              value={seleccion.hasta ?? ''}
              min={seleccion.desde || undefined}
              onChange={(e) => onCambiar({ ...seleccion, hasta: e.target.value })}
            />
          </label>
        </>
      )}
    </>
  );
}
