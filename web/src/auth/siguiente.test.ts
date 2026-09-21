import { describe, expect, it } from 'vitest';

import { destinoSeguro, rutaLogin } from './siguiente';

describe('destinoSeguro', () => {
  it.each([
    '/',
    '/tickets',
    '/tickets?empresa=E&sucursal=S',
    '/reportes?empresa=E#arriba',
    '/tickets?folio=A%20B',
  ])('acepta la ruta interna %j', (valor) => {
    expect(destinoSeguro(valor)).toBe(valor);
  });

  it.each([
    ['vacío', ''],
    ['null', null],
    ['undefined', undefined],
    ['protocolo relativo', '//evil.com'],
    ['barra invertida', '/\\evil.com'],
    ['URL absoluta', 'https://evil.com/tickets'],
    ['javascript:', 'javascript:alert(1)'],
    ['sin barra inicial', 'tickets'],
    ['espacio al inicio', ' //evil.com'],
    ['tab al inicio', '\t/evil'],
    ['salto de línea dentro', '/\n/evil.com'],
    ['codificado', '/%2F%2Fevil.com'],
    ['barra invertida codificada', '/%5Cevil.com'],
    ['codificación rota', '/%E0%A4%A'],
    ['bucle al login', '/login?siguiente=/tickets'],
  ])('rechaza %s', (_caso, valor) => {
    expect(destinoSeguro(valor)).toBe('/');
  });
});

describe('rutaLogin', () => {
  it('codifica el destino para no perder los filtros', () => {
    const ruta = rutaLogin('/tickets?empresa=E&sucursal=S');

    expect(ruta).toBe('/login?siguiente=%2Ftickets%3Fempresa%3DE%26sucursal%3DS');
    const leido = new URLSearchParams(ruta.split('?')[1]).get('siguiente');
    expect(leido).toBe('/tickets?empresa=E&sucursal=S');
  });

  it('sin destino, el login a secas', () => {
    expect(rutaLogin('/')).toBe('/login');
  });
});
