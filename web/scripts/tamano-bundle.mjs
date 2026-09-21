// Tope del bundle del panel (F1-092): 400 kB en gzip. Corre después de `npm run build`
// (`npm run check:bundle`, también en el CI).
//
// Suma TODO lo que hay en dist/assets (JS y CSS), también los chunks que se cargan
// perezosos (las gráficas): es más estricto que medir sólo la carga inicial, a
// propósito. Si un día el tope estorba, se discute el tope; no se excluyen archivos.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const TOPE_KB = 400;
const carpeta = join(import.meta.dirname, '..', 'dist', 'assets');

let archivos;
try {
  archivos = readdirSync(carpeta).filter((n) => /\.(js|css)$/.test(n));
} catch {
  console.error(`No existe ${carpeta}: corre \`npm run build\` antes.`);
  process.exit(1);
}
if (archivos.length === 0) {
  console.error(`${carpeta} no trae JS ni CSS: el build no produjo nada.`);
  process.exit(1);
}

let total = 0;
for (const nombre of archivos.sort()) {
  const kb = gzipSync(readFileSync(join(carpeta, nombre)), { level: 9 }).length / 1024;
  total += kb;
  console.log(`${kb.toFixed(1).padStart(8)} kB  ${nombre}`);
}
console.log(`${total.toFixed(1).padStart(8)} kB  TOTAL gzip (tope ${TOPE_KB} kB)`);

if (total > TOPE_KB) {
  console.error(`El bundle pesa ${total.toFixed(1)} kB en gzip: pasa el tope de ${TOPE_KB} kB.`);
  process.exit(1);
}
