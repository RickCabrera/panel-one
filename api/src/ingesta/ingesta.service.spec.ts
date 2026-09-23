import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import { crearFixtures, FX, limpiarFixtures } from '../../test/fixtures-auth';
import { Reloj } from '../comun/reloj';
import { GeneradorCodigo } from '../facturacion/codigo';
import type { PrismaService } from '../prisma/prisma.service';
import { OperacionesSucursal } from '../scope/escritura-sucursal';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { AvisosTiempoReal, type CambiosIngesta } from '../tiempo-real/avisos';
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

/** Los avisos del socket (F2-142), anotados; `fallar` hace que el aviso truene. */
class AvisosAnotados extends AvisosTiempoReal {
  llamadas: Array<{ empresaId: string; sucursalId: string; cambios: CambiosIngesta }> = [];
  fallar = false;
  /** Se corre DENTRO del aviso: para mirar la base en ese instante. */
  alAvisar: (() => Promise<void>) | null = null;
  pendiente: Promise<void> | null = null;

  avisarIngesta(empresaId: string, sucursalId: string, cambios: CambiosIngesta): void {
    this.llamadas.push({ empresaId, sucursalId, cambios: { ...cambios } });
    if (this.alAvisar) this.pendiente = this.alAvisar();
    if (this.fallar) throw new Error('aviso sintético que truena');
  }
}

describe('IngestaService, fallas de base (contra Postgres, F1-031)', () => {
  const prisma = new PrismaClient();
  const avisos = new AvisosAnotados();
  const servicio = new IngestaService(
    new ScopedPrismaService(prisma as unknown as PrismaService),
    new Reloj(),
    new GeneradorCodigo(),
    avisos,
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
  it('F2-101: si el SAVEPOINT del código ya no se puede revertir (conexión caída), el cheque sale rechazado REINTENTABLE y no se guarda nada', async () => {
    // `intentarCodigoFacturacion` sólo propaga lo que no pudo aislar (su propio ROLLBACK): eso
    // sigue el camino normal de `esTransitorio()`.
    jest
      .spyOn(OperacionesSucursal.prototype, 'intentarCodigoFacturacion')
      .mockRejectedValue(errorPrisma('P1017'));
    const cerrado = cheque('cod1', 'SVC-COD-1');
    const r = await servicio.procesarLote(A1, [
      { ...cerrado, datos: { ...cerrado.datos, cerradoAt: '2026-09-20T20:00:00Z' } },
    ]);
    expect(r.procesados).toEqual([]);
    expect(r.rechazados).toEqual([
      { id: 'cod1', indice: 0, reintentable: true, motivo: expect.any(String) },
    ]);
    expect(await prisma.cheque.count({ where: { folioSr: 'SVC-COD-1' } })).toBe(0);
  });

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

  describe('aviso en tiempo real (F2-142)', () => {
    beforeEach(() => {
      avisos.llamadas = [];
      avisos.fallar = false;
      avisos.alAvisar = null;
      avisos.pendiente = null;
    });

    it('un lote con snapshot y cheque avisa UNA vez, con la sucursal de la API key y los dos cambios', async () => {
      const r = await servicio.procesarLote(A1, [
        cheque('av1', 'AVISO-1'),
        {
          id: 'av2',
          tipo: 'snapshot',
          datos: { capturadoAt: '2026-09-20T19:05:00Z', mesas: [{ mesa: '1' }] },
        },
        cheque('av3', 'AVISO-2'),
      ]);
      expect(r.procesados).toEqual(['av1', 'av2', 'av3']);
      expect(avisos.llamadas).toEqual([
        {
          empresaId: FX.empresaA,
          sucursalId: FX.sucursalA1,
          cambios: { mesas: true, cheques: true },
        },
      ]);
    });

    it('avisa con los datos YA confirmados: en el instante del aviso el cheque se lee de la base', async () => {
      let visto = -1;
      avisos.alAvisar = async () => {
        visto = await prisma.cheque.count({ where: { folioSr: 'AVISO-COMMIT' } });
      };
      await servicio.procesarLote(A1, [cheque('ac1', 'AVISO-COMMIT')]);
      await avisos.pendiente;
      expect(visto).toBe(1);
      expect(avisos.llamadas[0].cambios).toEqual({ mesas: false, cheques: true });
    });

    it('un lote sólo de heartbeat, o cuyos eventos salieron todos rechazados, NO avisa', async () => {
      await servicio.procesarLote(A1, [
        { id: 'hb', tipo: 'heartbeat', datos: { versionAgente: '0.1.0' } },
      ]);
      const r = await servicio.procesarLote(A1, [{ id: 'malo', tipo: 'cheque', datos: {} }]);
      expect(r.rechazados).toHaveLength(1);
      expect(avisos.llamadas).toEqual([]);
    });

    it('un evento que falla al guardar no cuenta como cambio', async () => {
      jest
        .spyOn(OperacionesSucursal.prototype, 'guardarCheque')
        .mockRejectedValue(errorPrisma('P2000'));
      await servicio.procesarLote(A1, [
        cheque('f1', 'AVISO-FALLA'),
        {
          id: 'f2',
          tipo: 'snapshot',
          datos: { capturadoAt: '2026-09-20T19:06:00Z', mesas: [] },
        },
      ]);
      expect(avisos.llamadas.map((l) => l.cambios)).toEqual([{ mesas: true, cheques: false }]);
    });

    it('si el aviso truena, se loguea y la respuesta y los datos de la ingesta NO cambian', async () => {
      avisos.fallar = true;
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const r = await servicio.procesarLote(A1, [cheque('t1', 'AVISO-TRUENA')]);
      expect(r).toEqual({ procesados: ['t1'], rechazados: [] });
      expect(await prisma.cheque.count({ where: { folioSr: 'AVISO-TRUENA' } })).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('No se avisó en tiempo real'));
    });
  });
});
