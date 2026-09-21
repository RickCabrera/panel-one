import { describe, expect, it } from 'vitest';

import { SUCURSAL_A2 } from '../../test/apiFalsa';
import { BOM, ENCABEZADOS, ErrorCsv, nombreArchivo, ticketsACsv } from './csv';
import { SUCURSALES, ticket } from './fixtures';

/** Filas sin el BOM y sin el CRLF final. */
function filas(csv: string): string[] {
  return csv.slice(BOM.length).replace(/\r\n$/, '').split('\r\n');
}

describe('ticketsACsv', () => {
  it('empieza con BOM UTF-8 y usa CRLF, también al final', () => {
    const csv = ticketsACsv([ticket()], SUCURSALES);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect([...new TextEncoder().encode(csv).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('una fila por ticket, con los encabezados y los datos exactos', () => {
    const [encabezado, fila] = filas(ticketsACsv([ticket()], SUCURSALES));
    expect(encabezado).toBe(ENCABEZADOS.join(','));
    expect(fila).toBe(
      'Centro,1001,2026-09-20,21:30,5,Juan Pérez,3,1000.00,160.00,0.00,50.00,1160.00,EFECTIVO + TARJETA DE CREDITO,No',
    );
  });

  it('la fecha y la hora son las de la zona de CADA sucursal, en ISO', () => {
    const csv = ticketsACsv(
      [ticket(), ticket({ id: 'x2', sucursalId: SUCURSAL_A2.id, folio: 'T1' })],
      SUCURSALES,
    );
    const [, centro, tijuana] = filas(csv);
    expect(centro).toContain(',2026-09-20,21:30,');
    // El mismo instante, una hora antes en Tijuana. En UTC sería el 21 a las 03:30.
    expect(tijuana).toMatch(/^Tijuana,T1,2026-09-20,20:30,/);
  });

  it('un cancelado sin cierre usa la apertura y se marca, sin fila de totales', () => {
    const csv = ticketsACsv(
      [ticket({ cancelado: true, cerradoAt: null, abiertoAt: '2026-09-20T18:05:00.000Z' })],
      SUCURSALES,
    );
    const lineas = filas(csv);
    expect(lineas).toHaveLength(2);
    expect(lineas[1]).toMatch(/^Centro,1001,2026-09-20,12:05,.*,Sí$/);
  });

  it('los nulos quedan vacíos', () => {
    const [, fila] = filas(
      ticketsACsv([ticket({ mesa: null, mesero: null, comensales: null, pagos: [] })], SUCURSALES),
    );
    expect(fila).toBe('Centro,1001,2026-09-20,21:30,,,,1000.00,160.00,0.00,50.00,1160.00,,No');
  });

  it('entrecomilla comas, comillas y saltos de línea, y dobla las comillas', () => {
    const [, fila] = filas(
      ticketsACsv([ticket({ mesero: 'Pérez, "El Güero"\nturno 2', mesa: 'Terraza' })], SUCURSALES),
    );
    expect(fila).toContain(',Terraza,"Pérez, ""El Güero""\nturno 2",3,');
  });

  it('neutraliza fórmulas en los textos de SR (inyección CSV)', () => {
    const [, fila] = filas(
      ticketsACsv(
        [
          ticket({
            mesero: '=HYPERLINK("http://x","y")',
            mesa: '+1',
            folio: '-5',
            pagos: [{ formaRaw: '@SUM(A1)', forma: 'otro', monto: '1.00' }],
          }),
        ],
        SUCURSALES,
      ),
    );
    expect(fila).toContain(`,'-5,`);
    expect(fila).toContain(`,'+1,"'=HYPERLINK(""http://x"",""y"")",`);
    expect(fila).toContain(`,'@SUM(A1),`);
  });

  it('los importes van como número: negativos con "-", sin $ ni miles', () => {
    const [, fila] = filas(
      ticketsACsv([ticket({ descuentos: '-12.5', total: '1234567.89' })], SUCURSALES),
    );
    expect(fila).toContain(',-12.50,50.00,1234567.89,');
    expect(fila).not.toContain('$');
  });

  it('un importe inválido detiene el export en vez de escribir basura', () => {
    expect(() => ticketsACsv([ticket({ total: '12,00' })], SUCURSALES)).toThrow(ErrorCsv);
    expect(() => ticketsACsv([ticket({ propina: '1e3' })], SUCURSALES)).toThrow(/1001/);
  });

  it('un ticket de una sucursal que no está en la lista detiene el export', () => {
    expect(() => ticketsACsv([ticket({ sucursalId: 'otra' })], SUCURSALES)).toThrow(ErrorCsv);
  });

  it('sin tickets queda sólo el encabezado', () => {
    expect(ticketsACsv([], SUCURSALES)).toBe(`${BOM}${ENCABEZADOS.join(',')}\r\n`);
  });
});

describe('nombreArchivo', () => {
  it('lleva el rango y, si hay, la sucursal sin acentos', () => {
    expect(nombreArchivo('2026-09-01', '2026-09-20')).toBe('tickets_2026-09-01_2026-09-20.csv');
    expect(nombreArchivo('2026-09-01', '2026-09-20', 'Plaza Ñuñoa / Centro')).toBe(
      'tickets_2026-09-01_2026-09-20_plaza-nunoa-centro.csv',
    );
  });
});
