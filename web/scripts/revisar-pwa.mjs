// Revisión de la PWA (F2-146) sobre el build: `npm run build && npm run check:pwa` (también
// en el CI). Es la parte del "instalable desde Chrome" y del "armazón sin red" que se puede
// verificar SIN navegador:
//
// 1. Manifest que cumple lo que Chrome pide para ofrecer "Instalar": name/short_name,
//    start_url, display standalone, íconos PNG de 192 y 512 (que existen y MIDEN eso) y uno
//    maskable; `index.html` lo enlaza.
// 2. `sw.js` en la raíz, script clásico (sin import/export: corre en cualquier navegador sin
//    `type: module`), con manejador de `fetch`.
// 3. Su precache incluye `index.html`, cada archivo que `index.html` pide y TODO lo demás
//    del build: sin red, el armazón abre completo.
//
// Lo que NO puede ver (el botón de instalar de verdad, el push con la app cerrada) se prueba
// en un navegador: ver docs/notificaciones.md.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = join(import.meta.dirname, '..', 'dist');
const errores = [];
const falla = (m) => errores.push(m);

function archivos(carpeta) {
  return readdirSync(carpeta).flatMap((n) => {
    const r = join(carpeta, n);
    return statSync(r).isDirectory() ? archivos(r) : [r];
  });
}

/** Ancho y alto de un PNG (cabecera IHDR). */
function medidaPng(ruta) {
  const b = readFileSync(ruta);
  if (b.readUInt32BE(0) !== 0x89504e47) return null;
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

if (!existsSync(DIST)) {
  console.error('No existe web/dist: corre `npm run build` antes.');
  process.exit(1);
}

// 1. Manifest
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
if (!/<link rel="manifest" href="\/manifest\.webmanifest"/.test(html)) {
  falla('index.html no enlaza /manifest.webmanifest.');
}
let manifest = {};
try {
  manifest = JSON.parse(readFileSync(join(DIST, 'manifest.webmanifest'), 'utf8'));
} catch (e) {
  falla(`manifest.webmanifest no se puede leer: ${e.message}`);
}
for (const campo of ['name', 'short_name', 'start_url']) {
  if (typeof manifest[campo] !== 'string' || manifest[campo] === '')
    falla(`El manifest no trae ${campo}.`);
}
if (!['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display)) {
  falla(`display="${manifest.display}": Chrome no lo instala como app.`);
}
const iconos = Array.isArray(manifest.icons) ? manifest.icons : [];
for (const lado of [192, 512]) {
  const icono = iconos.find(
    (i) =>
      i.sizes === `${lado}x${lado}` &&
      i.type === 'image/png' &&
      (i.purpose ?? 'any').includes('any'),
  );
  if (!icono) {
    falla(`El manifest no trae ícono PNG de ${lado}x${lado} (purpose any).`);
    continue;
  }
  const ruta = join(DIST, icono.src);
  const medida = existsSync(ruta) ? medidaPng(ruta) : null;
  if (!medida || medida[0] !== lado || medida[1] !== lado) {
    falla(`${icono.src} no existe o no mide ${lado}x${lado} (mide ${medida?.join('x') ?? '—'}).`);
  }
}
if (!iconos.some((i) => (i.purpose ?? '').includes('maskable'))) {
  falla('El manifest no trae ícono maskable (Android lo recorta feo).');
}

// 2. Service worker
const rutaSw = join(DIST, 'sw.js');
if (!existsSync(rutaSw)) {
  falla('No existe dist/sw.js.');
} else {
  const sw = readFileSync(rutaSw, 'utf8');
  if (/(^|[;}\s])(import|export)[\s{*]/.test(sw) || /\bimport\(/.test(sw)) {
    falla('sw.js trae import/export: tiene que ser un script clásico.');
  }
  if (!/addEventListener\(\s*[`'"]fetch[`'"]/.test(sw)) falla('sw.js no maneja `fetch`.');
  if (!/addEventListener\(\s*[`'"]push[`'"]/.test(sw)) falla('sw.js no maneja `push`.');

  // 3. Precache
  const m = /\["\/index\.html"[^\]]*\]/.exec(sw);
  if (!m) {
    falla('sw.js no trae la lista de precache (¿no corrió pwa-plugin.ts?).');
  } else {
    const precache = new Set(JSON.parse(m[0]));
    const delBuild = archivos(DIST)
      .map((r) => `/${relative(DIST, r).split('\\').join('/')}`)
      .filter((f) => f !== '/sw.js' && !f.endsWith('.map'));
    for (const f of delBuild) if (!precache.has(f)) falla(`${f} no está en el precache.`);
    for (const f of precache)
      if (!delBuild.includes(f)) falla(`El precache pide ${f}, que no existe.`);
    const pedidos = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((x) => x[1]);
    for (const f of pedidos)
      if (!precache.has(f)) falla(`index.html pide ${f} y no está en el precache.`);
    console.log(`precache: ${precache.size} archivos (index.html pide ${pedidos.length}).`);
  }
}

if (errores.length > 0) {
  for (const e of errores) console.error(`✗ ${e}`);
  process.exit(1);
}
console.log('PWA: manifest instalable, sw.js clásico y precache completo.');
