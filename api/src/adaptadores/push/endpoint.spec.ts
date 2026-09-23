import { bytesBase64Url, leerHostsExtra, llavesValidas, motivoEndpointInvalido } from './endpoint';

/** Anti-SSRF del registro de navegadores (F2-146): el api hace POST a esa URL. */
describe('endpoint de push', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
    'https://wns2-by3p.notify.windows.com/w/?token=abc',
    'https://web.push.apple.com/QGuQyavXutnMH',
    'https://fcm.googleapis.com:443/fcm/send/abc',
    'https://FCM.GoogleAPIs.com/fcm/send/abc',
  ])('acepta %s', (endpoint) => {
    expect(motivoEndpointInvalido(endpoint)).toBeNull();
  });

  it.each([
    ['http://fcm.googleapis.com/fcm/send/abc', 'https'],
    ['https://evilfcm.googleapis.com/x', 'servicio de notificaciones conocido'],
    ['https://fcm.googleapis.com.evil.test/x', 'servicio de notificaciones conocido'],
    ['https://evilnotify.windows.com/x', 'servicio de notificaciones conocido'],
    ['https://notify.windows.com/x', 'servicio de notificaciones conocido'],
    ['https://127.0.0.1/x', 'IP'],
    ['https://[::1]/x', 'IP'],
    ['https://169.254.169.254/latest', 'IP'],
    ['https://usuario:clave@fcm.googleapis.com/x', 'usuario'],
    ['https://fcm.googleapis.com:8443/x', 'puerto'],
    ['no es url', 'URL'],
    ['file:///etc/passwd', 'https'],
    [`https://fcm.googleapis.com/${'a'.repeat(1100)}`, 'larga'],
  ])('rechaza %s', (endpoint, motivo) => {
    expect(motivoEndpointInvalido(endpoint)).toContain(motivo);
  });

  it('un host extra exacto o con punto inicial para subdominios', () => {
    expect(motivoEndpointInvalido('https://push.ejemplo.test/x', ['push.ejemplo.test'])).toBeNull();
    expect(
      motivoEndpointInvalido('https://a.push.ejemplo.test/x', ['push.ejemplo.test']),
    ).not.toBeNull();
    expect(motivoEndpointInvalido('https://a.otro.test/x', ['.otro.test'])).toBeNull();
    expect(motivoEndpointInvalido('https://malotro.test/x', ['.otro.test'])).not.toBeNull();
  });

  it('leerHostsExtra: vacío = ninguno; normaliza; rechaza esquema, puerto e IP', () => {
    expect(leerHostsExtra(undefined)).toEqual([]);
    expect(leerHostsExtra('')).toEqual([]);
    expect(leerHostsExtra('Push.Ejemplo.Test')).toEqual(['push.ejemplo.test']);
    expect(() => leerHostsExtra('https://x.test')).toThrow();
    expect(() => leerHostsExtra('x.test:443')).toThrow();
    expect(() => leerHostsExtra('192.168.0.1')).toThrow();
  });

  it('llaves del navegador: p256dh punto P-256 sin comprimir (65 bytes, 0x04) y auth de 16', () => {
    const p256dh = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url');
    const auth = Buffer.alloc(16, 2).toString('base64url');
    expect(llavesValidas(p256dh, auth)).toBe(true);
    const comprimida = Buffer.concat([Buffer.from([3]), Buffer.alloc(64, 1)]).toString('base64url');
    expect(llavesValidas(comprimida, auth)).toBe(false);
    expect(llavesValidas(p256dh, Buffer.alloc(15).toString('base64url'))).toBe(false);
    expect(llavesValidas('no+es/base64url', auth)).toBe(false);
    expect(bytesBase64Url('abc=')).toBeNull();
  });
});
