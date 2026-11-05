/**
 * UI-05: ¿se puede animar? Sólo si la persona NO pidió «reducir movimiento» en su sistema.
 * Sin `matchMedia` (navegadores viejos, jsdom sin el falso) se responde que no: ante la duda,
 * quieto. El CSS se cuida solo con `motion-safe:`; esto es para lo que anima el JS (las cifras
 * que cuentan al cambiar).
 */
export function prefiereMovimiento(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches ?? false;
}
