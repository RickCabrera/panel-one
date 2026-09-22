/**
 * Marca propia del panel (F1-092): el nombre del producto y su logotipo. Es NUESTRA,
 * no la de SoftRestaurant: el nombre dice con qué POS trabaja, el logo no imita el suyo.
 * El logo usa `currentColor` (el acento del despliegue, VITE_COLOR_ACENTO, ajustado al
 * contraste del tema) y sus barras el token `sobre-acento` (F2-211);
 * el favicon (`public/favicon.svg`) es el mismo dibujo con el acento por defecto.
 */
export const NOMBRE_PRODUCTO = 'Monitor SoftRestaurant';

export function Logo({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="7" fill="currentColor" />
      <path
        d="M8 23V14M14 23V9M20 23v-6M26 23V12"
        className="stroke-sobre-acento"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Logo + nombre, en el color de acento. */
export function Marca({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-2 text-acento-texto ${className}`}>
      <Logo className="h-7 w-7 shrink-0" />
      <span className="truncate font-semibold">{NOMBRE_PRODUCTO}</span>
    </span>
  );
}
