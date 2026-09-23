import {
  duracion,
  mensajeCierreDia,
  mensajeFoliosBajo,
  mensajeMesaAbierta,
  mensajeSucursalSinReporte,
  type LugarAlerta,
} from './mensajes';

const LUGAR: LugarAlerta = {
  empresaId: 'e1',
  empresa: 'Demo',
  sucursalId: 's1',
  sucursal: 'Centro',
};

describe('mensajes de push (F2-146)', () => {
  it.each([
    [0, '0 min'],
    [14.9, '14 min'],
    [60, '1 h'],
    [125, '2 h 5 min'],
    [-3, '0 min'],
  ])('duracion(%s) = %s', (min, texto) => {
    expect(duracion(min)).toBe(texto);
  });

  it('sucursal sin reportar: con edad, y "nunca" cuando no hay reporte', () => {
    expect(mensajeSucursalSinReporte('a1', LUGAR, { nunca: false, edadSegundos: 840 })).toEqual({
      titulo: 'Sucursal sin reportar',
      cuerpo: 'Centro (Demo) no reporta desde hace 14 min.',
      url: '/alertas?empresa=e1&sucursal=s1',
      etiqueta: 'alerta-a1',
    });
    expect(mensajeSucursalSinReporte('a1', LUGAR, { nunca: true }).cuerpo).toBe(
      'Centro (Demo) nunca ha reportado.',
    );
    // Un detalle ilegible no inventa una edad.
    expect(mensajeSucursalSinReporte('a1', LUGAR, null).cuerpo).toBe(
      'Centro (Demo) nunca ha reportado.',
    );
  });

  it('mesa abierta: sin cifras de venta; detalle incompleto no inventa minutos', () => {
    expect(mensajeMesaAbierta('a2', LUGAR, { folio: 'F1', mesa: '12', minutos: 64 })).toEqual({
      titulo: 'Mesa 12 abierta hace 1 h 4 min',
      cuerpo: 'Centro (Demo)',
      url: '/mesas?empresa=e1&sucursal=s1',
      etiqueta: 'alerta-a2',
    });
    expect(mensajeMesaAbierta('a2', LUGAR, {}).titulo).toBe('Una mesa abierta demasiado tiempo');
  });

  it('folios: bajo con cifras, agotado dice que la emisión está detenida', () => {
    expect(
      mensajeFoliosBajo({ estado: 'bajo', disponible: 1500, vigenteTotal: 10000, umbralPct: 20 })
        .cuerpo,
    ).toBe('Quedan 1,500 de 10,000 folios (umbral 20 %).');
    expect(
      mensajeFoliosBajo({ estado: 'agotado', disponible: 0, vigenteTotal: 100, umbralPct: 20 })
        .titulo,
    ).toBe('Se acabaron los folios');
  });

  it('cierre del día: pesos desde el texto decimal, singular, y sin ticket si no hay', () => {
    const e = { id: 'e1', nombre: 'Demo' };
    expect(
      mensajeCierreDia(e, '2026-09-21', {
        venta: '12345.60',
        cuentas: 1,
        ticketPromedio: '12345.60',
      }),
    ).toEqual({
      titulo: 'Demo: cierre del 21 sep',
      cuerpo: 'Venta $12,345.60 · 1 cuenta · ticket prom. $12,345.60',
      url: '/?empresa=e1&periodo=rango&desde=2026-09-21&hasta=2026-09-21',
      etiqueta: 'cierre-e1-2026-09-21',
    });
    const vacio = mensajeCierreDia(e, '2026-09-21', {
      venta: '0.00',
      cuentas: 0,
      ticketPromedio: null,
    });
    expect(vacio.titulo).toBe('Demo: sin ventas del 21 sep');
    expect(JSON.stringify(vacio)).not.toContain('$0.00');
  });
});
