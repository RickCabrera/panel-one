/**
 * Aritmética de color para el tema (F2-211): contraste WCAG 2.x, mezcla y diferencia
 * perceptual. Sólo hex de 6 dígitos (`#rrggbb`), que es lo que trae la paleta; el
 * acento configurable de 3 dígitos se expande antes con `normalizarHex`.
 */

type Rgb = [number, number, number];

export function normalizarHex(hex: string): string {
  const limpio = hex.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(limpio)) {
    return '#' + [...limpio.slice(1)].map((c) => c + c).join('');
  }
  if (!/^#[0-9a-f]{6}$/.test(limpio)) throw new Error(`Color no válido: ${hex}`);
  return limpio;
}

function aRgb(hex: string): Rgb {
  const h = normalizarHex(hex);
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

function aHex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

const lineal = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Luminancia relativa (WCAG 2.x). */
export function luminancia(hex: string): number {
  const [r, g, b] = aRgb(hex).map(lineal);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razón de contraste WCAG entre dos colores, de 1 a 21. */
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** `a` mezclado con `b` en proporción `t` (0 = a, 1 = b), en sRGB. */
export function mezclar(a: string, b: string, t: number): string {
  const [ra, rb] = [aRgb(a), aRgb(b)];
  return aHex(ra.map((v, i) => v + (rb[i] - v) * t) as Rgb);
}

/**
 * El color `base` empujado hacia `destino` en pasos de 5 % hasta que tenga al menos
 * `minimo` de contraste contra TODOS los `fondos`. Si ni el destino puro alcanza,
 * devuelve el destino (el mejor posible).
 */
export function ajustarContraste(
  base: string,
  destino: string,
  fondos: readonly string[],
  minimo: number,
): string {
  for (let paso = 0; paso <= 20; paso++) {
    const candidato = mezclar(base, destino, paso / 20);
    if (fondos.every((f) => contraste(candidato, f) >= minimo)) return candidato;
  }
  return normalizarHex(destino);
}

/** CIELAB (D65), para medir si dos colores se distinguen a la vista. */
function aLab(rgb: Rgb): Rgb {
  const [r, g, b] = rgb.map(lineal);
  const xyz = [
    (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047,
    0.2126 * r + 0.7152 * g + 0.0722 * b,
    (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883,
  ].map((v) => (v > 216 / 24389 ? Math.cbrt(v) : ((v * 24389) / 27 + 16) / 116));
  return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])];
}

/** ΔE CIE76: ~2.3 es apenas perceptible; ≥ 20 se distingue sin esfuerzo. */
export function diferencia(a: string, b: string): number {
  const [la, lb] = [aLab(aRgb(a)), aLab(aRgb(b))];
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

/**
 * Cómo ve el color alguien con deuteranopia (daltonismo rojo-verde, el más común),
 * con la matriz de Machado et al. (2009), severidad 1, sobre RGB lineal.
 */
export function comoDeuteranopia(hex: string): string {
  const [r, g, b] = aRgb(hex).map(lineal);
  const m = [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ];
  const gamma = (c: number) => {
    const v = Math.min(1, Math.max(0, c));
    return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
  };
  return aHex(m.map((fila) => gamma(fila[0] * r + fila[1] * g + fila[2] * b)) as Rgb);
}
