import { BadRequestException } from '@nestjs/common';

import { Reloj } from '../comun/reloj';
import type { EmpresaScope } from '../scope/empresa-scope';
import type { ScopedPrismaService } from '../scope/scoped-prisma.service';
import type { AgregadosVentasService } from './agregados-ventas.service';
import {
  ordenSql,
  TicketsService,
  type Direccion,
  type OpcionesTickets,
  type OrdenTickets,
} from './tickets.service';

// Lista blanca del orden (F2-222): el request sólo ELIGE una llave; el servicio no se fía del
// DTO y truena con cualquier otra cosa, aunque alguien lo llame saltándose el ValidationPipe.

describe('ordenSql()', () => {
  it.each([
    ['momento', 'desc', 'ORDER BY momento DESC NULLS LAST, id DESC'],
    [
      'folio',
      'asc',
      'ORDER BY length(folio) ASC NULLS LAST, folio COLLATE ucs_basic ASC NULLS LAST, id ASC',
    ],
    ['mesero', 'asc', 'ORDER BY mesero COLLATE ucs_basic ASC NULLS LAST, id ASC'],
    ['duracion', 'desc', 'ORDER BY (cerrado_at - abierto_at) DESC NULLS LAST, id DESC'],
  ] as const)('%s %s → SQL fijo', (orden, dir, esperado) => {
    const sql = ordenSql(orden, dir);
    expect(sql.sql).toBe(esperado);
    expect(sql.values).toEqual([]);
  });

  it.each([
    ['orden inventado', 'id; DROP TABLE cheques', 'asc'],
    ['columna real fuera de la lista', 'recibido_at', 'asc'],
    ['llave heredada de Object', 'constructor', 'asc'],
    ['__proto__', '__proto__', 'desc'],
    ['dir inventada', 'total', 'asc; --'],
    ['dir en mayúsculas', 'total', 'ASC'],
  ])('%s: truena', (_caso, orden, dir) => {
    expect(() => ordenSql(orden as OrdenTickets, dir as Direccion)).toThrow(/lista blanca/);
  });
});

describe('TicketsService.listar(): importes', () => {
  // Antes de cualquier consulta: ni el alcance se llega a consultar.
  const consulta = jest.fn();
  const servicio = new TicketsService(
    { consulta } as unknown as AgregadosVentasService,
    {} as ScopedPrismaService,
    new Reloj(),
  );
  const scope: EmpresaScope = { tipo: 'global' };
  const filtro = {
    empresaId: '00000000-0000-4000-8000-000000000001',
    desde: '2026-09-01',
    hasta: '2026-09-02',
  };
  const listar = (o: Partial<OpcionesTickets>) =>
    servicio.listar(scope, filtro, { pagina: 1, porPagina: 50, ...o });

  beforeEach(() => consulta.mockReset());

  it.each([
    ['min > max', { importeMin: '200', importeMax: '100' }],
    ['min > max por un centavo', { importeMin: '100.01', importeMax: '100.00' }],
    ['importe mal formado (sin pasar por el DTO)', { importeMin: '1e3' }],
  ])('%s → 400 sin consultar', async (_caso, o) => {
    await expect(listar(o)).rejects.toBeInstanceOf(BadRequestException);
    expect(consulta).not.toHaveBeenCalled();
  });

  it('orden fuera de lista (sin pasar por el DTO) truena sin consultar', async () => {
    await expect(listar({ orden: 'x' as OrdenTickets })).rejects.toThrow(/lista blanca/);
    expect(consulta).not.toHaveBeenCalled();
  });
});
