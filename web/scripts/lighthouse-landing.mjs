// Lighthouse de la landing (F2-147), EN LOCAL: `npm run build && npm run lighthouse:landing`.
// Levanta `vite preview` del build de la landing, corre Lighthouse (móvil, el perfil por
// defecto) con el Chrome del sistema y exige MÁS de 90 en las cuatro categorías.
//
// No va al CI: necesita Chrome y red (baja `lighthouse` con npx la primera vez), y su puntaje
// de rendimiento depende de la máquina. Lo que se puede fijar sin navegador lo fija
// `check:landing`, que sí corre en el CI.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PUERTO = 4174;
const URL = `http://localhost:${PUERTO}/`;
const VERSION = '13.5.0';
const MINIMO = 90;
const CATEGORIAS = ['performance', 'accessibility', 'best-practices', 'seo'];
const SALIDA = join(tmpdir(), `lighthouse-landing-${process.pid}.json`);
const windows = process.platform === 'win32';

const preview = spawn(
  'npx',
  ['vite', 'preview', '-c', 'vite.landing.config.ts', '--port', String(PUERTO), '--strictPort'],
  { cwd: join(import.meta.dirname, '..'), shell: windows, stdio: 'ignore' },
);

function detener() {
  if (preview.exitCode !== null) return;
  if (windows)
    spawnSync('taskkill', ['/pid', String(preview.pid), '/T', '/F'], { stdio: 'ignore' });
  else preview.kill('SIGTERM');
}

async function esperarServidor() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {
      // todavía no levanta
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`vite preview no respondió en ${URL}`);
}

let codigo = 1;
try {
  await esperarServidor();
  const lh = spawnSync(
    'npx',
    [
      '--yes',
      `lighthouse@${VERSION}`,
      URL,
      '--quiet',
      '--output=json',
      `--output-path=${SALIDA}`,
      `--only-categories=${CATEGORIAS.join(',')}`,
      '--chrome-flags=--headless=new --no-first-run',
    ],
    { shell: windows, stdio: ['ignore', 'inherit', 'inherit'] },
  );
  // En Windows, chrome-launcher truena al BORRAR su perfil temporal (EPERM: Chrome todavía lo
  // tiene abierto) DESPUÉS de guardar el reporte, y lighthouse sale con 1. Si el reporte está
  // completo y sin `runtimeError`, esa limpieza fallida no invalida la medición.
  let reporte;
  try {
    reporte = JSON.parse(readFileSync(SALIDA, 'utf8'));
  } catch {
    throw new Error(`lighthouse terminó con código ${lh.status} y sin reporte`);
  }
  if (reporte.runtimeError) {
    throw new Error(`lighthouse no pudo medir la página: ${reporte.runtimeError.message}`);
  }
  if (lh.status !== 0) {
    console.log(`(lighthouse salió con ${lh.status} al limpiar Chrome; el reporte está completo)`);
  }
  let bajas = 0;
  console.log(
    `Lighthouse ${reporte.lighthouseVersion} · ${reporte.finalDisplayedUrl} · ${reporte.configSettings.formFactor}`,
  );
  for (const c of CATEGORIAS) {
    const puntos = Math.round(reporte.categories[c].score * 100);
    const ok = puntos > MINIMO;
    if (!ok) bajas += 1;
    console.log(`${ok ? '✓' : '✗'} ${reporte.categories[c].title.padEnd(16)} ${puntos}`);
  }
  // Siempre: lo que resta puntos, aunque pase, para no quedarse al filo sin saberlo.
  {
    for (const auditoria of Object.values(reporte.audits)) {
      if (
        auditoria.score !== null &&
        auditoria.score < 0.9 &&
        auditoria.scoreDisplayMode !== 'informative'
      ) {
        console.log(`   · ${auditoria.id}: ${auditoria.title}`);
      }
    }
  }
  if (bajas > 0) console.error(`Alguna categoría no pasa de ${MINIMO}.`);
  else codigo = 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  detener();
  rmSync(SALIDA, { force: true });
}
process.exit(codigo);
