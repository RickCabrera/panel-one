import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv, type ProxyOptions } from 'vite';
import { defineConfig } from 'vitest/config';

import { pluginServiceWorker } from './pwa-plugin.ts';

/**
 * La SPA habla con la API SIEMPRE en el mismo origen, bajo `/api`. En local lo hace
 * este proxy; en producción lo tendrá que hacer Caddy igual (F1-002).
 *
 * Por qué mismo origen y no CORS: la cookie de refresh de la API es
 * `HttpOnly; SameSite=Strict; Path=/auth`. Con el proxy no hace falta abrir CORS con
 * credenciales, y `cookiePathRewrite` cambia el `Path` a `/api/auth` para que el
 * navegador la mande a `/api/auth/refresh`, que es donde la SPA la pide.
 *
 * `API_PROXY_TARGET` no lleva el prefijo `VITE_`: se queda en este proceso y nunca
 * entra al bundle.
 */
function proxyApi(target: string): Record<string, ProxyOptions> {
  return {
    // Con '^' Vite lo trata como regex: exige la barra, así '/apixyz' no entra.
    '^/api/': {
      target,
      changeOrigin: true,
      // F2-142: el socket del tiempo real (`/api/socket.io`) sube a WebSocket por aquí.
      ws: true,
      rewrite: (ruta) => ruta.replace(/^\/api(?=\/)/, ''),
      cookiePathRewrite: { '/auth': '/api/auth' },
    },
  };
}

export default defineConfig(({ mode }) => {
  const entorno = loadEnv(mode, process.cwd(), '');
  const proxy = proxyApi(entorno.API_PROXY_TARGET || 'http://localhost:3000');

  return {
    // F2-146: el service worker de la PWA (`dist/sw.js`, sólo en build).
    plugins: [react(), tailwindcss(), pluginServiceWorker()],
    server: { port: 5173, proxy },
    preview: { proxy },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['./src/test-setup.ts'],
    },
  };
});
