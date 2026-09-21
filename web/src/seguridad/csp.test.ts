import { describe, expect, it } from 'vitest';

// Si el archivo se mueve o se borra, la importación truena y este test FALLA (no se
// salta): la CSP de producción vive ahí y este test es su guardia (F1-092).
import caddy from '../../../infra/caddy/seguridad.caddy?raw';
import indexHtml from '../../index.html?raw';

/** Las directivas de la CSP del snippet `(spa)`, como `{ 'script-src': ["'self'"] }`. */
function directivasCsp(texto: string): Record<string, string[]> {
  const linea = /header Content-Security-Policy "([^"]+)"/.exec(texto);
  if (!linea) throw new Error('seguridad.caddy no trae la cabecera Content-Security-Policy.');
  return Object.fromEntries(
    linea[1]
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((partes) => partes[0])
      .map(([nombre, ...valores]) => [nombre, valores]),
  );
}

describe('CSP de la SPA (infra/caddy/seguridad.caddy)', () => {
  const csp = directivasCsp(caddy);

  it('scripts y estilos sólo del mismo origen, sin inline ni eval', () => {
    expect(csp['script-src']).toEqual(["'self'"]);
    expect(csp['style-src']).toEqual(["'self'"]);
    expect(csp['default-src']).toEqual(["'self'"]);
  });

  it('no se deja enmarcar, ni plugins, ni cambiar la base o el destino de formularios', () => {
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    expect(csp['form-action']).toEqual(["'self'"]);
  });

  it('la API es del mismo origen (/api): connect-src no abre otros', () => {
    expect(csp['connect-src']).toEqual(["'self'"]);
  });

  it('ninguna directiva afloja con comodines, unsafe-* o esquemas abiertos', () => {
    const todas = Object.values(csp).flat();
    expect(todas.filter((v) => /unsafe|\*|^https?:$|^blob:$/.test(v))).toEqual([]);
  });
});

describe('index.html cabe en esa CSP', () => {
  it('sin <script> inline, sin <style> y sin atributos style= o on*=', () => {
    const scripts = [...indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, atributos, cuerpo] of scripts) {
      expect(atributos).toMatch(/\bsrc=/);
      expect(cuerpo.trim()).toBe('');
    }
    expect(indexHtml).not.toMatch(/<style\b/i);
    expect(indexHtml).not.toMatch(/\sstyle=/i);
    expect(indexHtml).not.toMatch(/\son[a-z]+=/i);
  });
});
