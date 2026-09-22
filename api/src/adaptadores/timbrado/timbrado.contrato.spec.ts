import { RELOJ_FIJO, solicitudCfdi } from '../../../test/fixtures-cfdi';
import type { ClienteHttp, PeticionHttp, RespuestaHttp } from '../http';
import { ErrorTimbrado } from './puerto';
import { TimbradoFacturama } from './timbrado-facturama';

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
