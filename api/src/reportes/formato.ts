/**
 * Formato de los correos (F2-141). Puro y sin float: el dinero llega como texto decimal
 * (`pesos()` de los agregados) y se agrupa por miles sobre el TEXTO.
 */

const DINERO = /^(-?)(\d+)\.(\d{2})$/;

/** `"12345.60"` → `"$12,345.60"`; `"-5.00"` → `"-$5.00"`. Otra forma truena: no se adivina. */
export function formatoPesos(texto: string): string {
  const m = DINERO.exec(texto);
  if (!m) throw new Error(`Importe con formato inesperado: "${texto}"`);
  const [, signo, enteros, centavos] = m;
  const agrupados = enteros.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${signo}$${agrupados}.${centavos}`;
}

/** Enteros con separador de miles (cuentas, comensales). */
export function formatoEntero(n: number): string {
  if (!Number.isInteger(n)) throw new Error(`Se esperaba un entero: ${n}`);
  const signo = n < 0 ? '-' : '';
  return signo + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Todo texto que venga de datos (nombres de sucursal, productos del POS) pasa por aquí. */
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/** `"2026-09-21"` → `"lunes 21 de septiembre de 2026"` (fecha de calendario, sin zona). */
export function fechaLarga(dia: string): string {
  const d = new Date(`${dia}T00:00:00Z`);
  const semana = (d.getUTCDay() + 6) % 7;
  return `${DIAS[semana]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

/** `"2026-09-21"` → `"21 sep"`. */
export function fechaCorta(dia: string): string {
  const d = new Date(`${dia}T00:00:00Z`);
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()].slice(0, 3)}`;
}
