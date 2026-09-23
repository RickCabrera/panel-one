import { calcularArranque, type SucursalArranque } from './arranque';
import { plantillaContacto } from './contacto';
import { CONTACTO_DESTINO_LOCAL, leerOnboardingConfig } from './onboarding.config';

function suc(nombre: string, cambios: Partial<SucursalArranque> = {}): SucursalArranque {
  return {
    id: `id-${nombre}`,
    nombre,
    tieneKey: true,
    agenteReporto: true,
    tieneVentas: true,
    ...cambios,
  };
}

describe('calcularArranque (F2-147)', () => {
  it('sin sucursales: todo pendiente salvo lo que no depende de ellas, y lo dice', () => {
    const { completo, pasos } = calcularArranque({ sucursales: [], adminsEmpresa: 1 });
    expect(completo).toBe(false);
    expect(pasos.map((p) => [p.clave, p.hecho])).toEqual([
      ['sucursales', false],
      ['llaves', false],
      ['agente', false],
      ['ventas', false],
      ['usuario', true],
    ]);
    expect(pasos[1].detalle).toBe('Primero hace falta una sucursal.');
  });

  it('todo hecho = completo', () => {
    const r = calcularArranque({ sucursales: [suc('A'), suc('B')], adminsEmpresa: 2 });
    expect(r.completo).toBe(true);
    expect(r.pasos.every((p) => p.pendientes.length === 0)).toBe(true);
  });

  it('lista qué sucursal falta en cada paso, con el conteo en español', () => {
    const r = calcularArranque({
      sucursales: [
        suc('A', { tieneKey: false, agenteReporto: false, tieneVentas: false }),
        suc('B'),
      ],
      adminsEmpresa: 0,
    });
    const llaves = r.pasos.find((p) => p.clave === 'llaves')!;
    expect(llaves.pendientes).toEqual([{ sucursalId: 'id-A', nombre: 'A' }]);
    expect(llaves.detalle).toBe('Falta la key en 1 de 2 sucursales.');
    expect(r.pasos.find((p) => p.clave === 'usuario')!.detalle).toMatch(/Nadie de la empresa/);
  });

  it('ventas sin agente reportado (el seed) se marca hecho pero lo explica', () => {
    const r = calcularArranque({
      sucursales: [suc('A', { tieneKey: false, agenteReporto: false })],
      adminsEmpresa: 1,
    });
    const ventas = r.pasos.find((p) => p.clave === 'ventas')!;
    expect(ventas.hecho).toBe(true);
    expect(ventas.detalle).toMatch(/datos de demostración o de un agente anterior/);
    expect(r.completo).toBe(false);
  });
});

describe('plantillaContacto (F2-147)', () => {
  it('escapa todo lo del visitante y deja los vacíos como "—"', () => {
    const p = plantillaContacto({
      nombre: 'A & "B"',
      email: 'a@b.test',
      mensaje: '<img src=x onerror=alert(1)>\nlínea 2',
    });
    expect(p.html).toContain('A &amp; &quot;B&quot;');
    expect(p.html).not.toContain('<img');
    expect(p.html).toContain('<br>línea 2');
    expect(p.texto).toContain('Teléfono: —');
    expect(p.texto).toContain('Sucursales: —');
    expect(p.asunto).toBe('Contacto: A & "B"');
  });

  it('el asunto no lleva saltos de línea y se corta a 200', () => {
    const p = plantillaContacto({
      nombre: `x\r\n${'y'.repeat(300)}`,
      email: 'a@b.test',
      mensaje: 'm',
    });
    expect(p.asunto).not.toMatch(/[\r\n]/);
    expect(p.asunto.length).toBeLessThanOrEqual(200);
  });
});

describe('leerOnboardingConfig (F2-147)', () => {
  it('sin variables: buzón local fuera de producción, nulo en producción; sin descarga', () => {
    expect(leerOnboardingConfig({})).toEqual({
      contactoDestino: CONTACTO_DESTINO_LOCAL,
      descargaAgente: null,
    });
    expect(leerOnboardingConfig({ NODE_ENV: 'production' })).toEqual({
      contactoDestino: null,
      descargaAgente: null,
    });
  });

  it('con valores válidos los usa', () => {
    expect(
      leerOnboardingConfig({
        CONTACTO_DESTINO: ' ventas@monitor.test ',
        AGENTE_URL_DESCARGA: 'https://descargas.monitor.test/agente.zip',
      }),
    ).toEqual({
      contactoDestino: 'ventas@monitor.test',
      descargaAgente: 'https://descargas.monitor.test/agente.zip',
    });
  });

  it.each([
    [{ CONTACTO_DESTINO: 'no-es-email' }, /CONTACTO_DESTINO/],
    [{ AGENTE_URL_DESCARGA: 'no es url' }, /AGENTE_URL_DESCARGA no es una URL/],
    [{ AGENTE_URL_DESCARGA: 'http://inseguro.test/a.zip' }, /tiene que ser https/],
  ])('un valor mal formado truena nombrando la variable (%o)', (entorno, error) => {
    expect(() => leerOnboardingConfig(entorno)).toThrow(error);
  });
});
