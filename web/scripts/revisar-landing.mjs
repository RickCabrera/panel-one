// Revisión estática de la landing (F2-147) sobre su build: `npm run build && npm run
// check:landing` (también en el CI). Es la parte del "Lighthouse > 90" que se puede fijar SIN
// navegador, para que una regresión no espere a que alguien corra Lighthouse a mano
// (`npm run lighthouse:landing`, local: necesita Chrome y red para bajar lighthouse):
//
// 1. SEO/accesibilidad básicos: `lang`, `<title>`, meta description y viewport; cada input con
//    su `<label for>`; cada `<svg role="img">` con `<title>`; un solo `<h1>`.
// 2. Las secciones: propuesta de valor, capturas, cómo funciona, planes, contacto y preguntas.
// 3. Nada externo: ningún script, hoja, imagen o fuente de otro origen (rendimiento y
//    privacidad; también es lo que hace que Caddy no necesite CSP con terceros).
// 4. Peso: todo el build de la landing, en gzip, bajo `TOPE_KB` (sin `og.png`, que no carga la
//    página: sólo la piden WhatsApp/Facebook al compartir; tiene su propio tope).
// 5. Ningún `__URL_PANEL__` ni `__URL_SITIO__` sin reemplazar.
// 6. (UI-03) Open Graph con imagen de 1200×630, planes sin cifras y ningún `style=""` (la CSP
//    de Caddy, `style-src 'self'`, lo bloquearía en producción sin avisar).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = join(import.meta.dirname, '..', 'dist-landing');
// UI-03 subió el tope de 40 a 75 kB: la marca trae dos fuentes empaquetadas (Lilita One para
// títulos, Atkinson Hyperlegible 400/700 para texto: ~44 kB de .woff2, que ya viene comprimido y
// no baja con gzip). Sin ellas el resto de la landing pesa ~18 kB; con ellas, ~62 kB.
const TOPE_KB = 75;
const TOPE_OG_KB = 120;
const errores = [];
const falla = (m) => errores.push(m);

function archivos(carpeta) {
  return readdirSync(carpeta).flatMap((n) => {
    const r = join(carpeta, n);
    return statSync(r).isDirectory() ? archivos(r) : [r];
  });
}

let html;
try {
  html = readFileSync(join(DIST, 'index.html'), 'utf8');
} catch {
  console.error('No hay dist-landing/index.html: corre `npm run build` primero.');
  process.exit(1);
}

// 1. Básicos
if (!/<html lang="es(-MX)?">/.test(html)) falla('Falta <html lang="es-MX">.');
const titulo = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? '';
if (titulo.trim().length < 10) falla('Falta un <title> descriptivo.');
const descripcion = html.match(/<meta\s+name="description"\s+content="([^"]+)"/)?.[1] ?? '';
if (descripcion.length < 50 || descripcion.length > 170) {
  falla(`La meta description debe tener 50–170 caracteres (tiene ${descripcion.length}).`);
}
if (!/<meta name="viewport" content="width=device-width, initial-scale=1"/.test(html)) {
  falla('Falta el meta viewport.');
}
const h1 = html.match(/<h1[\s>]/g) ?? [];
if (h1.length !== 1) falla(`Debe haber exactamente un <h1> (hay ${h1.length}).`);

const ids = new Set(
  [...html.matchAll(/<(?:input|textarea|select)[^>]*\sid="([^"]+)"/g)].map((m) => m[1]),
);
const etiquetas = new Set([...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]));
for (const id of ids) if (!etiquetas.has(id)) falla(`El campo #${id} no tiene <label for>.`);

for (const [svg] of html.matchAll(/<svg[^>]*role="img"[\s\S]*?<\/svg>/g)) {
  if (!/<title[\s>]/.test(svg)) falla('Un <svg role="img"> no tiene <title>.');
}
for (const [img] of html.matchAll(/<img\b[^>]*>/g)) {
  if (!/\salt="/.test(img)) falla(`Imagen sin alt: ${img}`);
  if (!/\swidth="/.test(img) || !/\sheight="/.test(img)) falla(`Imagen sin medidas: ${img}`);
}

// 2. Secciones del AC
for (const id of ['inicio', 'que-ves', 'como-funciona', 'planes', 'preguntas', 'contacto']) {
  if (!html.includes(`id="${id}"`)) falla(`Falta la sección #${id}.`);
}
if ((html.match(/class="captura/g) ?? []).length < 2) falla('Faltan las capturas (al menos dos).');
if ((html.match(/<details>/g) ?? []).length < 4) falla('Las preguntas frecuentes son menos de 4.');
for (const campo of ['nombre', 'email', 'mensaje', 'sitio']) {
  if (!html.includes(`name="${campo}"`)) falla(`El formulario no tiene el campo "${campo}".`);
}

// 6. Open Graph, planes sin cifras y CSP
for (const prop of ['og:title', 'og:description', 'og:image']) {
  if (!new RegExp(`<meta\\s+property="${prop}"\\s+content="[^"]+"`).test(html)) {
    falla(`Falta <meta property="${prop}">.`);
  }
}
try {
  const png = readFileSync(join(DIST, 'og.png'));
  const [ancho, alto] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  if (ancho !== 1200 || alto !== 630) falla(`og.png mide ${ancho}×${alto}; debe ser 1200×630.`);
  if (png.length / 1024 > TOPE_OG_KB) {
    falla(`og.png pesa ${(png.length / 1024).toFixed(0)} kB: pasa el tope de ${TOPE_OG_KB} kB.`);
  }
} catch {
  falla('Falta dist-landing/og.png.');
}
const planes = html.match(/<section id="planes"[\s\S]*?<\/section>/)?.[0] ?? '';
if ((planes.match(/class="plan[ "]/g) ?? []).length !== 3) falla('Los planes no son tres.');
if (/\$\s?\d/.test(planes)) falla('Los planes muestran una cifra: los precios no se publican.');
if (/\sstyle="/.test(html)) falla('Hay un atributo style="" en el HTML: la CSP lo bloquea.');

// 3. Nada externo
for (const [, atributo, url] of html.matchAll(/\s(src|href)="((?:https?:)?\/\/[^"]+)"/g)) {
  falla(`Recurso externo en ${atributo}: ${url}`);
}
for (const f of archivos(DIST).filter((f) => f.endsWith('.css'))) {
  const css = readFileSync(f, 'utf8');
  if (/@import|url\((?:["']?)(?:https?:)?\/\//.test(css)) {
    falla(`${relative(DIST, f)} carga algo de otro origen.`);
  }
}

// robots.txt válido (Lighthouse SEO lo exige; sin él, el preview devuelve el HTML).
try {
  if (!/^User-agent: \*$/m.test(readFileSync(join(DIST, 'robots.txt'), 'utf8'))) {
    falla('robots.txt no declara `User-agent: *`.');
  }
} catch {
  falla('Falta dist-landing/robots.txt.');
}

// 5. Placeholder
for (const marca of ['__URL_PANEL__', '__URL_SITIO__']) {
  if (html.includes(marca)) falla(`Quedó ${marca} sin reemplazar.`);
}

// 4. Peso
let total = 0;
for (const f of archivos(DIST).filter((f) => relative(DIST, f) !== 'og.png')) {
  const kb = gzipSync(readFileSync(f)).length / 1024;
  total += kb;
  console.log(`${kb.toFixed(1).padStart(8)} kB  ${relative(DIST, f)}`);
}
console.log(`${total.toFixed(1).padStart(8)} kB  TOTAL gzip de la landing (tope ${TOPE_KB} kB)`);
if (total > TOPE_KB)
  falla(`La landing pesa ${total.toFixed(1)} kB en gzip: pasa el tope de ${TOPE_KB} kB.`);

if (errores.length > 0) {
  for (const e of errores) console.error(`✗ ${e}`);
  process.exit(1);
}
console.log('Landing OK: básicos de SEO y accesibilidad, secciones, sin recursos externos y peso.');
