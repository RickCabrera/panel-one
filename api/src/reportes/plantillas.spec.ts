import type { Resumen, VentaSucursal } from '../ventas/agregados-ventas.service';
import { periodoDiario, periodoSemanal } from './calendario';
import { comparar, diasSemanales, filasSemanales, type ContenidoDiario } from './contenido';
import { escaparHtml, fechaLarga, formatoEntero, formatoPesos } from './formato';
import { renderizar, SIN_VENTAS } from './plantillas';

function resumen(venta: string, cuentas: number): Resumen {
  return {
    venta,
    cuentas,
    ticketPromedio: cuentas === 0 ? null : venta,
    subtotal: venta,
    impuestos: '0.00',
    propina: '0.00',
    descuentos: { monto: '0.00', cuentas: 0 },
    cortesias: null,
    comensales: { total: 0, cuentasConDato: 0, promedioPorComensal: null },
    cancelados: { cuentas: 0 },
  };
}

function suc(id: string, nombre: string, venta: string, cuentas: number): VentaSucursal {
  return {
    sucursalId: id,
    nombre,
    venta,
    cuentas,
    ticketPromedio: cuentas === 0 ? null : venta,
    comensales: 0,
  };
}

const EMPRESA = { id: 'e', nombre: 'Tacos <b>& "Co"</b>', zona: 'America/Mexico_City' };
const ENLACES = {
  panel: 'http://localhost:5173/resumen?empresa=e&periodo=rango&desde=2026-09-21&hasta=2026-09-21',
  baja: 'http://localhost:5173/reportes/baja?t=abc.def&tipo=diario',
};

function diario(parcial: Partial<ContenidoDiario> = {}): ContenidoDiario {
  return {
    tipo: 'diario',
    empresa: EMPRESA,
    periodo: periodoDiario('2026-09-22'),
    resumen: resumen('12345.60', 3),
    sucursales: [suc('a', 'Centro', '12345.60', 3), suc('b', 'Norte <script>', '0.00', 0)],
    top: [{ producto: 'Taco <al> pastor', importe: '1000.00', cantidad: '10.000' }],
    alertas: {
      abiertas: [{ tipo: 'mesa_abierta', cuentas: 2 }],
      ultimas24h: [
        { tipo: 'mesa_abierta', cuentas: 3 },
        { tipo: 'sucursal_sin_reporte', cuentas: 1 },
      ],
    },
    ...parcial,
  };
}

describe('formato (F2-141)', () => {
  it('pesos sobre el texto decimal, sin float', () => {
    expect(formatoPesos('0.10')).toBe('$0.10');
    expect(formatoPesos('1234567.89')).toBe('$1,234,567.89');
    expect(formatoPesos('-5.00')).toBe('-$5.00');
    // 0.1 + 0.2 no aparece: el texto se agrupa tal cual llega.
    expect(formatoPesos('9007199254740993.01')).toBe('$9,007,199,254,740,993.01');
    expect(() => formatoPesos('12.3')).toThrow(/formato/);
    expect(() => formatoPesos('1e3')).toThrow(/formato/);
  });

  it('enteros, escape y fechas en español', () => {
    expect(formatoEntero(1234)).toBe('1,234');
    expect(escaparHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
    expect(fechaLarga('2026-09-21')).toBe('lunes 21 de septiembre de 2026');
  });
});

describe('comparación semanal (F2-141)', () => {
  it('diferencia y % con Decimal, a 2 decimales', () => {
    expect(comparar({ venta: '150.00', cuentas: 3 }, { venta: '100.00', cuentas: 2 })).toEqual({
      diferencia: '50.00',
      variacionPct: '50.00',
    });
    expect(comparar({ venta: '100.00', cuentas: 1 }, { venta: '300.00', cuentas: 1 })).toEqual({
      diferencia: '-200.00',
      variacionPct: '-66.67',
    });
  });

  it('sin cuentas en alguno de los dos lados: "—", no −100 % ni +∞', () => {
    expect(comparar({ venta: '0.00', cuentas: 0 }, { venta: '100.00', cuentas: 2 })).toEqual({
      diferencia: null,
      variacionPct: null,
    });
    expect(comparar({ venta: '100.00', cuentas: 2 }, { venta: '0.00', cuentas: 0 })).toEqual({
      diferencia: null,
      variacionPct: null,
    });
    expect(comparar({ venta: '100.00', cuentas: 2 }, null).variacionPct).toBeNull();
    // Base con cuentas pero venta 0.00 (todas en cero): diferencia sí, % no.
    expect(comparar({ venta: '10.00', cuentas: 1 }, { venta: '0.00', cuentas: 1 })).toEqual({
      diferencia: '10.00',
      variacionPct: null,
    });
  });

  it('empareja sucursales por id y días en orden', () => {
    const filas = filasSemanales(
      [suc('a', 'A', '10.00', 1), suc('b', 'B', '5.00', 1)],
      [suc('b', 'B', '10.00', 1)],
    );
    expect(filas.map((f) => [f.sucursalId, f.anterior?.venta ?? null, f.variacionPct])).toEqual([
      ['a', null, null],
      ['b', '10.00', '-50.00'],
    ]);
    expect(() => diasSemanales([{ dia: 'x', venta: '0.00', cuentas: 0 }], [])).toThrow();
  });
});

describe('plantillas (F2-141)', () => {
  it('el diario escapa todo texto de datos', () => {
    const { html, asunto } = renderizar(diario(), ENLACES);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>&');
    expect(html).toContain('Norte &lt;script&gt;');
    expect(html).toContain('Taco &lt;al&gt; pastor');
    expect(html).toContain('Tacos &lt;b&gt;&amp; &quot;Co&quot;&lt;/b&gt;');
    expect(asunto).toBe('Resumen del lunes 21 de septiembre de 2026 · Tacos <b>& "Co"</b>');
  });

  it('una sucursal sin cuentas dice "Sin ventas registradas", no $0.00', () => {
    const { html, texto } = renderizar(diario(), ENLACES);
    expect(html).toContain(SIN_VENTAS);
    expect(html).not.toContain('$0.00');
    expect(texto).toContain(`Norte <script>: ${SIN_VENTAS}`);
    expect(html).toContain('$12,345.60');
  });

  it('una empresa sin ventas ayer lo dice, sin inventar un total', () => {
    const { html } = renderizar(
      diario({ resumen: resumen('0.00', 0), sucursales: [suc('a', 'Centro', '0.00', 0)], top: [] }),
      ENLACES,
    );
    expect(html).toContain(`${SIN_VENTAS} ayer`);
    expect(html).not.toContain('Venta total');
    expect(html).not.toContain('$0.00');
  });

  it('alertas: abiertas ahora y de las últimas 24 h, en palabras', () => {
    const { html } = renderizar(diario(), ENLACES);
    expect(html).toContain('2 abiertas ahora');
    expect(html).toContain('Mesa abierta mucho tiempo: 2');
    expect(html).toContain('4 en las últimas 24 horas');
    const sinAlertas = renderizar(diario({ alertas: { abiertas: [], ultimas24h: [] } }), ENLACES);
    expect(sinAlertas.html).toContain('Ninguna alerta abierta ahora.');
  });

  it('lleva el enlace al panel y el de baja (escapados); sin baja en la vista previa', () => {
    const { html, texto } = renderizar(diario(), ENLACES);
    expect(html).toContain('href="http://localhost:5173/resumen?empresa=e&amp;periodo=rango');
    expect(html).toContain('href="http://localhost:5173/reportes/baja?t=abc.def&amp;tipo=diario"');
    expect(texto).toContain(`Dejar de recibir este reporte: ${ENLACES.baja}`);
    const previa = renderizar(diario(), { ...ENLACES, baja: null });
    expect(previa.html).not.toContain('/reportes/baja');
    expect(previa.texto).not.toContain('Dejar de recibir');
  });

  it('el semanal muestra Δ con signo y "—" donde no hay base', () => {
    const periodo = periodoSemanal('2026-09-21');
    const actual = [suc('a', 'Centro', '150.00', 3), suc('b', 'Norte', '80.00', 2)];
    const anterior = [suc('a', 'Centro', '100.00', 2), suc('b', 'Norte', '0.00', 0)];
    const r = resumen('230.00', 5);
    const rAnt = resumen('100.00', 2);
    const { html, asunto, nombre } = renderizar(
      {
        tipo: 'semanal',
        empresa: { ...EMPRESA, nombre: 'Demo' },
        periodo,
        anterior: { desde: '2026-09-07', hasta: '2026-09-13' },
        resumen: r,
        resumenAnterior: rAnt,
        ...comparar(r, rAnt),
        sucursales: filasSemanales(actual, anterior),
        dias: diasSemanales(
          [{ dia: '2026-09-14', venta: '230.00', cuentas: 5 }],
          [{ dia: '2026-09-07', venta: '0.00', cuentas: 0 }],
        ),
      },
      ENLACES,
    );
    expect(nombre).toBe('reporte-semanal');
    expect(asunto).toBe('Resumen semanal del 14 sep al 20 sep · Demo');
    expect(html).toContain('+$50.00');
    expect(html).toContain('+50.00 %');
    expect(html).toContain('+130.00 %');
    // Norte no tuvo cuentas la semana anterior: ni −100 % ni +∞.
    expect(html).toMatch(/Norte<\/td>.*?Sin ventas registradas.*?—.*?—/);
    expect(html).not.toContain('$0.00');
  });
});
