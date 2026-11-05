// Genera los íconos y el splash de Android desde el isotipo de la marca (docs/marca/*.svg, UI-02).
//
//   node scripts/generar-iconos.mjs        (o `npm run iconos`)
//
// Rasteriza con el Chromium de Playwright, que NO es dependencia de /movil a propósito: los PNG
// resultantes se versionan en movil/android/app/src/main/res y el CI no los regenera. Sólo hace
// falta correr esto cuando cambie la marca, en una máquina con Playwright instalado
// (`npm i -g playwright && npx playwright install chromium`).
//
// Qué produce:
//   mipmap-*/ic_launcher.png             ícono clásico (Android 7.x): el cuadrado morado redondeado
//   mipmap-*/ic_launcher_round.png       ícono redondo (launchers que lo piden)
//   mipmap-*/ic_launcher_foreground.png  primer plano del ícono adaptativo (Android 8+): el ojo sobre
//                                        transparente, dentro de la zona segura de 66/108
//   drawable*/splash.png                 splash de Android < 12: morado con el ojo al centro
// El fondo del ícono adaptativo es el color @color/ic_launcher_background (#2C1533), no un PNG.
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MORADO = '#2C1533';
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const res = join(raiz, 'android/app/src/main/res');

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Falta Playwright: npm i -g playwright && npx playwright install chromium');
  process.exit(1);
}

// El ojo (arena) sin fondo, con su viewBox ajustado. Se quita el <title> para el raster.
const ojo = readFileSync(join(raiz, '../docs/marca/isotipo-oscuro.svg'), 'utf8').replace(
  /<title>.*?<\/title>/,
  '',
);
const app = readFileSync(join(raiz, '../docs/marca/isotipo-app.svg'), 'utf8').replace(
  /<title>.*?<\/title>/,
  '',
);

const densidades = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

/** HTML de un lienzo w×h con un fondo y un SVG centrado que ocupa `alto` del lado menor. */
function lienzo(w, h, { fondo = 'transparent', svg, alto, radio = '0' }) {
  const lado = Math.min(w, h);
  return `<!doctype html><html><head><style>
    html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:transparent}
    .f{width:${w}px;height:${h}px;background:${fondo};border-radius:${radio};
       display:flex;align-items:center;justify-content:center;overflow:hidden}
    .f svg{height:${Math.round(lado * alto)}px;width:auto;display:block}
  </style></head><body><div class="f">${svg}</div></body></html>`;
}

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ deviceScaleFactor: 1 });

async function png(ruta, w, h, opciones) {
  await pagina.setViewportSize({ width: w, height: h });
  await pagina.setContent(lienzo(w, h, opciones));
  const bytes = await pagina.screenshot({ omitBackground: true, type: 'png' });
  await mkdir(dirname(ruta), { recursive: true });
  await writeFile(ruta, bytes);
  console.log(`${ruta.slice(raiz.length + 1)}  ${w}x${h}`);
}

for (const [d, f] of Object.entries(densidades)) {
  const legado = Math.round(48 * f);
  const adaptativo = Math.round(108 * f);
  // Clásico: el isotipo-app completo (cuadrado morado redondeado con el ojo), a sangre.
  await png(join(res, `mipmap-${d}/ic_launcher.png`), legado, legado, { svg: app, alto: 1 });
  // Redondo: círculo morado con el ojo al 56 %.
  await png(join(res, `mipmap-${d}/ic_launcher_round.png`), legado, legado, {
    fondo: MORADO,
    svg: ojo,
    alto: 0.56,
    radio: '50%',
  });
  // Adaptativo: el ojo al 46 % del lienzo de 108 dp, holgado dentro de la zona segura (66 dp):
  // ninguna máscara del launcher (círculo, squircle, gota) lo recorta.
  await png(join(res, `mipmap-${d}/ic_launcher_foreground.png`), adaptativo, adaptativo, {
    svg: ojo,
    alto: 0.46,
  });
}

// Splash (Android < 12; en 12+ el sistema pinta el ícono adaptativo sobre
// windowSplashScreenBackground, ver values/styles.xml). Mismos tamaños que la plantilla.
const splash = {
  drawable: [480, 320],
  'drawable-port-mdpi': [320, 480],
  'drawable-port-hdpi': [480, 800],
  'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [960, 1600],
  'drawable-port-xxxhdpi': [1280, 1920],
  'drawable-land-mdpi': [480, 320],
  'drawable-land-hdpi': [800, 480],
  'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960],
  'drawable-land-xxxhdpi': [1920, 1280],
};
for (const [carpeta, [w, h]] of Object.entries(splash)) {
  await png(join(res, `${carpeta}/splash.png`), w, h, { fondo: MORADO, svg: ojo, alto: 0.3 });
}

await navegador.close();
