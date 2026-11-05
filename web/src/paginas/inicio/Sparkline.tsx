import { useId } from 'react';

/**
 * UI-05: una mini-gráfica de tendencia para las tarjetas KPI, en SVG a mano (Recharts pesa y
 * va en su propio chunk; esto son unas líneas). El color es `currentColor`: lo da la clase de
 * texto del contenedor (`text-serie-1`), así no se escribe ningún color aquí.
 *
 * `valores` en orden; `null` = sin dato en ese punto (la línea se corta ahí, no se inventa un
 * cero). Con menos de dos puntos legibles no se dibuja nada. Es decorativa para el lector de
 * pantalla salvo por su `etiqueta`, que dice qué traza: el número ya está escrito al lado.
 */
export function Sparkline({
  valores,
  etiqueta,
  className = 'h-7 w-20 text-serie-1',
}: {
  valores: readonly (number | null)[];
  etiqueta: string;
  className?: string;
}) {
  const id = `spark-${useId().replace(/:/g, '')}`;
  const legibles = valores.filter((v): v is number => v !== null);
  if (legibles.length < 2) return null;

  const ANCHO = 80;
  const ALTO = 28;
  const MARGEN = 3;
  const min = Math.min(...legibles);
  const max = Math.max(...legibles);
  const rango = max - min || 1;
  const x = (i: number) => MARGEN + (i * (ANCHO - 2 * MARGEN)) / Math.max(1, valores.length - 1);
  const y = (v: number) => ALTO - MARGEN - ((v - min) * (ALTO - 2 * MARGEN)) / rango;

  // Tramos continuos (un `null` corta la línea).
  const tramos: [number, number][][] = [];
  valores.forEach((v, i) => {
    if (v === null) return;
    const anterior = i > 0 ? valores[i - 1] : null;
    if (anterior === null || tramos.length === 0) tramos.push([]);
    tramos[tramos.length - 1].push([x(i), y(v)]);
  });
  const lineas = tramos.map((t) => t.map(([a, b], i) => `${i ? 'L' : 'M'}${a},${b}`).join(''));
  const areas = tramos
    .filter((t) => t.length > 1)
    .map(
      (t) =>
        `M${t[0][0]},${ALTO}` +
        t.map(([a, b]) => `L${a},${b}`).join('') +
        `L${t[t.length - 1][0]},${ALTO}Z`,
    );
  const ultimo = tramos[tramos.length - 1][tramos[tramos.length - 1].length - 1];

  return (
    <svg
      viewBox={`0 0 ${ANCHO} ${ALTO}`}
      role="img"
      aria-label={etiqueta}
      className={`block shrink-0 overflow-visible ${className}`}
      data-testid="sparkline"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      {areas.map((d, i) => (
        <path key={`a${i}`} d={d} fill={`url(#${id})`} />
      ))}
      {lineas.map((d, i) => (
        <path
          key={`l${i}`}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <circle cx={ultimo[0]} cy={ultimo[1]} r={3} fill="currentColor" />
    </svg>
  );
}

/**
 * El punto que late del «en vivo» (UI-05): un halo que crece y se desvanece detrás de un punto
 * fijo. Sólo con movimiento permitido; quieto, es el punto. Decorativo: el estado siempre va
 * escrito al lado.
 */
export function Latido({
  color = 'bg-semaforo-ok',
  vivo = true,
}: {
  color?: string;
  vivo?: boolean;
}) {
  return (
    <span aria-hidden="true" className="relative flex h-2.5 w-2.5 shrink-0">
      {vivo && (
        <span className={`absolute inset-0 rounded-full ${color} motion-safe:animate-latido`} />
      )}
      <span className={`relative h-2.5 w-2.5 rounded-full ${color}`} />
    </span>
  );
}
