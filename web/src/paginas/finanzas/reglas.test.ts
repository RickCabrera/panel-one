import { describe, expect, it } from 'vitest';

import type {
  CompraResumen,
  Compras,
  CostoVendido,
  EstadoResultados,
  EstadoResultadosBase,
  EstadoResultadosSucursal,
  Gasto,
} from '../../api/tipos';
import { ErrorCsv } from '../../csv/csv';
import {
  avisosEstado,
  barrasEstado,
  comprasACsv,
  dineroONulo,
  ENCABEZADOS_COMPRAS,
  ENCABEZADOS_ESTADO,
  ENCABEZADOS_GASTOS,
  erroresGasto,
  estadoACsv,
  estadoVacio,
  faltaDelCosto,
  gastosACsv,
  motivoSinUtilidad,
  sucursalesSinCompras,
  TEXTO_MOTIVO,
  textoMargen,
  vacioCompras,
  type FormGasto,
} from './reglas';

// Reglas puras de Compras y de Gastos y utilidad (F2-126). Todas las cifras están escritas a
// mano: aquí no se recalcula nada, se prueba cómo se dice (y cómo se exporta) lo que manda el API.

const BOM = '\uFEFF';

const costo = (p: Partial<CostoVendido> = {}): CostoVendido => ({
  importe: '3000.00',
  completo: true,
  insumosSinCosto: 0,
  productosSinCosto: 0,
  ventaSinCosto: '0.00',
  ...p,
});

/** Centro: 10,000 de venta neta − 3,000 de costo − 2,000 de gastos = 5,000. */
const base = (p: Partial<EstadoResultadosBase> = {}): EstadoResultadosBase => ({
  cuentas: 10,
  venta: '11600.00',
  ventaNeta: '10000.00',
  costo: costo(),
  gastos: '2000.00',
  compras: '4500.00',
  utilidadBruta: '7000.00',
  utilidadOperacion: '5000.00',
  margenBruto: '70.0',
  margenOperacion: '50.0',
  utilidadSobrestimada: false,
  sinVentas: false,
  ...p,
});

const sucursal = (
  nombre: string,
  p: Partial<EstadoResultadosSucursal> = {},
): EstadoResultadosSucursal => ({
  sucursalId: `id-${nombre}`,
  sucursal: nombre,
  motivo: null,
  ...base(),
  ...p,
});

/** Tijuana sin recetas: sin costo, sin utilidad, sin márgenes. */
const SIN_RECETAS: Partial<EstadoResultadosSucursal> = {
  cuentas: 5,
  venta: '5800.00',
  ventaNeta: '5000.00',
  costo: costo({ importe: null }),
  gastos: '1000.00',
  compras: '0.00',
  utilidadBruta: null,
  utilidadOperacion: null,
  margenBruto: null,
  margenOperacion: null,
  motivo: 'sin_recetas',
};

function estado(
  sucursales: EstadoResultadosSucursal[],
  total: Partial<EstadoResultados['total']> = {},
): EstadoResultados {
  return {
    sucursales,
    total: { sucursalesSinCalculo: [], ...base(), ...total },
    gastosPorCategoria: [],
  };
}

describe('TEXTO_MOTIVO y motivoSinUtilidad()', () => {
  it('cada motivo tiene su texto, y el de recetas apunta a F2-241', () => {
    expect(TEXTO_MOTIVO.sin_recetas).toContain('F2-241');
    expect(TEXTO_MOTIVO.sin_catalogo_productos).toContain('catálogo de productos');
  });

  it('con costo no hay motivo; sin costo se nombra la sucursal y el porqué', () => {
    expect(motivoSinUtilidad(sucursal('Centro'))).toBeNull();
    expect(motivoSinUtilidad(sucursal('Tijuana', SIN_RECETAS))).toBe(
      'Tijuana: sin costo de lo vendido, todavía no ha mandado recetas (llegan con el lector de ' +
        'recetas, F2-241).',
    );
    expect(
      motivoSinUtilidad(sucursal('Norte', { ...SIN_RECETAS, motivo: 'sin_catalogo_productos' })),
    ).toBe(
      'Norte: sin costo de lo vendido, su catálogo de productos nunca se ha sincronizado ' +
        'completo: lo vendido no se puede cruzar con recetas.',
    );
  });

  it('sin costo y sin motivo del API, cae al de recetas (nunca queda mudo)', () => {
    expect(motivoSinUtilidad(sucursal('Sur', { ...SIN_RECETAS, motivo: null }))).toContain(
      'todavía no ha mandado recetas',
    );
  });
});

describe('faltaDelCosto()', () => {
  it('completo o sin calcular: nada que decir', () => {
    expect(faltaDelCosto(costo())).toBeNull();
    expect(faltaDelCosto(costo({ importe: null, completo: false, insumosSinCosto: 2 }))).toBeNull();
  });

  it('en singular y plural, con la venta sin receta formateada', () => {
    expect(
      faltaDelCosto(
        costo({
          completo: false,
          insumosSinCosto: 1,
          productosSinCosto: 2,
          ventaSinCosto: '1234.5',
        }),
      ),
    ).toBe(
      '1 insumo sin costo de referencia · 2 productos vendidos sin receta ($1,234.50 en ' +
        'partidas, con IVA y antes de descuento)',
    );
    expect(
      faltaDelCosto(
        costo({
          completo: false,
          insumosSinCosto: 3,
          productosSinCosto: 1,
          ventaSinCosto: '80.00',
        }),
      ),
    ).toBe(
      '3 insumos sin costo de referencia · 1 producto vendido sin receta ($80.00 en partidas, ' +
        'con IVA y antes de descuento)',
    );
  });

  it('un importe ilegible se dice, no se vuelve $0.00', () => {
    expect(
      faltaDelCosto(costo({ completo: false, productosSinCosto: 1, ventaSinCosto: 'abc' })),
    ).toBe(
      '1 producto vendido sin receta (importe ilegible en partidas, con IVA y antes de descuento)',
    );
  });
});

describe('avisosEstado()', () => {
  it('sin nada que avisar: lista vacía', () => {
    expect(avisosEstado(estado([sucursal('Centro')]))).toEqual([]);
  });

  it('manda la bandera del API: sobrestimada sin contadores también se avisa', () => {
    expect(faltaDelCosto(costo({ completo: false }))).toBe('algo de lo vendido (sin detalle)');
    const e = estado([
      sucursal('Centro', { costo: costo({ completo: true }), utilidadSobrestimada: true }),
    ]);
    expect(avisosEstado(e)).toEqual([
      'Centro: utilidad SOBRESTIMADA (la real es menor) porque falta costo de algo de lo vendido ' +
        '(sin detalle).',
    ]);
  });

  it('en orden: sin costo, sobrestimada, sin ventas, y el total nulo', () => {
    const e = estado(
      [
        sucursal('Centro', {
          costo: costo({ completo: false, insumosSinCosto: 1 }),
          utilidadSobrestimada: true,
        }),
        sucursal('Tijuana', SIN_RECETAS),
        sucursal('Norte', {
          cuentas: 0,
          venta: '0.00',
          ventaNeta: '0.00',
          costo: costo({ importe: '0.00' }),
          gastos: '300.00',
          utilidadBruta: '0.00',
          utilidadOperacion: '-300.00',
          margenBruto: null,
          margenOperacion: null,
          sinVentas: true,
        }),
      ],
      {
        costo: costo({ importe: null }),
        utilidadBruta: null,
        utilidadOperacion: null,
        sucursalesSinCalculo: ['Tijuana'],
      },
    );
    expect(avisosEstado(e)).toEqual([
      'Tijuana: sin costo de lo vendido, todavía no ha mandado recetas (llegan con el lector de ' +
        'recetas, F2-241).',
      'Centro: utilidad SOBRESTIMADA (la real es menor) porque falta costo de 1 insumo sin costo ' +
        'de referencia.',
      'Norte: sin ventas registradas en el periodo; su utilidad es sólo −gastos. Si la sucursal ' +
        'no reportó, esa cifra no es real.',
      'El total no tiene costo ni utilidad: falta el costo de Tijuana.',
    ]);
  });

  it('sin ventas y sin gastos no se avisa (no hay −gastos que dudar)', () => {
    const e = estado([sucursal('Norte', { cuentas: 0, gastos: '0.00', sinVentas: true })]);
    expect(avisosEstado(e)).toEqual([]);
  });

  it('varias sucursales sin cálculo se listan en el aviso del total', () => {
    const e = estado([sucursal('Tijuana', SIN_RECETAS), sucursal('Norte', SIN_RECETAS)], {
      sucursalesSinCalculo: ['Tijuana', 'Norte'],
    });
    expect(avisosEstado(e).at(-1)).toBe(
      'El total no tiene costo ni utilidad: falta el costo de Tijuana, Norte.',
    );
  });
});

describe('estadoVacio()', () => {
  it('vacío sólo si no hubo cuentas NI gastos', () => {
    expect(estadoVacio(estado([], { cuentas: 0, gastos: '0.00' }))).toBe(true);
    expect(estadoVacio(estado([], { cuentas: 0, gastos: '10.00' }))).toBe(false);
    expect(estadoVacio(estado([], { cuentas: 1, gastos: '0.00' }))).toBe(false);
  });
});

describe('dineroONulo() y textoMargen()', () => {
  it('nulo es "—", nunca $0.00', () => {
    expect(dineroONulo(null)).toBe('—');
    expect(dineroONulo('0.00')).toBe('$0.00');
    expect(dineroONulo('1234.5')).toBe('$1,234.50');
    expect(dineroONulo('-50.00')).toBe('-$50.00');
    expect(dineroONulo('x')).toBe('importe ilegible');
  });

  it('margen con su signo tipográfico; nulo "—"', () => {
    expect(textoMargen('72.4')).toBe('72.4 %');
    expect(textoMargen('-3.0')).toBe('−3.0 %');
    expect(textoMargen('0.0')).toBe('0.0 %');
    expect(textoMargen(null)).toBe('—');
  });
});

describe('barrasEstado()', () => {
  it('una barra por sucursal; sin costo ni utilidad no hay barra (null), no una de 0', () => {
    const e = estado([sucursal('Centro'), sucursal('Tijuana', SIN_RECETAS)]);
    expect(barrasEstado(e)).toEqual([
      { etiqueta: 'Centro', ventaNeta: 10000, costo: 3000, gastos: 2000, utilidad: 5000 },
      { etiqueta: 'Tijuana', ventaNeta: 5000, costo: null, gastos: 1000, utilidad: null },
    ]);
  });

  it('una utilidad negativa baja de cero', () => {
    const e = estado([sucursal('Norte', { utilidadOperacion: '-300.25' })]);
    expect(barrasEstado(e)[0].utilidad).toBe(-300.25);
  });
});

describe('estadoACsv()', () => {
  it('BOM, CRLF, celdas vacías para lo nulo y la fila del total con su porqué', () => {
    const e = estado(
      [
        sucursal('Centro', {
          costo: costo({ completo: false, insumosSinCosto: 1 }),
          utilidadSobrestimada: true,
        }),
        sucursal('Tijuana', SIN_RECETAS),
      ],
      {
        cuentas: 15,
        venta: '17400.00',
        ventaNeta: '15000.00',
        costo: costo({ importe: null }),
        gastos: '3000.00',
        compras: '4500.00',
        utilidadBruta: null,
        utilidadOperacion: null,
        margenBruto: null,
        margenOperacion: null,
        sucursalesSinCalculo: ['Tijuana'],
      },
    );
    expect(estadoACsv(e)).toBe(
      BOM +
        ENCABEZADOS_ESTADO.join(',') +
        '\r\n' +
        'Centro,10,11600.00,10000.00,3000.00,no,7000.00,70.0,2000.00,5000.00,50.0,sí,4500.00,\r\n' +
        'Tijuana,5,5800.00,5000.00,,,,,1000.00,,,,0.00,' +
        '"todavía no ha mandado recetas (llegan con el lector de recetas, F2-241)"\r\n' +
        'Total,15,17400.00,15000.00,,,,,3000.00,,,,4500.00,falta el costo de Tijuana\r\n',
    );
  });

  it('los encabezados son los esperados, en orden', () => {
    expect(ENCABEZADOS_ESTADO).toEqual([
      'Sucursal',
      'Cuentas',
      'Venta con IVA',
      'Venta neta sin IVA',
      'Costo de lo vendido',
      'Costo completo',
      'Utilidad bruta',
      'Margen bruto %',
      'Gastos',
      'Utilidad de operación',
      'Margen de operación %',
      'Utilidad sobrestimada',
      'Compras (informativo)',
      'Por qué sin costo',
    ]);
  });

  it('un nombre de sucursal que parece fórmula sale como texto', () => {
    const lineas = estadoACsv(estado([sucursal('=CMD()')])).split('\r\n');
    expect(lineas[1].startsWith("'=CMD(),10,")).toBe(true);
  });

  it('un importe inválido detiene el archivo y nombra la sucursal', () => {
    const e = estado([sucursal('Centro', { venta: '12,00' })]);
    expect(() => estadoACsv(e)).toThrow(ErrorCsv);
    expect(() => estadoACsv(e)).toThrow('Centro trae un importe inválido ("12,00").');
  });
});

describe('gastosACsv()', () => {
  const g = (p: Partial<Gasto>): Gasto => ({
    id: 'g1',
    sucursalId: 's1',
    dia: '2026-09-05',
    categoriaId: 'c1',
    categoria: 'Renta',
    concepto: 'Renta de septiembre',
    monto: '15000.00',
    anulado: false,
    ...p,
  });
  const nombres: Record<string, string> = { s1: 'Centro', s2: 'Tijuana' };
  const nombre = (id: string) => nombres[id] ?? '';

  it('contenido exacto: BOM, CRLF, anulados marcados y anti-inyección', () => {
    const csv = gastosACsv(
      [
        g({}),
        g({
          id: 'g2',
          sucursalId: 's2',
          dia: '2026-09-06',
          categoria: 'Luz',
          concepto: '=HYPERLINK("x")',
          monto: '850.5',
          anulado: true,
        }),
      ],
      nombre,
    );
    expect(csv).toBe(
      BOM +
        'Día,Sucursal,Categoría,Concepto,Monto sin IVA,Anulado\r\n' +
        '2026-09-05,Centro,Renta,Renta de septiembre,15000.00,no\r\n' +
        '2026-09-06,Tijuana,Luz,"\'=HYPERLINK(""x"")",850.50,sí\r\n',
    );
    expect(ENCABEZADOS_GASTOS).toHaveLength(6);
  });

  it('sin gastos: sólo el encabezado', () => {
    expect(gastosACsv([], nombre)).toBe(
      `${BOM}Día,Sucursal,Categoría,Concepto,Monto sin IVA,Anulado\r\n`,
    );
  });

  it('un monto inválido detiene el archivo', () => {
    expect(() => gastosACsv([g({ monto: 'abc' })], nombre)).toThrow(
      'El gasto Renta de septiembre trae un importe inválido ("abc").',
    );
  });
});

describe('comprasACsv()', () => {
  const c = (p: Partial<CompraResumen>): CompraResumen => ({
    id: 'c1',
    sucursalId: 's1',
    folio: '000123',
    fecha: '2026-09-10T16:30:00Z',
    proveedorOrigenSrId: 'P1',
    proveedor: 'Carnes del Norte',
    almacenOrigenSrId: 'A1',
    almacen: 'General',
    total: '1000.00',
    partidas: 2,
    cancelada: false,
    ...p,
  });
  const nombre = (id: string) => (id === 's1' ? 'Centro' : 'Tijuana');

  it('folio como texto de Excel, catálogo faltante por id, sin fecha vacía y canceladas marcadas', () => {
    const csv = comprasACsv(
      [
        c({}),
        c({
          id: 'c2',
          sucursalId: 's2',
          folio: '9',
          proveedor: null,
          proveedorOrigenSrId: 'P9',
          almacen: null,
          almacenOrigenSrId: null,
          total: '200.5',
          partidas: 1,
          cancelada: true,
        }),
        c({ id: 'c3', folio: '10', proveedor: '@Proveedor', total: '1.00', partidas: 1 }),
      ],
      nombre,
      (x) => (x.id === 'c2' ? null : { fecha: '2026-09-10', hora: '10:30' }),
    );
    expect(csv).toBe(
      BOM +
        'Fecha,Hora,Sucursal,Folio,Proveedor,Almacén,Partidas,Total sin IVA,Cancelada\r\n' +
        '2026-09-10,10:30,Centro,"=""000123""",Carnes del Norte,General,2,1000.00,no\r\n' +
        ',,Tijuana,"=""9""",P9,,1,200.50,sí\r\n' +
        '2026-09-10,10:30,Centro,"=""10""",\'@Proveedor,General,1,1.00,no\r\n',
    );
    expect(ENCABEZADOS_COMPRAS).toHaveLength(9);
  });

  it('un total inválido detiene el archivo y nombra el folio', () => {
    expect(() => comprasACsv([c({ total: '1.234' })], nombre, () => null)).toThrow(
      'La compra 000123 trae un importe inválido ("1.234").',
    );
  });
});

describe('vacioCompras() y sucursalesSinCompras()', () => {
  const datos = (recibidas: number[], hayCompras: boolean): Compras => ({
    sucursales: recibidas.map((n, i) => ({
      sucursalId: `s${i}`,
      sucursal: ['Centro', 'Tijuana', 'Norte'][i],
      comprasRecibidas: n,
    })),
    porProveedor: [],
    compras: hayCompras
      ? [
          {
            id: 'c1',
            sucursalId: 's0',
            folio: '1',
            fecha: '2026-09-10T16:30:00Z',
            proveedorOrigenSrId: null,
            proveedor: null,
            almacenOrigenSrId: null,
            almacen: null,
            total: '10.00',
            partidas: 1,
            cancelada: false,
          },
        ]
      : [],
    totalCompras: hayCompras ? 1 : 0,
    truncado: false,
    total: hayCompras ? '10.00' : '0.00',
  });

  it('con compras no hay estado vacío', () => {
    expect(vacioCompras(datos([3, 0], true))).toBeNull();
  });

  it('ninguna sucursal mandó compras: el agente, no el negocio', () => {
    const v = vacioCompras(datos([0, 0], false));
    expect(v?.tipo).toBe('sin-lector');
    expect(v?.texto).toContain('F2-241');
    expect(v?.texto).toContain('no significa que no se haya comprado');
  });

  it('alguna sí las manda pero el periodo no tiene: vacío del periodo', () => {
    expect(vacioCompras(datos([3, 0], false))).toEqual({
      tipo: 'periodo',
      texto:
        'Sin compras registradas en SoftRestaurant en este periodo: elige otro en la cabecera.',
    });
  });

  it('sólo se señalan las que no mandan cuando otras sí', () => {
    expect(sucursalesSinCompras(datos([3, 0, 0], true))).toEqual(['Tijuana', 'Norte']);
    expect(sucursalesSinCompras(datos([3, 1], true))).toEqual([]);
    // Si ninguna manda, lo dice el estado vacío, no esta lista.
    expect(sucursalesSinCompras(datos([0, 0], false))).toEqual([]);
  });
});

describe('erroresGasto()', () => {
  const HOY = '2026-09-22';
  const ok: FormGasto = {
    sucursalId: 's1',
    categoriaId: 'c1',
    dia: '2026-09-22',
    concepto: 'Gas',
    monto: '1250.50',
  };

  it('un formulario completo, con el día de hoy, no tiene errores', () => {
    expect(erroresGasto(ok, HOY)).toEqual([]);
    expect(erroresGasto({ ...ok, monto: ' 12.5 ', concepto: '  Gas  ' }, HOY)).toEqual([]);
  });

  it('vacío: un error por campo, en orden', () => {
    expect(
      erroresGasto({ sucursalId: '', categoriaId: '', dia: '', concepto: '', monto: '' }, HOY),
    ).toEqual([
      'Elige la sucursal.',
      'Elige la categoría.',
      'Elige el día del gasto.',
      'Escribe el concepto.',
      'El monto es un importe positivo con hasta 2 decimales (sin $ ni comas).',
    ]);
  });

  it('el día no puede ser futuro', () => {
    expect(erroresGasto({ ...ok, dia: '2026-09-23' }, HOY)).toEqual([
      'El día del gasto no puede ser posterior a hoy.',
    ]);
    expect(erroresGasto({ ...ok, dia: '22/09/2026' }, HOY)).toEqual(['Elige el día del gasto.']);
  });

  it('el concepto: no sólo espacios, hasta 200 caracteres', () => {
    expect(erroresGasto({ ...ok, concepto: '   ' }, HOY)).toEqual(['Escribe el concepto.']);
    expect(erroresGasto({ ...ok, concepto: 'x'.repeat(200) }, HOY)).toEqual([]);
    expect(erroresGasto({ ...ok, concepto: 'x'.repeat(201) }, HOY)).toEqual([
      'El concepto va de 1 a 200 caracteres.',
    ]);
  });

  it('el monto es mayor que cero, sin signo, $, comas ni más de 2 decimales', () => {
    const formato = 'El monto es un importe positivo con hasta 2 decimales (sin $ ni comas).';
    expect(erroresGasto({ ...ok, monto: '0' }, HOY)).toEqual([
      'El monto tiene que ser mayor que cero.',
    ]);
    expect(erroresGasto({ ...ok, monto: '0.00' }, HOY)).toEqual([
      'El monto tiene que ser mayor que cero.',
    ]);
    for (const m of ['-5', '$100', '1,200.00', '12.345', 'abc', '.5']) {
      expect(erroresGasto({ ...ok, monto: m }, HOY)).toEqual([formato]);
    }
    expect(erroresGasto({ ...ok, monto: '0.01' }, HOY)).toEqual([]);
  });
});
