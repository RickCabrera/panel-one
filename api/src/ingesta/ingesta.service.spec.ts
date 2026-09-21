import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import { crearFixtures, FX, limpiarFixtures } from '../../test/fixtures-auth';
import { Reloj } from '../comun/reloj';
import type { PrismaService } from '../prisma/prisma.service';
import { OperacionesSucursal } from '../scope/escritura-sucursal';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { esTransitorio, IngestaService } from './ingesta.service';

// Qué pasa cuando la BASE falla a media ingesta (F1-031), contra Postgres real:
// el evento que falló se rechaza solo, con `reintentable` según si la falla es
// transitoria o determinista, y los demás del lote se guardan.

const A1 = { sucursalId: FX.sucursalA1, empresaId: FX.empresaA };

function errorPrisma(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`falla sintética ${code}`, {
    code,
    clientVersion: Prisma.prismaVersion.client,
  });
}

function cheque(id: string, folioSr: string) {
  return {
    id,
    tipo: 'cheque',
    datos: {
      folioSr,
      folio: folioSr,
      abiertoAt: '2026-09-20T19:00:00Z',
      subtotal: '10.00',
      impuestos: '0',
      descuentos: '0',
      propina: '0',
      total: '10.00',
      cancelado: false,
      partidas: [],
      pagos: [],
    },
  };
}

describe('esTransitorio()', () => {
  it.each(['P1001', 'P1002', 'P1008', 'P1017', 'P2002', 'P2024', 'P2028', 'P2034'])(
    '%s es transitorio: se puede reenviar',
    (code) => {
      expect(esTransitorio(errorPrisma(code))).toBe(true);
    },
  );

  it.each(['P2000', 'P2003', 'P2010', 'P2025'])('%s es determinista: no se reintenta', (code) => {
    expect(esTransitorio(errorPrisma(code))).toBe(false);
  });

  it('un error que no es de Prisma (un bug nuestro) no se reintenta', () => {
    expect(esTransitorio(new Error('bug'))).toBe(false);
    expect(esTransitorio('texto')).toBe(false);
  });
});

describe('IngestaService, fallas de base (contra Postgres, F1-031)', () => {
  const prisma = new PrismaClient();
  const servicio = new IngestaService(
    new ScopedPrismaService(prisma as unknown as PrismaService),
    new Reloj(),
  );

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  it.each([
    ['transitoria (P1001, base inalcanzable)', errorPrisma('P1001'), true],
    ['transitoria (P2002, choque con otro lote en vuelo)', errorPrisma('P2002'), true],
    ['determinista (P2000, valor demasiado largo)', errorPrisma('P2000'), false],
    ['determinista (un bug nuestro)', new Error('bug sintético'), false],
  ])(
    'falla %s en el 2º de 3 cheques: ése sale rechazado y los otros dos se guardan',
    async (_nombre, error, reintentable) => {
      const prefijo = `SVC-${error instanceof Prisma.PrismaClientKnownRequestError ? error.code : 'BUG'}`;
      // El 1º y el 3º van por la implementación real; el 2º truena con `error`.
      const real = OperacionesSucursal.prototype.guardarCheque;
      let llamada = 0;
      jest.spyOn(OperacionesSucursal.prototype, 'guardarCheque').mockImplementation(function (
        this: OperacionesSucursal,
        ...args
      ) {
        llamada += 1;
        return llamada === 2 ? Promise.reject(error) : real.apply(this, args);
      });

      const r = await servicio.procesarLote(A1, [
        cheque('e1', `${prefijo}-1`),
        cheque('e2', `${prefijo}-2`),
        cheque('e3', `${prefijo}-3`),
      ]);

      expect(r.procesados).toEqual(['e1', 'e3']);
      expect(r.rechazados).toEqual([
        { id: 'e2', indice: 1, reintentable, motivo: expect.any(String) },
      ]);
      const guardados = await prisma.cheque.findMany({
        where: { folioSr: { startsWith: prefijo } },
        orderBy: { folioSr: 'asc' },
      });
      expect(guardados.map((c) => c.folioSr)).toEqual([`${prefijo}-1`, `${prefijo}-3`]);
    },
  );
  it('si falla el registro del CONTACTO (F1-061), se loguea y el lote se procesa igual', async () => {
    // Los tests de arriba ya registraron contacto de A1: se parte de cero.
    await prisma.agenteContacto.deleteMany({ where: { sucursalId: FX.sucursalA1 } });
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest
      .spyOn(OperacionesSucursal.prototype, 'registrarContacto')
      .mockRejectedValue(errorPrisma('P1001'));

    const r = await servicio.procesarLote(A1, [cheque('c1', 'SVC-CONTACTO-1')]);

    expect(r).toEqual({ procesados: ['c1'], rechazados: [] });
    expect(await prisma.cheque.count({ where: { folioSr: 'SVC-CONTACTO-1' } })).toBe(1);
    expect(await prisma.agenteContacto.count({ where: { sucursalId: FX.sucursalA1 } })).toBe(0);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('No se registró el contacto'));
  });
});
