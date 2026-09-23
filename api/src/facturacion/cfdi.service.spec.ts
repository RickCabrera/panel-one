import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { MENSAJES_SAT, MENSAJE_RECHAZO_GENERICO } from '../adaptadores/timbrado/errores-sat';
import {
  ErrorTimbrado,
  type CfdiTimbrado,
  type PuertoTimbrado,
  type SolicitudCfdi,
} from '../adaptadores/timbrado/puerto';
import type { Reloj } from '../comun/reloj';
import type { ReservaCfdi } from '../scope/escritura-facturacion';
import type { ScopedPrismaService } from '../scope/scoped-prisma.service';
import {
  BACKOFF_MS,
  CfdiService,
  MENSAJE_EMISION_INCIERTA,
  MENSAJE_PAC_CAIDO,
  type Espera,
} from './cfdi.service';
import type { SolicitudFacturaPortal } from './emision-portal';

/**
 * La política de la emisión (F2-104), sin base: qué se reintenta, qué se libera, qué se queda en
 * `timbrando`, y qué se le contesta al cliente. Las escrituras son dobles que registran llamadas;
 * las de verdad (candado, scope, transacciones) se prueban en `cfdi.e2e.spec.ts` contra Postgres.
 */

const RESERVA: ReservaCfdi = {
  reservaId: 'reserva-1',
  serie: 'A',
  folio: 12,
  emisor: {
    rfc: 'EKU9003173C9',
    razonSocial: 'ESCUELA KEMPER URGATE',
    regimenFiscal: '601',
    cp: '06700',
  },
  sucursal: { zonaHoraria: 'America/Mexico_City' },
  cheque: { folio: 'T-1', total: new Prisma.Decimal('315.50') },
  formaPago: '01',
  importes: {
    subtotal: new Prisma.Decimal('271.98'),
    iva: new Prisma.Decimal('43.52'),
    total: new Prisma.Decimal('315.50'),
  },
};

const SOLICITUD: SolicitudFacturaPortal = {
  codigoId: 'codigo-1',
  codigo: '7JQRECP3U',
  chequeId: 'cheque-1',
  sucursalId: 'sucursal-1',
  empresaId: 'empresa-1',
  receptor: {
    rfc: 'XOJI740919U48',
    razonSocial: 'CLIENTE SINTETICO',
    regimenFiscal: '612',
    cp: '76028',
    usoCfdi: 'G03',
    email: 'cliente@ejemplo.test',
  },
};

const TIMBRE: CfdiTimbrado = {
  uuid: '6F1C2A57-3B8E-4D2A-9C41-7E0B5D3A2F10',
  idPac: 'pac-1',
  xml: '<cfdi:Comprobante/>',
  pdf: Buffer.from('%PDF'),
  fechaTimbrado: new Date('2026-09-22T02:20:00Z'),
};

const error = (codigo: ErrorTimbrado['codigo'], mensaje = 'x') =>
  new ErrorTimbrado(codigo, mensaje, true);

function armar(respuestas: Array<CfdiTimbrado | Error>, confirmar?: () => Promise<unknown>) {
  const llamadas = {
    emitir: [] as SolicitudCfdi[],
    esperas: [] as number[],
    liberadas: [] as string[],
    confirmadas: 0,
  };
  const escritura = {
    reservarCfdi: jest.fn(() => Promise.resolve(RESERVA)),
    confirmarCfdi: jest.fn(() => {
      llamadas.confirmadas++;
      return confirmar ? confirmar() : Promise.resolve({ codigoFacturado: true });
    }),
    liberarReserva: jest.fn((_e: string, id: string) => {
      llamadas.liberadas.push(id);
      return Promise.resolve();
    }),
  };
  const datos = { facturacion: () => escritura } as unknown as ScopedPrismaService;
  const pac: PuertoTimbrado = {
    registrarCsd: () => Promise.reject(new Error('no')),
    cancelar: () => Promise.reject(new Error('no')),
    consultarEstado: () => Promise.reject(new Error('no')),
    emitir: (s) => {
      llamadas.emitir.push(s);
      const r = respuestas.shift();
      if (!r) return Promise.reject(new Error('sin respuesta preparada'));
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    },
  };
  const espera: Espera = {
    esperar: (ms: number) => {
      llamadas.esperas.push(ms);
      return Promise.resolve();
    },
  };
  const reloj = { ahora: () => Date.parse('2026-09-22T02:20:00Z') } as Reloj;
  return { servicio: new CfdiService(datos, reloj, espera, pac), llamadas, escritura };
}

describe('CfdiService.emitir (F2-104)', () => {
  it('éxito: una llamada al PAC, confirma, y responde el contrato del portal', async () => {
    const { servicio, llamadas } = armar([TIMBRE]);
    await expect(servicio.emitir(SOLICITUD)).resolves.toEqual({
      uuid: TIMBRE.uuid,
      serieFolio: 'A-12',
      total: '315.50',
      email: 'cliente@ejemplo.test',
      descargas: { xml: null, pdf: null },
    });
    expect(llamadas.emitir).toHaveLength(1);
    expect(llamadas.emitir[0]).toMatchObject({ referencia: 'reserva-1', serie: 'A', folio: '12' });
    expect(llamadas.confirmadas).toBe(1);
    expect(llamadas.liberadas).toEqual([]);
  });

  it('503/429 y "sin conexión" se reintentan con backoff: dos fallas y luego éxito = 3 llamadas', async () => {
    const { servicio, llamadas } = armar([
      error('PAC_NO_DISPONIBLE'),
      error('PAC_SIN_CONEXION'),
      TIMBRE,
    ]);
    await expect(servicio.emitir(SOLICITUD)).resolves.toMatchObject({ uuid: TIMBRE.uuid });
    expect(llamadas.emitir).toHaveLength(3);
    expect(llamadas.esperas).toEqual([500, 1000]);
    // Los reintentos son de la MISMA reserva: mismo folio, misma referencia.
    expect(new Set(llamadas.emitir.map((s) => `${s.referencia}/${s.folio}`)).size).toBe(1);
  });

  it('máximo 3 reintentos: 4 fallas = 4 llamadas, reserva LIBERADA y 503', async () => {
    const { servicio, llamadas } = armar([1, 2, 3, 4].map(() => error('PAC_NO_DISPONIBLE')));
    const promesa = servicio.emitir(SOLICITUD);
    await expect(promesa).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(promesa).rejects.toMatchObject({ message: MENSAJE_PAC_CAIDO });
    expect(llamadas.emitir).toHaveLength(1 + BACKOFF_MS.length);
    expect(llamadas.esperas).toEqual([...BACKOFF_MS]);
    expect(llamadas.liberadas).toEqual(['reserva-1']);
    expect(llamadas.confirmadas).toBe(0);
  });

  it('un rechazo de validación NUNCA se reintenta: 1 llamada, reserva liberada, 400 con el campo', async () => {
    const { servicio, llamadas } = armar([
      new ErrorTimbrado('RFC_NO_INSCRITO', MENSAJES_SAT.RFC_NO_INSCRITO),
    ]);
    const promesa = servicio.emitir(SOLICITUD);
    await expect(promesa).rejects.toBeInstanceOf(BadRequestException);
    await expect(promesa).rejects.toMatchObject({
      response: {
        statusCode: 400,
        message: [MENSAJES_SAT.RFC_NO_INSCRITO],
        campos: { rfc: MENSAJES_SAT.RFC_NO_INSCRITO },
      },
    });
    expect(llamadas.emitir).toHaveLength(1);
    expect(llamadas.esperas).toEqual([]);
    expect(llamadas.liberadas).toEqual(['reserva-1']);
  });

  it.each([
    ['NOMBRE_NO_COINCIDE', 'razonSocial'],
    ['CODIGO_POSTAL_NO_COINCIDE', 'cp'],
    ['REGIMEN_NO_CORRESPONDE', 'regimenFiscal'],
    ['USO_CFDI_NO_APLICA', 'usoCfdi'],
  ] as const)('%s → 400 en el campo %s', async (codigo, campo) => {
    const { servicio } = armar([new ErrorTimbrado(codigo, 'mensaje amable')]);
    await expect(servicio.emitir(SOLICITUD)).rejects.toMatchObject({
      response: { campos: { [campo]: 'mensaje amable' } },
    });
  });

  it('un rechazo que no está en la tabla: 422 con el mensaje genérico, NUNCA el crudo', async () => {
    const { servicio, llamadas } = armar([
      new ErrorTimbrado('RECHAZADO_POR_PAC', 'Model state crudo con datos internos'),
    ]);
    const promesa = servicio.emitir(SOLICITUD);
    await expect(promesa).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(promesa).rejects.toMatchObject({ message: MENSAJE_RECHAZO_GENERICO });
    expect(llamadas.liberadas).toEqual(['reserva-1']);
  });

  it('AMBIGUO (timeout, 500/502/504): 1 llamada, SIN reintento, la reserva SE QUEDA, 502', async () => {
    const { servicio, llamadas } = armar([error('PAC_SIN_RESPUESTA')]);
    const promesa = servicio.emitir(SOLICITUD);
    await expect(promesa).rejects.toBeInstanceOf(BadGatewayException);
    await expect(promesa).rejects.toMatchObject({ message: MENSAJE_EMISION_INCIERTA });
    expect(llamadas.emitir).toHaveLength(1);
    expect(llamadas.esperas).toEqual([]);
    expect(llamadas.liberadas).toEqual([]);
  });

  it('un error que no es del puerto también es ambiguo: la reserva se queda', async () => {
    const { servicio, llamadas } = armar([new Error('algo raro')]);
    await expect(servicio.emitir(SOLICITUD)).rejects.toBeInstanceOf(BadGatewayException);
    expect(llamadas.liberadas).toEqual([]);
  });

  it('el PAC timbró pero la confirmación falla: 502 que NO invita a reintentar, 1 llamada', async () => {
    const { servicio, llamadas } = armar([TIMBRE], () => Promise.reject(new Error('base caída')));
    const promesa = servicio.emitir(SOLICITUD);
    await expect(promesa).rejects.toBeInstanceOf(BadGatewayException);
    await expect(promesa).rejects.toMatchObject({ message: MENSAJE_EMISION_INCIERTA });
    expect(MENSAJE_EMISION_INCIERTA).toMatch(/No la vuelvas a solicitar/);
    expect(llamadas.emitir).toHaveLength(1);
    expect(llamadas.liberadas).toEqual([]);
  });

  it('la reserva manda: si no se puede reservar, el PAC ni se llama', async () => {
    const { servicio, llamadas, escritura } = armar([TIMBRE]);
    escritura.reservarCfdi.mockRejectedValueOnce(new UnprocessableEntityException('no'));
    await expect(servicio.emitir(SOLICITUD)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(llamadas.emitir).toHaveLength(0);
  });
});
