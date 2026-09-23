import { describe, expect, it } from 'vitest';

import { BOM, ErrorCsv } from '../../csv/csv';
import { comparativosACsv, ENCABEZADOS_COMPARATIVOS, nombreCsvComparativos } from './csv';
import {
  ordenar,
  sinTasa,
  sinUtilidad,
  TASA_SIN_LECTURA,
  UTILIDAD_SIN_COSTO,
  type Cifras,
  type FilaComparada,
  type TasaFacturacion,
  type Utilidad,
} from './matriz';

const cif = (
  venta: string,
  cuentas: number,
  ticket: string | null,
  comensales: number,
  utilidad: Utilidad = sinUtilidad(UTILIDAD_SIN_COSTO),
  tasa: TasaFacturacion = sinTasa(TASA_SIN_LECTURA),
): Cifras => ({
  venta,
  cuentas,
  ticketPromedio: ticket,
  comensales,
  utilidad,
  tasa,
});
const util = (importe: string, sobrestimada = false): Utilidad => ({
  importe,
  razon: null,
  sobrestimada,
});
const fila = (id: string, nombre: string, a: Cifras | null, b: Cifras | null): FilaComparada => ({
  id,
  nombre,
  a,
  b,
});

const lineas = (csv: string) => csv.slice(BOM.length).split('\r\n');

describe('comparativosACsv', () => {
  it('encabezado fijo: posición, sucursal y A, B, Δ, Δ % por métrica', () => {
    expect(ENCABEZADOS_COMPARATIVOS).toEqual([
      'Posición',
      'Sucursal',
      'Venta A',
      'Venta B',
      'Δ Venta',
      'Δ Venta %',
      'Tickets A',
      'Tickets B',
      'Δ Tickets',
      'Δ Tickets %',
      'Ticket promedio A',
      'Ticket promedio B',
      'Δ Ticket promedio',
      'Δ Ticket promedio %',
      'Comensales A',
      'Comensales B',
      'Δ Comensales',
      'Δ Comensales %',
      'Utilidad A',
      'Utilidad B',
      'Δ Utilidad',
      'Δ Utilidad %',
      'Tasa de facturación A',
      'Tasa de facturación B',
      'Δ Tasa de facturación',
      'Δ Tasa de facturación %',
    ]);
  });

  it('contenido exacto: orden del ranking, vacíos en vez de 0, Δ % sin "%", signo sólo negativo', () => {
    const filas = ordenar(
      [
        fila('1', 'Centro', cif('1100.00', 11, '100.00', 20), cif('1000.00', 8, '125.00', 20)),
        fila('2', '=Norte', cif('0.00', 0, null, 0), cif('500.00', 5, '100.00', 0)),
        fila('3', 'Sur', cif('900.00', 9, '100.00', 0), cif('1000.00', 10, '100.00', 10)),
      ],
      'deltaVenta',
    );
    const csv = comparativosACsv(filas);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(lineas(csv)).toEqual([
      ENCABEZADOS_COMPARATIVOS.join(','),
      // Utilidad sin costo y tasa sin lectura en los dos periodos: sus celdas vacías, nunca 0.
      '1,Centro,1100.00,1000.00,100.00,10.0,11,8,3,37.5,100.00,125.00,-25.00,-20.0,20,20,0,0.0,,,,,,,,',
      '2,Sur,900.00,1000.00,-100.00,-10.0,9,10,-1,-10.0,100.00,100.00,0.00,0.0,0,10,-10,-100.0,,,,,,,,',
      // Sin cuentas en A: celdas de A y todos los Δ vacíos, sin posición; el nombre que empieza
      // como fórmula se neutraliza.
      ",'=Norte,,500.00,,,,5,,,,100.00,,,,0,,,,,,,,,,",
      '',
    ]);
  });

  it('utilidad (F2-126): la del API; nula = celda vacía (nunca 0), base ≤ 0 = sin Δ', () => {
    const c = (u?: Utilidad) => cif('10.00', 1, '10.00', 1, u);
    const filas = ordenar(
      [
        // Sobrestimada: el CSV lleva la cifra (la salvedad se ve en pantalla).
        fila('1', 'Centro', c(util('250.00', true)), c(util('200.00'))),
        // Sin costo en A: A vacío y sin Δ.
        fila('2', 'Norte', c(), c(util('100.00'))),
        // Base negativa: A y B con cifra, sin Δ.
        fila('3', 'Sur', c(util('-5.50')), c(util('-10.00'))),
      ],
      'utilidad',
    );
    const utilidades = lineas(comparativosACsv(filas))
      .slice(1, 4)
      .map((l) => l.split(',').slice(-8, -4).join(','));
    expect(utilidades).toEqual(['250.00,200.00,50.00,25.0', '-5.50,-10.00,,', ',100.00,,']);
  });

  it('tasa de facturación (F2-106): en %, Δ en puntos y Δ % exactos (sin float), nula = vacía', () => {
    const t = (valor: string | null): TasaFacturacion =>
      valor === null ? sinTasa('Sin venta en el periodo.') : { valor, razon: null };
    const c = (tasa: TasaFacturacion) => cif('10.00', 1, '10.00', 1, undefined, tasa);
    const filas = ordenar(
      [
        fila('1', 'Centro', c(t('0.6898')), c(t('0.6773'))),
        // Borde de redondeo: +0.01 pp sobre 20 % = +0.05 % exacto → "0.1" (mitad lejos de cero).
        fila('2', 'Norte', c(t('0.2001')), c(t('0.2000'))),
        // Sin venta en B: B vacío y sin Δ.
        fila('3', 'Sur', c(t('1.2500')), c(t(null))),
      ],
      'tasaFacturacion',
    );
    const tasas = lineas(comparativosACsv(filas))
      .slice(1, 4)
      .map((l) => l.split(',').slice(-4).join(','));
    expect(tasas).toEqual(['125.00,,,', '68.98,67.73,1.25,1.8', '20.01,20.00,0.01,0.1']);
  });

  it('un importe ilegible detiene el archivo con un mensaje claro', () => {
    const filas = ordenar([fila('1', 'Centro', cif('x', 1, null, 0), null)], 'venta');
    expect(() => comparativosACsv(filas)).toThrow(ErrorCsv);
    expect(() => comparativosACsv(filas)).toThrow('La sucursal Centro trae un importe inválido');
  });
});

describe('nombreCsvComparativos', () => {
  it('lleva los rangos de A y de B y la sucursal saneada', () => {
    const a = { desde: '2026-09-01', hasta: '2026-09-21' };
    const b = { desde: '2026-08-01', hasta: '2026-08-31' };
    expect(nombreCsvComparativos(a, b)).toBe(
      'comparativos_2026-09-01_2026-09-21_vs_2026-08-01_2026-08-31.csv',
    );
    expect(nombreCsvComparativos(a, b, 'Plaza Ñú / Centro')).toBe(
      'comparativos_2026-09-01_2026-09-21_vs_2026-08-01_2026-08-31_plaza-nu-centro.csv',
    );
  });

  it('una fecha que no es YYYY-MM-DD no llega al nombre', () => {
    expect(() =>
      nombreCsvComparativos(
        { desde: '2026-09-01', hasta: '../x' },
        { desde: '2026-08-01', hasta: '2026-08-31' },
      ),
    ).toThrow(ErrorCsv);
  });
});
