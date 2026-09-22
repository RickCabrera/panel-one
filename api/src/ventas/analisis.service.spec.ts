import type { ConsultaVentas, FiltroVentas } from '../scope/consulta-ventas';
import type { EmpresaScope } from '../scope/empresa-scope';
import type { AgregadosVentasService } from './agregados-ventas.service';
import { AnalisisService, diaSemanaIso } from './analisis.service';

// El mapeo de los desgloses de Análisis (F2-221) con un ejecutor falso: casos que el seed no
// produce (periodo vacío, filas fuera de 7 × 24). Los números de verdad los fija el e2e contra
// Postgres (`analisis.e2e.spec.ts` y el bloque F2-221 de `lectura.e2e.spec.ts`).

const SCOPE: EmpresaScope = { tipo: 'global' };
const FILTRO: FiltroVentas = {
  empresaId: 'f1011000-0000-4000-8000-00000000000a',
  desde: '2026-09-14',
  hasta: '2026-09-20',
};

function servicio(filas: unknown[]) {
  const consultar = jest.fn().mockResolvedValue(filas);
  const agregados = {
    consulta: jest.fn().mockResolvedValue({ consultar } as unknown as ConsultaVentas),
  } as unknown as AgregadosVentasService;
  return { svc: new AnalisisService(agregados), consultar, agregados };
}

describe('AnalisisService (mapeo, F2-221)', () => {
  it('pasa por la consulta con scope del helper (400/404 los resuelve ella)', async () => {
    const { svc, agregados } = servicio([]);
    await svc.porMesero(SCOPE, FILTRO);
    expect(agregados.consulta).toHaveBeenCalledWith(SCOPE, FILTRO);
  });

  it('por producto sin ventas: venta 0.00, sin filas, diferencia 0.00 (el LEFT JOIN da una fila nula)', async () => {
    const { svc } = servicio([
      { venta: '0', cuentas: 0, producto: null, importe: null, cantidad: null },
    ]);
    await expect(svc.porProducto(SCOPE, FILTRO)).resolves.toEqual({
      venta: '0.00',
      cuentas: 0,
      productos: [],
      diferenciaCuentas: '0.00',
    });
  });

  it('por producto: la diferencia puede ser negativa y los importes salen con 2 decimales', async () => {
    const { svc } = servicio([
      { venta: '100', cuentas: 1, producto: 'Taco', importe: '90.5', cantidad: '1.5' },
      { venta: '100', cuentas: 1, producto: 'Agua', importe: '20', cantidad: '1' },
    ]);
    const r = await svc.porProducto(SCOPE, FILTRO);
    expect(r.productos).toEqual([
      { producto: 'Taco', importe: '90.50', cantidad: '1.500' },
      { producto: 'Agua', importe: '20.00', cantidad: '1.000' },
    ]);
    expect(r.diferenciaCuentas).toBe('-10.50');
  });

  it('por mesero: ticket promedio null sin cuentas (sólo cancelados)', async () => {
    const { svc } = servicio([
      {
        sucursal_id: 's',
        sucursal: 'S',
        mesero: 'Pedro',
        cuentas: 0,
        venta: '0',
        comensales: 0,
        cuentas_con_comensales: 0,
        propina: '0',
        descuentos: '0',
        cuentas_con_descuento: 0,
        cancelados: 2,
        monto_cancelado: '45.5',
      },
    ]);
    const [f] = await svc.porMesero(SCOPE, FILTRO);
    expect(f).toMatchObject({
      venta: '0.00',
      ticketPromedio: null,
      cancelados: { cuentas: 2, monto: '45.50' },
    });
  });

  it('hora × día sin ventas: 168 celdas en cero y los días del rango (una semana = 1 c/u)', async () => {
    const { svc } = servicio([]);
    const r = await svc.horaDia(SCOPE, FILTRO);
    expect(r.celdas).toHaveLength(168);
    expect(r.celdas.every((c) => c.venta === '0.00' && c.cuentas === 0)).toBe(true);
    expect(r.celdas[167]).toEqual({ diaSemana: 7, hora: 23, venta: '0.00', cuentas: 0 });
    expect(r.diasEnRango.map((d) => d.dias)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it('hora × día: una fila fuera de 7 × 24 es un error, no una celda que se pierde', async () => {
    const { svc } = servicio([{ dia_semana: 0, hora: 3, venta: '1', cuentas: 1 }]);
    await expect(svc.horaDia(SCOPE, FILTRO)).rejects.toThrow('fuera de 7 × 24');
  });

  it('por mesa sin ventas: sin promedio ni rotación (null, nunca 0)', async () => {
    const { svc } = servicio([]);
    await expect(svc.porMesa(SCOPE, FILTRO)).resolves.toEqual({
      filas: [],
      sinMesa: { cuentas: 0, venta: '0.00' },
      global: {
        venta: '0.00',
        cuentas: 0,
        minutosPromedio: null,
        cuentasConDuracion: 0,
        duracionesInvalidas: 0,
        mesas: 0,
        cuentasConMesa: 0,
        rotacion: null,
      },
    });
  });

  it('por mesa: la duración promedio redondea a 1 decimal, mitad lejos de cero', async () => {
    const { svc } = servicio([
      // 3 cuentas, 5 min 15 s en total → 105 s de promedio = 1.75 min → "1.8".
      {
        sucursal_id: 's',
        sucursal: 'S',
        mesa: '1',
        cuentas: 3,
        venta: '30',
        segundos: '315',
        con_duracion: 3,
        invalidas: 0,
      },
    ]);
    const r = await svc.porMesa(SCOPE, FILTRO);
    expect(r.filas[0].minutosPromedio).toBe('1.8');
    expect(r.global.rotacion).toBe('3.00');
  });

  it.each([
    ['2026-09-14', 1],
    ['2026-09-19', 6],
    ['2026-09-20', 7],
    ['2024-02-29', 4],
  ])('diaSemanaIso(%s) = %i', (dia, esperado) => {
    expect(diaSemanaIso(dia)).toBe(esperado);
  });
});
