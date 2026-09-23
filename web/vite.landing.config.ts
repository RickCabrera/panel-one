import { resolve } from 'node:path';

import { loadEnv, type Plugin, type ProxyOptions } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Build de la landing pública (F2-147), APARTE de la SPA: HTML + CSS + un módulo chico para el
 * formulario de contacto, sin React. Sale a `dist-landing/` (no a `dist/`), así que no entra al
 * precache de la PWA ni al tope de `check:bundle`. `npm run build` construye las dos.
 *
 * En producción Caddy sirve `dist-landing/` en el dominio raíz y pasa `/api` al api en el mismo
 * origen (el formulario postea a `/api/publico/contacto`, sin CORS): nota en F1-002.
 *
 * `URL_PANEL` (sin `VITE_`, no entra a ningún bundle): a dónde lleva "Entrar al panel". Por
 * defecto `/login`, el panel en el mismo origen.
 * DECISION PROVISIONAL (nocturno): no se sabe todavía si el panel vivirá en otro subdominio.
 */
function urlPanel(valor: string): Plugin {
  return {
    name: 'landing-url-panel',
    transformIndexHtml: (html) => html.replaceAll('__URL_PANEL__', valor),
  };
}

export default defineConfig(({ mode }) => {
  const entorno = loadEnv(mode, process.cwd(), '');
  const proxy: Record<string, ProxyOptions> = {
    '^/api/': {
      target: entorno.API_PROXY_TARGET || 'http://localhost:3000',
      changeOrigin: true,
      rewrite: (ruta) => ruta.replace(/^\/api(?=\/)/, ''),
    },
  };
  return {
    root: resolve(import.meta.dirname, 'landing'),
    // Su propio `public/` (robots.txt), no el de la SPA: el manifest y los íconos son de la PWA.
    publicDir: resolve(import.meta.dirname, 'landing', 'public'),
    plugins: [urlPanel(entorno.URL_PANEL || '/login')],
    build: {
      outDir: resolve(import.meta.dirname, 'dist-landing'),
      emptyOutDir: true,
    },
    server: { port: 5174, proxy },
    preview: { port: 4174, proxy },
  };
});
