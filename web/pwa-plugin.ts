import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import type { Plugin } from 'vite';

/**
 * Compila el service worker de la PWA (F2-146) como entrada propia a `dist/sw.js` (raíz:
 * su alcance es todo el panel) y le inyecta:
 * - `__PRECACHE__`: TODO lo que el navegador necesita para abrir el armazón sin red —
 *   `index.html`, cada archivo del build (JS, CSS, chunks perezosos) y los de `public/`
 *   (manifest, íconos, favicon);
 * - `__VERSION__`: una huella del contenido de todo eso. Un build distinto = un `sw.js`
 *   distinto = el navegador instala el nuevo y el viejo borra su caché.
 *
 * Sólo en `vite build`. En `vite dev` no hay service worker (`pwa/registrar.ts` tampoco lo
 * registra): la caché estorbaría al recargar en caliente.
 */
const ENTRADA = resolve(import.meta.dirname, 'src/pwa/sw.ts');
const PUBLICO = resolve(import.meta.dirname, 'public');
export const ARCHIVO_SW = 'sw.js';

function archivosDe(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    return statSync(ruta).isDirectory() ? archivosDe(ruta) : [ruta];
  });
}

export function pluginServiceWorker(): Plugin {
  return {
    name: 'monitor-service-worker',
    apply: 'build',
    enforce: 'post',
    buildStart() {
      this.emitFile({ type: 'chunk', id: ENTRADA, fileName: ARCHIVO_SW });
    },
    generateBundle(_opciones, bundle) {
      const sw = bundle[ARCHIVO_SW];
      if (!sw || sw.type !== 'chunk') {
        this.error(`No se generó ${ARCHIVO_SW}: el service worker no se compiló.`);
      }
      const huella = createHash('sha256');
      const delBuild = Object.keys(bundle)
        .filter((f) => f !== ARCHIVO_SW && !f.endsWith('.map'))
        .sort();
      for (const f of delBuild) {
        const item = bundle[f];
        huella.update(f).update(item.type === 'chunk' ? item.code : item.source);
      }
      const publicos = archivosDe(PUBLICO)
        .map((ruta) => relative(PUBLICO, ruta).split('\\').join('/'))
        .sort();
      for (const f of publicos) huella.update(f).update(readFileSync(join(PUBLICO, f)));
      const precache = [...new Set(['index.html', ...delBuild, ...publicos])].map((f) => `/${f}`);
      const version = huella.digest('hex').slice(0, 16);
      const antes = sw.code;
      sw.code = sw.code
        .replace(/\b__PRECACHE__\b/g, JSON.stringify(precache))
        .replace(/\b__VERSION__\b/g, JSON.stringify(version));
      if (sw.code === antes || /\b__PRECACHE__\b|\b__VERSION__\b/.test(sw.code)) {
        this.error('No se pudo inyectar la lista de precache en el service worker.');
      }
    },
  };
}
