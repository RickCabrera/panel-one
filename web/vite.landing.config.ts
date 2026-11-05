import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

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
 *
 * `URL_SITIO` (UI-03, sin `VITE_`): el origen público de la landing, p. ej.
 * `https://yocontrolo.mx`, para la `og:image` absoluta que piden WhatsApp y Facebook. Vacío por
 * defecto: la imagen queda como `/og.png` (relativa; algunos lectores de Open Graph no la toman).
 */
function reemplazos(valores: Record<string, string>): Plugin {
  return {
    name: 'landing-reemplazos',
    transformIndexHtml: (html) =>
      Object.entries(valores).reduce((h, [marca, valor]) => h.replaceAll(marca, valor), html),
  };
}

/**
 * Las fuentes salen de `@fontsource` (empaquetadas, mismo origen: la CSP dice `font-src 'self'`).
 * `estilos.css` declara sólo los `.woff2` latinos que usa, con `url('@fontsource/...')`; este
 * alias apunta a la carpeta real del paquete, esté donde npm lo haya dejado (workspaces).
 */
const FONTSOURCE = dirname(
  dirname(createRequire(import.meta.url).resolve('@fontsource/lilita-one/package.json')),
);

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
    // Su propio `public/` (robots.txt, og.png), no el de la SPA: el manifest y los íconos son de
    // la PWA.
    publicDir: resolve(import.meta.dirname, 'landing', 'public'),
    plugins: [
      reemplazos({
        __URL_PANEL__: entorno.URL_PANEL || '/login',
        __URL_SITIO__: (entorno.URL_SITIO || '').replace(/\/+$/, ''),
      }),
    ],
    resolve: { alias: [{ find: /^@fontsource\//, replacement: `${FONTSOURCE}/` }] },
    build: {
      outDir: resolve(import.meta.dirname, 'dist-landing'),
      emptyOutDir: true,
    },
    server: { port: 5174, proxy },
    preview: { port: 4174, proxy },
  };
});
