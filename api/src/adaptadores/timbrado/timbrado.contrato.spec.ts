import { Prisma } from '@prisma/client';

import { RELOJ_FIJO, solicitudCfdi } from '../../../test/fixtures-cfdi';
import { solicitudDesdeCheque } from '../../facturacion/cfdi';
import { MENSAJES_SAT, MENSAJE_RECHAZO_GENERICO } from './errores-sat';
import type { ClienteHttp, PeticionHttp, RespuestaHttp } from '../http';
import { ErrorTimbrado } from './puerto';
import { esFallaDeConexion, TimbradoFacturama } from './timbrado-facturama';

/**
 * CONTRATO con Facturama (F2-202): la forma EXACTA de lo que se le mandará, fijada en
 * snapshot. Sin red: un `ClienteHttp` que captura y contesta lo que el test le diga.
 * Si un cambio mueve el snapshot, es un cambio del contrato con el PAC y se revisa
 * como tal (y se confirma contra el sandbox en F2-190), no se regenera a ciegas.
 *
 * La suite de COMPORTAMIENTO del puerto (UUID, errores por RFC, cancelar/consultar)
 * corre sobre el falso (`timbrado-falso.spec.ts`): la real no se puede ejercitar sin
 * red. De la real sólo se prueban aquí la petición y el mapeo de la respuesta.
 */
class ClienteQueCaptura implements ClienteHttp {
  readonly peticiones: PeticionHttp[] = [];
  constructor(private readonly responder: (p: PeticionHttp) => RespuestaHttp) {}
  enviar(peticion: PeticionHttp): Promise<RespuestaHttp> {
    // Round-trip JSON: es lo que de verdad viaja (los Decimal ya son números).
    this.peticiones.push(JSON.parse(JSON.stringify(peticion)) as PeticionHttp);
    return Promise.resolve(this.responder(peticion));
  }
}

const BASE = 'https://apisandbox.facturama.mx';
const UUID = '6F1C2A57-3B8E-4D2A-9C41-7E0B5D3A2F10';

function respuestaEmision(p: PeticionHttp): RespuestaHttp {
  if (p.metodo === 'POST') {
    return {
      status: 201,
      cuerpo: {
        Id: 'fcm-123',
        Complement: { TaxStamp: { Uuid: UUID.toLowerCase(), Date: '2026-09-21T20:20:05' } },
      },
    };
  }
  const contenido = p.url.includes('/xml/') ? '<cfdi:Comprobante/>' : '%PDF-1.4';
  return { status: 200, cuerpo: { Content: Buffer.from(contenido).toString('base64') } };
}

describe('Contrato Facturama (F2-202)', () => {
  it('emitir: el cuerpo del POST y las descargas de XML y PDF', async () => {
    const http = new ClienteQueCaptura(respuestaEmision);
    const cfdi = await new TimbradoFacturama(BASE, http, RELOJ_FIJO).emitir(solicitudCfdi());

    expect(http.peticiones).toMatchSnapshot();
    expect(cfdi).toMatchObject({ uuid: UUID, idPac: 'fcm-123', xml: '<cfdi:Comprobante/>' });
    expect(cfdi.pdf.toString()).toBe('%PDF-1.4');
    // `TaxStamp.Date` viene sin zona: hora LOCAL de la sucursal (CDMX), no del servidor.
    expect(cfdi.fechaTimbrado.toISOString()).toBe('2026-09-22T02:20:05.000Z');
  });

  it('emitir: la fecha de timbrado no depende de la zona del proceso', async () => {
    const tz = process.env.TZ;
    try {
      for (const zona of ['UTC', 'Asia/Tokyo']) {
        process.env.TZ = zona;
        const http = new ClienteQueCaptura(respuestaEmision);
        const cfdi = await new TimbradoFacturama(BASE, http, RELOJ_FIJO).emitir(solicitudCfdi());
        expect(cfdi.fechaTimbrado.toISOString()).toBe('2026-09-22T02:20:05.000Z');
      }
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  it('emitir: sin fecha legible del PAC, la del reloj', async () => {
    const http = new ClienteQueCaptura((p) =>
      p.metodo === 'POST'
        ? { status: 201, cuerpo: { Id: 'fcm-1', Complement: { TaxStamp: { Uuid: UUID } } } }
        : respuestaEmision(p),
    );
    const cfdi = await new TimbradoFacturama(BASE, http, RELOJ_FIJO).emitir(solicitudCfdi());
    expect(cfdi.fechaTimbrado.getTime()).toBe(RELOJ_FIJO.ahora());
  });

  it('emitir: los importes viajan como número con sus decimales exactos', async () => {
    const http = new ClienteQueCaptura(respuestaEmision);
    await new TimbradoFacturama(BASE, http, RELOJ_FIJO).emitir(solicitudCfdi());
    const cuerpo = http.peticiones[0].cuerpo as { Items: Array<Record<string, unknown>> };
    expect(cuerpo.Items[0]).toMatchObject({ UnitPrice: 86.21, Subtotal: 172.42, Total: 200.01 });
  });

  it('cancelar con motivo 02 y con motivo 01 + sustituto', async () => {
    const http = new ClienteQueCaptura(() => ({ status: 200, cuerpo: { Status: 'canceled' } }));
    const pac = new TimbradoFacturama(BASE, http, RELOJ_FIJO);
    await expect(pac.cancelar({ uuid: UUID, idPac: 'fcm-123', motivo: '02' })).resolves.toEqual({
      uuid: UUID,
      estado: 'cancelado',
      fecha: new Date(RELOJ_FIJO.ahora()),
    });
    await pac.cancelar({
      uuid: UUID,
      idPac: 'fcm-123',
      motivo: '01',
      folioSustitucion: '0A2B4C6D-1111-4222-8333-944455566677',
    });
    expect(http.peticiones).toMatchSnapshot();
  });

  it('consultar estado', async () => {
    const http = new ClienteQueCaptura(() => ({ status: 200, cuerpo: { Status: 'active' } }));
    const pac = new TimbradoFacturama(BASE, http, RELOJ_FIJO);
    await expect(pac.consultarEstado({ uuid: UUID, idPac: 'fcm-123' })).resolves.toEqual({
      uuid: UUID,
      estado: 'vigente',
    });
    expect(http.peticiones).toMatchSnapshot();
  });

  it('las credenciales NO van en la petición (las pone el cliente HTTP)', async () => {
    const http = new ClienteQueCaptura(respuestaEmision);
    await new TimbradoFacturama(BASE, http, RELOJ_FIJO).emitir(solicitudCfdi());
    const texto = JSON.stringify(http.peticiones);
    expect(texto).not.toMatch(/authorization|basic|password/i);
  });

  describe('mapeo de errores', () => {
    it('400 con ModelState → RECHAZADO_POR_PAC con el mensaje del PAC', async () => {
      const http = new ClienteQueCaptura(() => ({
        status: 400,
        cuerpo: {
          Message: 'La solicitud no es válida.',
          ModelState: { 'Receiver.Rfc': ['El RFC no es válido.'] },
        },
      }));
      await expect(
        new TimbradoFacturama(BASE, http, RELOJ_FIJO).emitir(solicitudCfdi()),
      ).rejects.toMatchObject({
        codigo: 'RECHAZADO_POR_PAC',
        message: 'La solicitud no es válida. El RFC no es válido.',
        reintentable: false,
      });
    });

    it('5xx → PAC_NO_DISPONIBLE, reintentable', async () => {
      const http = new ClienteQueCaptura(() => ({ status: 503, cuerpo: null }));
      const promesa = new TimbradoFacturama(BASE, http, RELOJ_FIJO).emitir(solicitudCfdi());
      await expect(promesa).rejects.toBeInstanceOf(ErrorTimbrado);
      await expect(promesa).rejects.toMatchObject({
        codigo: 'PAC_NO_DISPONIBLE',
        reintentable: true,
      });
    });

    it('un estado que no conocemos NO se da por vigente: ESTADO_DESCONOCIDO, reintentable', async () => {
      const http = new ClienteQueCaptura(() => ({ status: 200, cuerpo: { Status: 'pending' } }));
      const pac = new TimbradoFacturama(BASE, http, RELOJ_FIJO);
      await expect(pac.consultarEstado({ uuid: UUID, idPac: 'fcm-123' })).rejects.toMatchObject({
        codigo: 'ESTADO_DESCONOCIDO',
        reintentable: true,
      });
      await expect(
        pac.cancelar({ uuid: UUID, idPac: 'fcm-123', motivo: '02' }),
      ).rejects.toMatchObject({ codigo: 'ESTADO_DESCONOCIDO' });
    });

    it('cancelar sin Status en la respuesta tampoco se da por cancelado', async () => {
      const http = new ClienteQueCaptura(() => ({ status: 200, cuerpo: {} }));
      await expect(
        new TimbradoFacturama(BASE, http, RELOJ_FIJO).cancelar({
          uuid: UUID,
          idPac: 'fcm-123',
          motivo: '02',
        }),
      ).rejects.toMatchObject({ codigo: 'ESTADO_DESCONOCIDO' });
    });

    // F2-104: el timeout es AMBIGUO (el PAC pudo haber timbrado): ya NO se marca reintentable.
    it('timeout → PAC_SIN_RESPUESTA, NO reintentable a ciegas (no un error crudo)', async () => {
      const http: ClienteHttp = {
        enviar: () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
      };
      const promesa = new TimbradoFacturama(BASE, http, RELOJ_FIJO).emitir(solicitudCfdi());
      await expect(promesa).rejects.toBeInstanceOf(ErrorTimbrado);
      await expect(promesa).rejects.toMatchObject({
        codigo: 'PAC_SIN_RESPUESTA',
        reintentable: false,
      });
    });

    it('consultar un Id que no existe → no_encontrado', async () => {
      const http = new ClienteQueCaptura(() => ({ status: 404, cuerpo: null }));
      await expect(
        new TimbradoFacturama(BASE, http, RELOJ_FIJO).consultarEstado({
          uuid: UUID,
          idPac: 'nada',
        }),
      ).resolves.toEqual({ uuid: UUID, estado: 'no_encontrado' });
    });

    it('motivo 01 sin sustituto se rechaza sin salir a la red', async () => {
      const http = new ClienteQueCaptura(() => ({ status: 200, cuerpo: {} }));
      await expect(
        new TimbradoFacturama(BASE, http, RELOJ_FIJO).cancelar({
          uuid: UUID,
          idPac: 'x',
          motivo: '01',
        }),
      ).rejects.toMatchObject({ codigo: 'MOTIVO_REQUIERE_SUSTITUTO' });
      expect(http.peticiones).toHaveLength(0);
    });
  });
});

describe('Contrato Facturama: alta del CSD (F2-100)', () => {
  // Archivos y contraseña DUMMY: el snapshot fija la forma, no guarda ningún CSD.
  const csd = (reemplazar: boolean) => ({
    rfc: 'EKU9003173C9',
    certificado: Buffer.from('cer-de-prueba'),
    llavePrivada: Buffer.from('key-de-prueba'),
    contrasena: 'contrasena-dummy',
    reemplazar,
  });

  it('alta: POST /api-lite/csds con los archivos en base64', async () => {
    const http = new ClienteQueCaptura(() => ({ status: 201, cuerpo: {} }));
    await expect(
      new TimbradoFacturama(BASE, http, RELOJ_FIJO).registrarCsd(csd(false)),
    ).resolves.toEqual({ idOrganizacion: 'EKU9003173C9' });
    expect(http.peticiones).toMatchSnapshot();
  });

  it('reemplazo: PUT /api-lite/csds/{rfc}', async () => {
    const http = new ClienteQueCaptura(() => ({ status: 200, cuerpo: {} }));
    await new TimbradoFacturama(BASE, http, RELOJ_FIJO).registrarCsd(csd(true));
    expect(http.peticiones).toMatchSnapshot();
  });

  it('un error del PAC que repite la contraseña y la llave sale LIMPIO', async () => {
    // Secretos largos y únicos: un LIKE/contains no coincide por casualidad.
    const contrasena = 'Pw-3f9c1e7a-unica-F2-100-no-debe-salir';
    const llave = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 37 + 11) % 256));
    const cer = Buffer.from(Array.from({ length: 200 }, (_, i) => (i * 53 + 7) % 256));
    const b64 = llave.toString('base64');
    const http = new ClienteQueCaptura(() => ({
      status: 400,
      cuerpo: {
        Message: `The value '${contrasena}' is not valid for PrivateKeyPassword.`,
        ModelState: {
          PrivateKey: [`Invalid key ${b64}`, `fragment ${b64.slice(100, 160)}`],
          Certificate: [`bad ${cer.toString('base64')}`],
          Rfc: [`Rfc ${contrasena} mismatch`],
        },
      },
    }));
    const error = await new TimbradoFacturama(BASE, http, RELOJ_FIJO)
      .registrarCsd({
        rfc: 'EKU9003173C9',
        certificado: cer,
        llavePrivada: llave,
        contrasena,
        reemplazar: false,
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(ErrorTimbrado);
    const e = error as ErrorTimbrado;
    expect(e.codigo).toBe('CSD_RECHAZADO');
    for (const secreto of [
      contrasena,
      b64,
      b64.slice(100, 160),
      b64.slice(0, 40),
      cer.toString('base64').slice(0, 40),
    ]) {
      expect(e.message).not.toContain(secreto);
    }
    // El texto útil del PAC sí se conserva.
    expect(e.message).toContain('is not valid for PrivateKeyPassword');
    expect(e.message).toContain('[omitido]');
  });

  it('PAC caído en el alta: reintentable, sin copiar nada', async () => {
    const http = new ClienteQueCaptura(() => ({ status: 503, cuerpo: 'x' }));
    await expect(
      new TimbradoFacturama(BASE, http, RELOJ_FIJO).registrarCsd(csd(false)),
    ).rejects.toMatchObject({ codigo: 'PAC_NO_DISPONIBLE', reintentable: true });
  });

  it('reemplazar un CSD que el PAC no tiene: mensaje del CSD, no de "CFDI"', async () => {
    const http = new ClienteQueCaptura(() => ({ status: 404, cuerpo: null }));
    await expect(
      new TimbradoFacturama(BASE, http, RELOJ_FIJO).registrarCsd(csd(true)),
    ).rejects.toMatchObject({ codigo: 'CSD_RECHAZADO' });
  });
});

/**
 * CONTRATO de la emisión de un CFDI de CONSUMO (F2-104): de un cheque del panel al JSON EXACTO
 * que recibe Facturama. Revisado a mano contra la documentación pública de la API multiemisor de
 * Facturama (CFDI 4.0, `POST /api-lite/3/cfdis`): `Issuer`/`Receiver` con `FiscalRegime`,
 * `CfdiUse` y `TaxZipCode`; un `Item` con `ProductCode` 90101500, `UnitCode` E48, `TaxObject`
 * 02 y su traslado de IVA; `PaymentForm` mapeada, `PaymentMethod` PUE, `Currency` MXN y
 * `ExpeditionPlace` = CP del emisor. Que Facturama lo acepte se confirma en F2-190.
 */
describe('Contrato Facturama: CFDI de consumo desde un cheque (F2-104)', () => {
  const solicitud = solicitudDesdeCheque({
    reservaId: '00000000-0000-4000-8000-0000000000c1',
    serie: 'A',
    folio: 1025,
    // 2026-09-21 20:15:30 en CDMX (UTC-6): la fecha del JSON va en hora LOCAL, sin zona.
    fecha: new Date('2026-09-22T02:15:30.000Z'),
    emisor: {
      rfc: 'EKU9003173C9',
      razonSocial: 'ESCUELA KEMPER URGATE',
      regimenFiscal: '601',
      cp: '06700',
    },
    sucursal: { zonaHoraria: 'America/Mexico_City' },
    cheque: { folio: 'T-4410', total: new Prisma.Decimal('315.50') },
    receptor: {
      rfc: 'XOJI740919U48',
      razonSocial: 'CLIENTE SINTETICO',
      regimenFiscal: '612',
      cp: '76028',
      usoCfdi: 'G03',
    },
    formaPago: '01',
  });

  it('el cuerpo del POST, exacto', async () => {
    const http = new ClienteQueCaptura(respuestaEmision);
    await new TimbradoFacturama(BASE, http, RELOJ_FIJO).emitir(solicitud);
    expect(http.peticiones[0]).toMatchSnapshot();
    const cuerpo = http.peticiones[0].cuerpo as Record<string, unknown> & {
      Items: Array<Record<string, unknown>>;
    };
    // Lo que el AC de F2-104 nombra, explícito además del snapshot.
    expect(cuerpo).toMatchObject({
      Currency: 'MXN',
      PaymentMethod: 'PUE',
      PaymentForm: '01',
      ExpeditionPlace: '06700',
      Serie: 'A',
      Folio: '1025',
      Date: '2026-09-21T20:15:30',
    });
    expect(cuerpo.Items).toEqual([
      expect.objectContaining({
        ProductCode: '90101500',
        UnitCode: 'E48',
        Quantity: 1,
        UnitPrice: 271.98,
        Subtotal: 271.98,
        TaxObject: '02',
        Total: 315.5,
        Taxes: [{ Name: 'IVA', Base: 271.98, Rate: 0.16, Total: 43.52, IsRetention: false }],
      }),
    ]);
  });
});

describe('Contrato Facturama: errores de la emisión (F2-104)', () => {
  const emitirCon = (r: RespuestaHttp) =>
    new TimbradoFacturama(BASE, new ClienteQueCaptura(() => r), RELOJ_FIJO).emitir(solicitudCfdi());

  it('un rechazo del SAT reconocido sale con su código y el mensaje AMABLE, no el crudo', async () => {
    const crudo =
      'CFDI40144 - El campo Rfc del receptor no se encuentra en la lista de RFC inscritos no cancelados en el SAT.';
    const promesa = emitirCon({
      status: 400,
      cuerpo: { Message: 'La solicitud no es válida.', ModelState: { '': [crudo] } },
    });
    await expect(promesa).rejects.toMatchObject({
      codigo: 'RFC_NO_INSCRITO',
      message: MENSAJES_SAT.RFC_NO_INSCRITO,
      reintentable: false,
    });
  });

  it('un rechazo que no está en la tabla queda RECHAZADO_POR_PAC (la emisión no lo muestra)', async () => {
    await expect(emitirCon({ status: 400, cuerpo: 'Serie inválida' })).rejects.toMatchObject({
      codigo: 'RECHAZADO_POR_PAC',
      message: 'Serie inválida',
    });
    await expect(emitirCon({ status: 400, cuerpo: null })).rejects.toMatchObject({
      codigo: 'RECHAZADO_POR_PAC',
      message: `El PAC rechazó la solicitud (HTTP 400). ${MENSAJE_RECHAZO_GENERICO}`,
    });
  });

  it('429 y 503: PAC_NO_DISPONIBLE (el PAC dice que NO procesó)', async () => {
    for (const status of [429, 503]) {
      await expect(emitirCon({ status, cuerpo: null })).rejects.toMatchObject({
        codigo: 'PAC_NO_DISPONIBLE',
        reintentable: true,
      });
    }
  });

  it('500, 502 y 504: AMBIGUOS (PAC_SIN_RESPUESTA), el PAC pudo haber timbrado', async () => {
    for (const status of [500, 502, 504]) {
      await expect(emitirCon({ status, cuerpo: null })).rejects.toMatchObject({
        codigo: 'PAC_SIN_RESPUESTA',
        reintentable: false,
      });
    }
  });

  it('no se llegó a conectar (ECONNREFUSED, DNS…): PAC_SIN_CONEXION, seguro de reintentar', async () => {
    const caida = (code: string) => {
      const e = new TypeError('fetch failed');
      (e as { cause?: unknown }).cause = Object.assign(new Error(code), { code });
      return e;
    };
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']) {
      expect(esFallaDeConexion(caida(code))).toBe(true);
      const http: ClienteHttp = { enviar: () => Promise.reject(caida(code)) };
      await expect(
        new TimbradoFacturama(BASE, http, RELOJ_FIJO).emitir(solicitudCfdi()),
      ).rejects.toMatchObject({ codigo: 'PAC_SIN_CONEXION', reintentable: true });
    }
    // Un corte a MEDIO camino no es "sin conexión": es ambiguo.
    expect(esFallaDeConexion(caida('ECONNRESET'))).toBe(false);
    expect(esFallaDeConexion(new DOMException('timeout', 'TimeoutError'))).toBe(false);
  });

  it('el alta del CSD NO pasa por la tabla del receptor (su texto se limpia aparte)', async () => {
    const http = new ClienteQueCaptura(() => ({
      status: 400,
      cuerpo: { Message: 'El RFC del receptor no aplica aquí.' },
    }));
    await expect(
      new TimbradoFacturama(BASE, http, RELOJ_FIJO).registrarCsd({
        rfc: 'EKU9003173C9',
        certificado: Buffer.from('c'),
        llavePrivada: Buffer.from('k'),
        contrasena: 'x',
        reemplazar: false,
      }),
    ).rejects.toMatchObject({ codigo: 'CSD_RECHAZADO' });
  });
});

describe('Contrato Facturama: sustitución y factura sin ticket (F2-107)', () => {
  const UUID_ANTERIOR = '1B4E28BA-2FA1-41D2-883F-0016D3CCA427';

  it('el sustituto lleva `Relations` 04 con el UUID anterior (snapshot revisado a mano)', async () => {
    const http = new ClienteQueCaptura(respuestaEmision);
    await new TimbradoFacturama(BASE, http, RELOJ_FIJO).emitir({
      ...solicitudCfdi(),
      relacionados: { tipoRelacion: '04', uuids: [UUID_ANTERIOR] },
    });
    const cuerpo = http.peticiones[0].cuerpo as Record<string, unknown>;
    expect(cuerpo.Relations).toEqual({ Type: '04', Cfdis: [{ Uuid: UUID_ANTERIOR }] });
    expect(http.peticiones[0]).toMatchSnapshot();
  });

  it('sin relacionados NO manda `Relations` (el CFDI de un ticket sale igual que antes)', async () => {
    const http = new ClienteQueCaptura(respuestaEmision);
    await new TimbradoFacturama(BASE, http, RELOJ_FIJO).emitir(solicitudCfdi());
    expect(http.peticiones[0].cuerpo).not.toHaveProperty('Relations');
  });

  it('sin ticket: el concepto va sin `IdentificationNumber`', async () => {
    const http = new ClienteQueCaptura(respuestaEmision);
    const base = solicitudCfdi();
    const concepto = { ...base.conceptos[0] };
    delete concepto.noIdentificacion;
    await new TimbradoFacturama(BASE, http, RELOJ_FIJO).emitir({ ...base, conceptos: [concepto] });
    const items = (http.peticiones[0].cuerpo as { Items: Array<Record<string, unknown>> }).Items;
    expect(items[0]).not.toHaveProperty('IdentificationNumber');
    expect(items[0]).toMatchObject({ ProductCode: '90101500', UnitCode: 'E48' });
  });
});
