import { describe, expect, it } from 'vitest';

// Guardia del Caddy del servicio web en Railway (docs/deploy-railway.md). Si un archivo se
// mueve o se borra, la importación truena y el test FALLA (no se salta). Lo que vigila es
// lo que, roto, no se nota hasta producción: la IP de los rate limits, el mismo origen de
// /api y el socket, y que la landing no exponga el resto de la API.
import railway from '../../../infra/caddy/Caddyfile.railway?raw';
import snippets from '../../../infra/caddy/seguridad.caddy?raw';

/**
 * El cuerpo de un bloque `nombre { … }` (llaves balanceadas). Si `inicio` termina en `{`,
 * ésa es la llave que abre (los `{$VAR}` del nombre no cuentan).
 */
function bloque(texto: string, inicio: string): string {
  const i = texto.indexOf(inicio);
  if (i < 0) throw new Error(`No está el bloque «${inicio}».`);
  let nivel = 0;
  const abre = inicio.endsWith('{') ? i + inicio.length - 1 : texto.indexOf('{', i);
  for (let j = abre; j < texto.length; j++) {
    if (texto[j] === '{') nivel++;
    if (texto[j] === '}' && --nivel === 0) return texto.slice(i, j + 1);
  }
  throw new Error(`El bloque «${inicio}» no cierra.`);
}

/** Sin comentarios, para no aprobar una directiva que sólo aparece en un comentario. */
function sinComentarios(texto: string): string {
  return texto
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .join('\n');
}

const conf = sinComentarios(railway);
const snip = sinComentarios(snippets);

describe('IP del cliente detrás del borde de Railway', () => {
  it('Caddy toma la IP de X-Real-IP (la que pisa el borde), no del X-Forwarded-For', () => {
    const globales = bloque(conf, 'servers');
    expect(globales).toMatch(/trusted_proxies static 0\.0\.0\.0\/0 ::\/0/);
    expect(globales).toMatch(/client_ip_headers X-Real-IP\s/);
  });

  it('a la API le llega UN solo X-Forwarded-For, el del cliente: TRUST_PROXY_SALTOS=1', () => {
    expect(bloque(snip, '(api)')).toMatch(/header_up X-Forwarded-For \{client_ip\}/);
    expect(bloque(conf, 'handle /api/publico/*')).toMatch(
      /header_up X-Forwarded-For \{client_ip\}/,
    );
  });
});

describe('mismo origen: /api y el socket por la red privada', () => {
  const panel = bloque(conf, '\n:{$PORT:8080} {');

  it('el panel importa cabeceras, /api hacia API_INTERNAL_URL y la SPA', () => {
    expect(panel).toMatch(/import cabeceras_seguridad/);
    expect(panel).toMatch(/import api \{\$API_INTERNAL_URL\}/);
    expect(panel).toMatch(/import spa \/srv\/web/);
  });

  it('/api/* quita el prefijo (como el proxy de Vite) y reescribe el Path de la cookie', () => {
    const api = bloque(snip, '(api)');
    // `handle_path` quita `/api`: el socket de `/api/socket.io` llega a `/socket.io` y Caddy
    // sube el WebSocket solo.
    expect(api).toMatch(/handle_path \/api\/\*/);
    expect(api).toMatch(/header_down Set-Cookie "Path=\/auth" "Path=\/api\/auth"/);
  });

  it('sin TLS propio: Railway lo termina en su borde', () => {
    expect(bloque(conf, '{')).toMatch(/auto_https off/);
  });
});

describe('la landing, sólo en su dominio', () => {
  const landing = bloque(conf, 'http://{$LANDING_HOST:landing.invalid}:{$PORT:8080} {');

  it('sólo deja pasar /api/publico/*; el resto de /api es 404', () => {
    expect(landing).toMatch(/handle \/api\/publico\/\*/);
    expect(bloque(landing, 'handle /api/* {')).toMatch(/respond 404/);
    expect(landing).not.toMatch(/import api /);
    expect(landing).toMatch(/import landing \/srv\/landing/);
  });
});
