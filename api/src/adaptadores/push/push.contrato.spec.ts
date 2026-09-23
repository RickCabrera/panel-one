import {
  createDecipheriv,
  createECDH,
  createHmac,
  createPublicKey,
  randomBytes,
  verify,
} from 'node:crypto';

import webpush, { WebPushError } from 'web-push';

import type { MensajePush } from './puerto';
import { PushWebPush, TIMEOUT_PUSH_MS, type EnviarWebPush } from './push-webpush';

/**
 * Test de CONTRATO del push real (F2-146, regla 1 de la Ronda 2), con llaves VAPID LOCALES
 * generadas aquí. No sale nada a la red: el envío se intercepta y se arma la petición EXACTA
 * que `web-push` mandaría (`generateRequestDetails`, con los mismos argumentos). Sobre esa
 * petición se afirma lo que un servicio de push real exige:
 *
 * - POST al endpoint, con `TTL`, `Urgency` y `Content-Encoding: aes128gcm` (RFC 8030/8188);
 * - `Authorization: vapid t=<JWT>, k=<llave pública>` (RFC 8292): el JWT es ES256, verifica
 *   con la pública, `aud` = origen del endpoint, `sub` = el contacto, `exp` ≤ 24 h;
 * - el cuerpo, DESCIFRADO con las llaves del "navegador" (RFC 8291), es exactamente el JSON
 *   del mensaje. Si la librería cambia de cifrado o de cabeceras, esto truena.
 */

const b64u = (b: Buffer): string => b.toString('base64url');

function hmac(clave: Buffer, datos: Buffer): Buffer {
  return createHmac('sha256', clave).update(datos).digest();
}

/** Descifra un cuerpo `aes128gcm` de Web Push (RFC 8291 + RFC 8188), un solo registro. */
function descifrar(cuerpo: Buffer, uaPrivada: ReturnType<typeof createECDH>, auth: Buffer): string {
  const salt = cuerpo.subarray(0, 16);
  const idlen = cuerpo[20];
  const asPublica = cuerpo.subarray(21, 21 + idlen);
  const cifrado = cuerpo.subarray(21 + idlen);
  const uaPublica = uaPrivada.getPublicKey();
  const secreto = uaPrivada.computeSecret(asPublica);

  const prkKey = hmac(auth, secreto);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublica, asPublica]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);

  const descifrador = createDecipheriv('aes-128-gcm', cek, nonce);
  descifrador.setAuthTag(cifrado.subarray(cifrado.length - 16));
  const claro = Buffer.concat([
    descifrador.update(cifrado.subarray(0, cifrado.length - 16)),
    descifrador.final(),
  ]);
  // Último registro: el delimitador 0x02 y, después, relleno de ceros.
  const fin = claro.lastIndexOf(2);
  expect(claro.subarray(fin + 1).every((b) => b === 0)).toBe(true);
  return claro.subarray(0, fin).toString('utf8');
}

function verificarJwt(jwt: string, publicaVapid: string): Record<string, unknown> {
  const [h, p, firma] = jwt.split('.');
  expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
  const cruda = Buffer.from(publicaVapid, 'base64url');
  const llave = createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: b64u(cruda.subarray(1, 33)),
      y: b64u(cruda.subarray(33, 65)),
    },
    format: 'jwk',
  });
  const valida = verify(
    'sha256',
    Buffer.from(`${h}.${p}`),
    { key: llave, dsaEncoding: 'ieee-p1363' },
    Buffer.from(firma, 'base64url'),
  );
  expect(valida).toBe(true);
  return JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, unknown>;
}

describe('PushWebPush — contrato (F2-146, VAPID local)', () => {
  const vapid = webpush.generateVAPIDKeys();
  const llaves = {
    publica: vapid.publicKey,
    privada: vapid.privateKey,
    sujeto: 'mailto:soporte@ejemplo.test',
  };
  const navegador = createECDH('prime256v1');
  navegador.generateKeys();
  const auth = randomBytes(16);
  const destino = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/dispositivo-sintetico-123',
    p256dh: b64u(navegador.getPublicKey()),
    auth: b64u(auth),
  };
  const mensaje: MensajePush = {
    titulo: 'Sucursal sin reportar',
    cuerpo: 'Centro (Restaurante Demo) no reporta desde hace 14 min.',
    url: '/alertas?empresa=e&sucursal=s',
    etiqueta: 'alerta-1',
  };

  function interceptar(): {
    enviar: EnviarWebPush;
    peticiones: ReturnType<typeof webpush.generateRequestDetails>[];
    opciones: unknown[];
  } {
    const peticiones: ReturnType<typeof webpush.generateRequestDetails>[] = [];
    const opciones: unknown[] = [];
    const enviar = ((sub, payload, opts) => {
      opciones.push(opts);
      peticiones.push(webpush.generateRequestDetails(sub, payload ?? undefined, opts));
      return Promise.resolve({ statusCode: 201, body: '', headers: {} });
    }) as EnviarWebPush;
    return { enviar, peticiones, opciones };
  }

  it('arma la petición que exige un servicio de push real, y el cuerpo descifra al mensaje', async () => {
    const { enviar, peticiones, opciones } = interceptar();
    const antes = Math.floor(Date.now() / 1000);
    const r = await new PushWebPush(llaves, [], enviar).enviar(destino, mensaje, {
      ttlS: 3600,
      urgencia: 'high',
    });
    expect(r).toBe('entregado');
    expect(peticiones).toHaveLength(1);
    const p = peticiones[0];

    expect(p.method).toBe('POST');
    expect(p.endpoint).toBe(destino.endpoint);
    expect(p.headers.TTL).toBe(3600);
    expect(p.headers.Urgency).toBe('high');
    expect(p.headers['Content-Encoding']).toBe('aes128gcm');
    expect(p.headers['Content-Type']).toBe('application/octet-stream');
    expect((opciones[0] as { timeout: number }).timeout).toBe(TIMEOUT_PUSH_MS);

    const m = /^vapid t=([^,]+), k=(.+)$/.exec(String(p.headers.Authorization));
    expect(m).not.toBeNull();
    expect(m![2]).toBe(vapid.publicKey);
    const claims = verificarJwt(m![1], vapid.publicKey);
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe('mailto:soporte@ejemplo.test');
    expect(claims.exp as number).toBeGreaterThan(antes);
    expect(claims.exp as number).toBeLessThanOrEqual(antes + 24 * 60 * 60 + 5);

    const cuerpo = Buffer.from(p.body as Buffer);
    expect(JSON.parse(descifrar(cuerpo, navegador, auth))).toEqual(mensaje);
    // La llave privada VAPID no viaja en ninguna parte de la petición.
    expect(JSON.stringify(p.headers)).not.toContain(vapid.privateKey);
  });

  it.each([404, 410])('HTTP %i del servicio de push = suscripción caducada', async (status) => {
    const enviar = (() =>
      Promise.reject(new WebPushError('Gone', status, {}, '', destino.endpoint))) as EnviarWebPush;
    const r = await new PushWebPush(llaves, [], enviar).enviar(destino, mensaje, {
      ttlS: 60,
      urgencia: 'normal',
    });
    expect(r).toBe('caducado');
  });

  it('otro error LANZA, sin el endpoint ni el cuerpo del error en el mensaje', async () => {
    const enviar = (() =>
      Promise.reject(
        new WebPushError('Boom', 500, {}, 'detalle-del-servicio', destino.endpoint),
      )) as EnviarWebPush;
    const p = new PushWebPush(llaves, [], enviar).enviar(destino, mensaje, {
      ttlS: 60,
      urgencia: 'normal',
    });
    await expect(p).rejects.toThrow('El servicio de push rechazó el envío (HTTP 500).');
    await p.catch((e: Error) => {
      expect(e.message).not.toContain('dispositivo-sintetico');
      expect(e.message).not.toContain('detalle-del-servicio');
      expect(e.cause).toBeUndefined();
    });
  });

  it('un error de red (sin status) también lanza', async () => {
    const enviar = (() => Promise.reject(new Error('ECONNRESET'))) as EnviarWebPush;
    await expect(
      new PushWebPush(llaves, [], enviar).enviar(destino, mensaje, {
        ttlS: 60,
        urgencia: 'normal',
      }),
    ).rejects.toThrow('El servicio de push rechazó el envío.');
  });

  it('un endpoint fuera de la lista NO sale a la red: se da por caducado (fila vieja)', async () => {
    const { enviar, peticiones } = interceptar();
    const push = new PushWebPush(llaves, [], enviar);
    for (const endpoint of [
      'https://169.254.169.254/latest/meta-data',
      'https://interno.ejemplo.test/push',
      'http://fcm.googleapis.com/fcm/send/x',
    ]) {
      expect(
        await push.enviar({ ...destino, endpoint }, mensaje, { ttlS: 60, urgencia: 'low' }),
      ).toBe('caducado');
    }
    expect(peticiones).toHaveLength(0);
  });

  it('un host extra de PUSH_HOSTS_PERMITIDOS sí sale', async () => {
    const { enviar, peticiones } = interceptar();
    const r = await new PushWebPush(llaves, ['push.ejemplo.test'], enviar).enviar(
      { ...destino, endpoint: 'https://push.ejemplo.test/s/1' },
      mensaje,
      { ttlS: 60, urgencia: 'low' },
    );
    expect(r).toBe('entregado');
    expect(peticiones).toHaveLength(1);
  });
});
