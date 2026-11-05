import { useTema } from '../tema/contexto';

/**
 * Marca propia del panel: Yo Controlo (UI-02; antes «Monitor SoftRestaurant», F1-092). Es
 * NUESTRA, no la de SoftRestaurant: el POS se sigue nombrando donde se habla de él.
 *
 * El logo NO se escribe como texto: son los SVG de `public/marca/` (fuente y uso en
 * docs/marca/README.md). Cada uno existe en dos variantes:
 * - `oscuro`: todo arena (#E3CBA8), para fondos morados u oscuros (la barra lateral, siempre).
 * - `claro`: letras morado de marca y ojo violeta, para fondos claros.
 * `auto` elige según el tema que se ve.
 */
export const NOMBRE_PRODUCTO = 'Yo Controlo';

export type VarianteMarca = 'oscuro' | 'claro' | 'auto';

function useVariante(variante: VarianteMarca): 'oscuro' | 'claro' {
  const { tema } = useTema();
  if (variante !== 'auto') return variante;
  return tema === 'oscuro' ? 'oscuro' : 'claro';
}

/**
 * El logotipo completo («YO CONTROLO», con la C como ojo). Proporción 3.87:1: da el alto con
 * `className` (`h-8`...) y el ancho sale solo. `decorativo` cuando el nombre ya está escrito
 * al lado (o en un `aria-label` del contenedor).
 */
export function Logotipo({
  variante = 'auto',
  className = 'h-8',
  decorativo = false,
}: {
  variante?: VarianteMarca;
  className?: string;
  decorativo?: boolean;
}) {
  const v = useVariante(variante);
  return (
    <img
      src={`/marca/yocontrolo-${v}.svg`}
      alt={decorativo ? '' : NOMBRE_PRODUCTO}
      className={`block w-auto max-w-full ${className}`}
      draggable={false}
    />
  );
}

/** Sólo el ojo-C. Para el riel de iconos y los espacios cuadrados. */
export function Isotipo({
  variante = 'auto',
  className = 'h-7 w-7',
  decorativo = true,
}: {
  variante?: VarianteMarca;
  className?: string;
  decorativo?: boolean;
}) {
  const v = useVariante(variante);
  return (
    <img
      src={`/marca/isotipo-${v}.svg`}
      alt={decorativo ? '' : NOMBRE_PRODUCTO}
      className={`block object-contain ${className}`}
      draggable={false}
    />
  );
}
