// Íconos PNG de la PWA y del navegador (UI-02, marca Yo Controlo): se rasterizan con Chromium
// (Playwright) a partir de los SVG de `public/marca/`, así el PNG es exactamente el dibujo del
// logo. Chrome exige 192 y 512 para ofrecer "Instalar"; Android recorta los `maskable` a un
// círculo (por eso ése va a sangre completa con el ojo dentro de la zona segura del 80 %), e
// iOS redondea solo el apple-touch-icon (también a sangre completa).
//
//   node scripts/iconos-pwa.mjs      → reescribe public/iconos/*.png
//
// Los PNG se commitean: el build no corre este script (ni el CI tiene Chromium). Necesita
// `playwright` con su Chromium instalados en la máquina; si cambia el logo, se corre a mano.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PUBLICO = join(import.meta.dirname, '..', 'public');
const SALIDA = join(PUBLICO, 'iconos');
/**
 * UI-06: el fondo del ícono es NEGRO (el logo que mandó Ricardo: el ojo arena sobre un cuadrado
 * redondeado negro, `isotipo-app-negro.svg`), el del estilo «Noche» que viene por defecto.
 */
const NEGRO = '#000000';

const svg = (nombre) =>
  `data:image/svg+xml;base64,${readFileSync(join(PUBLICO, 'marca', nombre)).toString('base64')}`;

/** El ícono redondeado tal cual (`isotipo-app-negro.svg`). */
const redondeado = (lado) =>
  `<body style="margin:0;background:transparent"><img src="${svg('isotipo-app-negro.svg')}" width="${lado}" height="${lado}" style="display:block"></body>`;

/** A sangre completa: fondo negro y el ojo arena centrado, ocupando `escala` del lado. */
const sangre = (lado, escala) => {
  const ojo = Math.round(lado * escala);
  return `<body style="margin:0;width:${lado}px;height:${lado}px;background:${NEGRO};display:grid;place-items:center"><img src="${svg('isotipo-oscuro.svg')}" style="width:${ojo}px;height:${ojo}px;object-fit:contain"></body>`;
};

const ICONOS = [
  { archivo: 'favicon-32.png', lado: 32, html: redondeado(32) },
  { archivo: 'icono-192.png', lado: 192, html: redondeado(192) },
  { archivo: 'icono-512.png', lado: 512, html: redondeado(512) },
  // Zona segura del maskable: un círculo del 80 %; el ojo ocupa el 56 % y cabe con holgura.
  { archivo: 'icono-maskable-512.png', lado: 512, html: sangre(512, 0.56) },
  { archivo: 'apple-touch-icon.png', lado: 180, html: sangre(180, 0.66) },
];

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Falta `playwright` (con Chromium) en esta máquina: npm i -g playwright.');
  process.exit(1);
}

mkdirSync(SALIDA, { recursive: true });
const navegador = await chromium.launch();
for (const { archivo, lado, html } of ICONOS) {
  const pagina = await navegador.newPage({ viewport: { width: lado, height: lado } });
  await pagina.setContent(html);
  await pagina.waitForLoadState('load');
  await pagina.screenshot({ path: join(SALIDA, archivo), omitBackground: true });
  await pagina.close();
  console.log(`${archivo} (${lado}x${lado})`);
}
await navegador.close();
