/// <reference lib="webworker" />
/**
 * Service worker de la PWA (F2-146). Sólo conecta los eventos con `sw-logica.ts`, donde
 * vive (y se prueba) todo lo demás. Se compila como entrada propia a `dist/sw.js`
 * (plugin `pwa/plugin-sw.ts`), que además sustituye `__PRECACHE__` y `__VERSION__` por la
 * lista de archivos del build y su huella: un build nuevo = un sw.js distinto = el
 * navegador instala el nuevo y borra la caché vieja.
 */
import { crearManejadores } from './sw-logica';

declare const self: ServiceWorkerGlobalScope;
declare const __PRECACHE__: string[];
declare const __VERSION__: string;

const manejadores = crearManejadores(
  {
    origen: self.location.origin,
    caches: self.caches,
    fetch: (peticion) => fetch(peticion),
    ventanas: () => self.clients.matchAll({ type: 'window', includeUncontrolled: true }),
    abrirVentana: (url) => self.clients.openWindow(url),
    mostrar: (titulo, opciones) => self.registration.showNotification(titulo, opciones),
  },
  __PRECACHE__,
  __VERSION__,
);

self.addEventListener('install', (evento) => {
  evento.waitUntil(manejadores.instalar().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(manejadores.activar().then(() => self.clients.claim()));
});

self.addEventListener('fetch', (evento) => {
  const respuesta = manejadores.responder(evento.request);
  if (respuesta) evento.respondWith(respuesta);
});

self.addEventListener('push', (evento) => {
  evento.waitUntil(manejadores.push(evento.data?.text() ?? null));
});

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  evento.waitUntil(manejadores.clic(evento.notification.data));
});
