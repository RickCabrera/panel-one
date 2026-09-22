import { describe, expect, it } from 'vitest';

import type { FilaResumenCliente } from '../../api/tipos';
import { clientesACsv, ENCABEZADOS_CLIENTES, ENCABEZADOS_CONTACTO, nombreCsvClientes } from './csv';

// El CSV de Clientes (F2-232): sin datos personales salvo que se pidan.

const fila = (p: Partial<FilaResumenCliente> = {}): FilaResumenCliente => ({
  id: 'c1',
  sucursalId: 's1',
  sucursal: 'Centro',
  cruce: 'ficha',
  origenSrId: 'SR-17',
  clave: 'C001',
  nombre: 'Ana Cliente',
  activo: true,
  activoPos: null,
  visitas: 3,
  venta: '183.34',
  ticketPromedio: '61.11',
  ultimaVisita: '2026-09-11T05:30:00.000Z',
  canceladas: { cuentas: 1, monto: '80.00' },
  telefono: '555-010-9901',
  correo: 'ana@ejemplo.test',
  rfc: 'XAXX010101000',
  ...p,
});

const lineas = (csv: string) => csv.replace(/^\uFEFF/, '').split('\r\n');

describe('clientesACsv (F2-232)', () => {
  it('sin `contacto`: ni nombre, ni teléfono, ni correo, ni RFC, aunque la fila los traiga', () => {
    const csv = clientesACsv([fila()], false);
    expect(csv).not.toMatch(/Ana Cliente|555-010|ejemplo\.test|XAXX/);
    const [enc, uno] = lineas(csv);
    expect(enc).toBe(ENCABEZADOS_CLIENTES.join(','));
    expect(uno).toBe(
      'Centro,C001,SR-17,En el catálogo,3,183.34,61.11,2026-09-11T05:30:00.000Z,1,80.00',
    );
  });

  it('con `contacto`: agrega las cuatro columnas al final', () => {
    const [enc, uno] = lineas(clientesACsv([fila()], true));
    expect(enc).toBe([...ENCABEZADOS_CLIENTES, ...ENCABEZADOS_CONTACTO].join(','));
    expect(uno.endsWith(',Ana Cliente,555-010-9901,ana@ejemplo.test,XAXX010101000')).toBe(true);
  });

  it('sin ficha: clave vacía, id del POS, sin ticket si no hay visitas; anti-inyección', () => {
    const csv = clientesACsv(
      [
        fila({
          id: null,
          cruce: 'sin-ficha',
          clave: null,
          nombre: null,
          origenSrId: '=HYPERLINK("x")',
          visitas: 0,
          venta: '0.00',
          ticketPromedio: null,
          ultimaVisita: null,
        }),
      ],
      false,
    );
    const [, uno] = lineas(csv);
    expect(uno).toContain(`'=HYPERLINK`);
    expect(uno).toContain('Sin ficha en el catálogo,0,0.00,,,1,80.00');
  });

  it('un importe ilegible detiene el archivo', () => {
    expect(() => clientesACsv([fila({ venta: '12,5' })], false)).toThrow(/importe inválido/);
  });

  it('nombre del archivo', () => {
    expect(nombreCsvClientes({ desde: '2026-08-01', hasta: '2026-08-31' })).toBe(
      'clientes_2026-08-01_2026-08-31.csv',
    );
  });
});
