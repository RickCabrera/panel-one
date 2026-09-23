import { describe, expect, it, vi } from 'vitest';

import { cuerpo, enviar, validar, type DatosContacto } from './contacto';

// El formulario de contacto de la landing (F2-147): validación en español campo por campo y el
// envío contra el contrato de `POST /publico/contacto`. El api vuelve a validar (e2e en /api).

const VALIDO: DatosContacto = {
  nombre: '  Ana  ',
  email: ' ana@ejemplo.test ',
  telefono: '',
  negocio: 'Tacos Demo',
  sucursales: '3',
  mensaje: 'Quiero una demo',
  sitio: '',
};

function respuesta(status: number): Response {
  return new Response(status === 202 ? '{"recibido":true}' : '{}', { status });
}

describe('validar', () => {
  it('un formulario bueno no tiene errores', () => {
    expect(validar(VALIDO)).toEqual({});
  });

  it.each([
    ['nombre', { nombre: '   ' }, 'Escribe tu nombre.'],
    ['nombre', { nombre: 'x'.repeat(121) }, 'El nombre admite hasta 120 caracteres.'],
    ['email', { email: '' }, 'Escribe tu email para poder responderte.'],
    ['email', { email: 'ana@' }, 'Ese email no parece válido.'],
    ['telefono', { telefono: '1'.repeat(31) }, 'El teléfono admite hasta 30 caracteres.'],
    ['sucursales', { sucursales: '0' }, 'Escribe un número de sucursales entre 1 y 500.'],
    ['sucursales', { sucursales: '2.5' }, 'Escribe un número de sucursales entre 1 y 500.'],
    ['sucursales', { sucursales: '501' }, 'Escribe un número de sucursales entre 1 y 500.'],
    ['mensaje', { mensaje: ' ' }, 'Cuéntanos qué necesitas.'],
    ['mensaje', { mensaje: 'x'.repeat(2001) }, 'El mensaje admite hasta 2000 caracteres.'],
  ] as const)('%s: %o → "%s"', (campo, cambios, mensaje) => {
    expect(validar({ ...VALIDO, ...cambios })[campo]).toBe(mensaje);
  });
});

describe('cuerpo', () => {
  it('recorta, convierte sucursales a número y omite los opcionales vacíos', () => {
    expect(cuerpo(VALIDO)).toEqual({
      nombre: 'Ana',
      email: 'ana@ejemplo.test',
      negocio: 'Tacos Demo',
      sucursales: 3,
      mensaje: 'Quiero una demo',
    });
  });

  it('la trampa para bots viaja si un bot la llenó (el api la descarta)', () => {
    expect(cuerpo({ ...VALIDO, sitio: 'https://spam.test' }).sitio).toBe('https://spam.test');
  });
});

describe('enviar', () => {
  it('POST a /api/publico/contacto con JSON; 202 es éxito', async () => {
    const pedir = vi.fn(async () => respuesta(202));
    expect(await enviar(VALIDO, pedir as unknown as typeof fetch)).toEqual({ ok: true });
    expect(pedir).toHaveBeenCalledWith('/api/publico/contacto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo(VALIDO)),
    });
  });

  it.each([
    [429, /Espera un minuto/],
    [400, /Revisa los datos/],
    [503, /Intenta de nuevo en unos minutos/],
    [500, /Intenta de nuevo en unos minutos/],
  ])('%i → mensaje en español', async (status, mensaje) => {
    const r = await enviar(VALIDO, (async () => respuesta(status)) as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.mensaje).toMatch(mensaje);
  });

  it('sin red → lo dice', async () => {
    const r = await enviar(VALIDO, (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, mensaje: expect.stringMatching(/No hay conexión/) });
  });
});
