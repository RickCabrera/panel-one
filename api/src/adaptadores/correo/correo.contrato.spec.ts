import { plantillaContacto } from '../../onboarding/contacto';
import type { ClienteHttp, PeticionHttp, RespuestaHttp } from '../http';
import { CorreoBrevo, URL_BREVO } from './correo-brevo';
import type { PlantillaCorreo } from './puerto';

/**
 * CONTRATO con Brevo (F2-202): el cuerpo exacto del `POST /v3/smtp/email`, en
 * snapshot, sin red. La suite de comportamiento del puerto (lo que queda registrado)
 * corre sobre el falso en `correo-falso.spec.ts`; la real sólo se prueba aquí.
 */
class ClienteQueCaptura implements ClienteHttp {
  readonly peticiones: PeticionHttp[] = [];
  constructor(private readonly respuesta: RespuestaHttp) {}
  enviar(peticion: PeticionHttp): Promise<RespuestaHttp> {
    this.peticiones.push(JSON.parse(JSON.stringify(peticion)) as PeticionHttp);
    return Promise.resolve(this.respuesta);
  }
}

const REMITENTE = { email: 'facturas@ejemplo.test', nombre: 'Monitor SoftRestaurant' };
const PLANTILLA: PlantillaCorreo = {
  nombre: 'factura-emitida',
  asunto: 'Tu factura A-1024',
  html: '<p>Adjuntamos tu factura.</p>',
  texto: 'Adjuntamos tu factura.',
};

describe('Contrato Brevo (F2-202)', () => {
  it('envío con destinatario con nombre y dos adjuntos', async () => {
    const http = new ClienteQueCaptura({ status: 201, cuerpo: { messageId: '<msg-1@brevo>' } });
    const r = await new CorreoBrevo(REMITENTE, http).enviar(
      { email: 'cliente@ejemplo.test', nombre: 'Cliente de Prueba' },
      PLANTILLA,
      [
        { nombre: 'A-1024.xml', tipo: 'application/xml', contenido: Buffer.from('<cfdi/>') },
        { nombre: 'A-1024.pdf', tipo: 'application/pdf', contenido: Buffer.from('%PDF-1.4') },
      ],
    );
    expect(r).toEqual({ id: '<msg-1@brevo>' });
    expect(http.peticiones).toMatchSnapshot();
    expect(http.peticiones[0].url).toBe(URL_BREVO);
  });

  it('sin adjuntos no manda `attachment` (Brevo rechaza un arreglo vacío)', async () => {
    const http = new ClienteQueCaptura({ status: 201, cuerpo: { messageId: 'm' } });
    await new CorreoBrevo(REMITENTE, http).enviar({ email: 'a@ejemplo.test' }, PLANTILLA, []);
    expect(http.peticiones).toMatchSnapshot();
    expect(http.peticiones[0].cuerpo).not.toHaveProperty('attachment');
  });

  it('el contacto de la landing (F2-147): lo del visitante va escapado y sin adjuntos', async () => {
    const http = new ClienteQueCaptura({ status: 201, cuerpo: { messageId: 'm' } });
    await new CorreoBrevo(REMITENTE, http).enviar(
      { email: 'ventas@ejemplo.test' },
      plantillaContacto({
        nombre: 'Ana <b>',
        email: 'ana@ejemplo.test',
        sucursales: 3,
        mensaje: 'Hola\nquiero una demo',
      }),
      [],
    );
    expect(http.peticiones).toMatchSnapshot();
  });

  it('la api-key NO va en la petición (la pone el cliente HTTP)', async () => {
    const http = new ClienteQueCaptura({ status: 201, cuerpo: { messageId: 'm' } });
    await new CorreoBrevo(REMITENTE, http).enviar({ email: 'a@ejemplo.test' }, PLANTILLA, []);
    expect(JSON.stringify(http.peticiones)).not.toMatch(/api-key|apikey/i);
  });

  it('un rechazo de Brevo es un error con el status', async () => {
    const http = new ClienteQueCaptura({ status: 401, cuerpo: { message: 'Key not found' } });
    await expect(
      new CorreoBrevo(REMITENTE, http).enviar({ email: 'a@ejemplo.test' }, PLANTILLA, []),
    ).rejects.toThrow('HTTP 401');
  });
});
