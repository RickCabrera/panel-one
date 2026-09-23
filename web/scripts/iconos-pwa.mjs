// Íconos PNG de la PWA (F2-146): el MISMO dibujo de `public/favicon.svg` (cuadro verde con
// cuatro barras blancas), rasterizado aquí sin dependencias (zlib de Node). Chrome exige
// íconos de 192 y 512 px para ofrecer "Instalar"; Android recorta los `maskable` a un
// círculo, por eso ése va a sangre completa con el dibujo dentro de la zona segura (80 %).
//
//   node scripts/iconos-pwa.mjs      → reescribe public/iconos/*.png
//
// Los PNG se commitean: el build no corre este script. Si cambia el favicon, se corre a mano.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const FONDO = [0x0f, 0x76, 0x6e]; // #0f766e, el theme-color
const BARRA = [0xff, 0xff, 0xff];

// El favicon en su viewBox de 32: rect rx=7; barras de 3 de ancho, puntas redondas.
const BARRAS = [
  { x: 8, y1: 14, y2: 23 },
  { x: 14, y1: 9, y2: 23 },
  { x: 20, y1: 17, y2: 23 },
  { x: 26, y1: 12, y2: 23 },
];

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloque(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const td = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([largo, td, crc]);
}

function png(lado, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; // bits
  ihdr[9] = 6; // RGBA
  const filas = Buffer.alloc((lado * 4 + 1) * lado);
  for (let y = 0; y < lado; y++) {
    filas[y * (lado * 4 + 1)] = 0;
    rgba.copy(filas, y * (lado * 4 + 1) + 1, y * lado * 4, (y + 1) * lado * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque('IHDR', ihdr),
    bloque('IDAT', deflateSync(filas, { level: 9 })),
    bloque('IEND', Buffer.alloc(0)),
  ]);
}

/** Distancia (en unidades del viewBox) del punto al segmento vertical de una barra. */
function dentroDeBarra(u, v) {
  return BARRAS.some((b) => {
    const vy = Math.min(Math.max(v, b.y1), b.y2);
    return Math.hypot(u - b.x, v - vy) <= 1.5;
  });
}

function dentroDeRedondeado(u, v, rx) {
  const cx = Math.min(Math.max(u, rx), 32 - rx);
  const cy = Math.min(Math.max(v, rx), 32 - rx);
  return Math.hypot(u - cx, v - cy) <= rx;
}

/**
 * `escala` = qué fracción del lado ocupa el dibujo (1 = todo; 0.8 = zona segura maskable).
 * `redondo` = esquinas redondeadas y transparentes fuera (el ícono normal).
 */
function dibujar(lado, { escala, redondo }) {
  const SUB = 4; // supermuestreo 4×4 para bordes suaves
  const rgba = Buffer.alloc(lado * lado * 4);
  const margen = (lado * (1 - escala)) / 2;
  const u = (px) => ((px - margen) / (lado * escala)) * 32;
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      let fondo = 0;
      let barra = 0;
      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const px = x + (sx + 0.5) / SUB;
          const py = y + (sy + 0.5) / SUB;
          const [a, b] = [u(px), u(py)];
          const enFondo = redondo ? dentroDeRedondeado(a, b, 7) : true;
          if (!enFondo) continue;
          fondo++;
          if (a >= 0 && a <= 32 && b >= 0 && b <= 32 && dentroDeBarra(a, b)) barra++;
        }
      }
      const total = SUB * SUB;
      const i = (y * lado + x) * 4;
      const t = fondo === 0 ? 0 : barra / fondo;
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(FONDO[c] * (1 - t) + BARRA[c] * t);
      rgba[i + 3] = Math.round((fondo / total) * 255);
    }
  }
  return png(lado, rgba);
}

const carpeta = join(import.meta.dirname, '..', 'public', 'iconos');
mkdirSync(carpeta, { recursive: true });
const salida = {
  'icono-192.png': dibujar(192, { escala: 1, redondo: true }),
  'icono-512.png': dibujar(512, { escala: 1, redondo: true }),
  'icono-maskable-512.png': dibujar(512, { escala: 0.8, redondo: false }),
  // iOS no respeta la transparencia y redondea él mismo: a sangre, sin margen.
  'apple-touch-icon.png': dibujar(180, { escala: 1, redondo: false }),
};
for (const [nombre, datos] of Object.entries(salida)) {
  writeFileSync(join(carpeta, nombre), datos);
  console.log(`${nombre}  ${(datos.length / 1024).toFixed(1)} kB`);
}
