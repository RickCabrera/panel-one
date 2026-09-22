import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorApi } from '../../api/cliente';
import {
  leerBorrador,
  leerCantidad,
  llaveBorrador,
  loteDe,
  mismaCantidad,
  sinConfirmados,
} from './borrador';
import { CapturaConteo, ESPERA_ENVIO_MS, REINTENTO_MS, type Mandar } from './captura';

// F2-123: el borrador local y su envío, sin React. Lo que garantiza que un conteo capturado en
// el celular no se pierde al bloquear la pantalla o quedarse sin red.

const LLAVE = llaveBorrador('u1', 'e1', 'c1');
const ok: Mandar = async (partidas) => ({
  guardadas: partidas.map((p) => ({
    insumoOrigenSrId: p.insumoOrigenSrId,
    contado: p.contado === null ? null : Number(p.contado).toFixed(3),
  })),
});

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

describe('leerCantidad', () => {
  it('acepta hasta 3 decimales y coma decimal; vacío = borrar', () => {
    expect(leerCantidad('12.5')).toEqual({ ok: true, valor: '12.5' });
    expect(leerCantidad(' 3,25 ')).toEqual({ ok: true, valor: '3.25' });
    expect(leerCantidad('')).toEqual({ ok: true, valor: null });
    expect(leerCantidad('0')).toEqual({ ok: true, valor: '0' });
  });
  it('rechaza (nunca redondea) signo, letras y más de 3 decimales', () => {
    for (const t of ['-1', '1.2345', 'abc', '1.', '1e3']) expect(leerCantidad(t).ok).toBe(false);
  });
});

describe('borrador', () => {
  it('"12.5" y "12.500" son la misma cantidad; null sólo con null', () => {
    expect(mismaCantidad('12.5', '12.500')).toBe(true);
    expect(mismaCantidad('12.5', '12.05')).toBe(false);
    expect(mismaCantidad(null, null)).toBe(true);
    expect(mismaCantidad('0', null)).toBe(false);
  });

  it('sólo sale lo confirmado con el MISMO valor (un cambio en vuelo se queda)', () => {
    const b = { I1: '10', I2: '4.5', I3: null };
    expect(
      sinConfirmados(b, [
        { insumoOrigenSrId: 'I1', contado: '10.000' },
        { insumoOrigenSrId: 'I2', contado: '4.000' },
        { insumoOrigenSrId: 'I3', contado: null },
      ]),
    ).toEqual({ I2: '4.5' });
  });

  it('lotes de hasta 500', () => {
    const b = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`X${i}`, '1']));
    expect(loteDe(b)).toHaveLength(500);
  });

  it('un borrador corrupto o de otra forma se ignora', () => {
    window.localStorage.setItem(LLAVE, '{"I1":"-5"}');
    expect(leerBorrador(LLAVE)).toEqual({});
    window.localStorage.setItem(LLAVE, 'no es json');
    expect(leerBorrador(LLAVE)).toEqual({});
  });

  it('la llave separa usuario, empresa y conteo', () => {
    expect(
      new Set([
        llaveBorrador('u1', 'e1', 'c1'),
        llaveBorrador('u2', 'e1', 'c1'),
        llaveBorrador('u1', 'e2', 'c1'),
        llaveBorrador('u1', 'e1', 'c2'),
      ]).size,
    ).toBe(4);
  });
});

describe('CapturaConteo', () => {
  it('escribe al borrador ANTES de mandar, junta las teclas en un lote y lo vacía al confirmar', async () => {
    const mandar = vi.fn(ok);
    const c = new CapturaConteo({ llave: LLAVE, mandar });
    c.capturar('I1', '10');
    c.capturar('I2', '4.25');
    expect(JSON.parse(window.localStorage.getItem(LLAVE)!)).toEqual({ I1: '10', I2: '4.25' });
    expect(mandar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(ESPERA_ENVIO_MS);
    expect(mandar).toHaveBeenCalledTimes(1);
    expect(mandar.mock.calls[0][0]).toEqual([
      { insumoOrigenSrId: 'I1', contado: '10' },
      { insumoOrigenSrId: 'I2', contado: '4.25' },
    ]);
    expect(c.estado()).toEqual({ borrador: {}, envio: { tipo: 'al-dia' } });
    expect(window.localStorage.getItem(LLAVE)).toBeNull();
  });

  it('sin red: el borrador se queda (sobrevive a "bloquear la pantalla" = otra instancia) y se reenvía', async () => {
    const falla = vi.fn<Mandar>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const a = new CapturaConteo({ llave: LLAVE, mandar: falla });
    a.capturar('I1', '7');
    await vi.advanceTimersByTimeAsync(ESPERA_ENVIO_MS);
    expect(a.estado().envio.tipo).toBe('sin-red');
    expect(a.estado().borrador).toEqual({ I1: '7' });
    a.detener();

    // La página se recarga (o el navegador la descarta al bloquear): una instancia nueva lee el
    // mismo borrador y lo manda.
    const mandar = vi.fn(ok);
    const b = new CapturaConteo({ llave: LLAVE, mandar });
    expect(b.estado().borrador).toEqual({ I1: '7' });
    await b.enviar();
    expect(mandar).toHaveBeenCalledWith([{ insumoOrigenSrId: 'I1', contado: '7' }]);
    expect(b.estado().borrador).toEqual({});
  });

  it('sin red reintenta sola cada REINTENTO_MS hasta que pasa', async () => {
    let intentos = 0;
    const mandar = vi.fn<Mandar>(async (p) => {
      intentos++;
      if (intentos < 3) throw new TypeError('Failed to fetch');
      return ok(p);
    });
    const c = new CapturaConteo({ llave: LLAVE, mandar });
    c.capturar('I1', '1');
    await vi.advanceTimersByTimeAsync(ESPERA_ENVIO_MS);
    await vi.advanceTimersByTimeAsync(REINTENTO_MS);
    await vi.advanceTimersByTimeAsync(REINTENTO_MS);
    expect(mandar).toHaveBeenCalledTimes(3);
    expect(c.estado().envio.tipo).toBe('al-dia');
  });

  it('409 (conteo cerrado): rechazado, SIN reintentar en bucle ni descartar en silencio', async () => {
    const mandar = vi.fn<Mandar>(async () => {
      throw new ErrorApi(409, 'El conteo está cerrado');
    });
    const c = new CapturaConteo({ llave: LLAVE, mandar });
    c.capturar('I1', '3');
    await vi.advanceTimersByTimeAsync(ESPERA_ENVIO_MS);
    expect(c.estado().envio).toEqual({
      tipo: 'rechazado',
      mensaje: 'No enviado: el conteo ya está cerrado o cancelado.',
    });
    await c.enviar();
    await vi.advanceTimersByTimeAsync(REINTENTO_MS * 3);
    expect(mandar).toHaveBeenCalledTimes(1);
    // Lo capturado sigue ahí hasta que el usuario decide.
    expect(c.estado().borrador).toEqual({ I1: '3' });
    c.descartar();
    expect(c.estado()).toEqual({ borrador: {}, envio: { tipo: 'al-dia' } });
    expect(window.localStorage.getItem(LLAVE)).toBeNull();
  });

  it('403 (rol que cambió) = rechazado; 401 (sesión vencida) guarda y dice por qué', async () => {
    const prohibido = vi.fn<Mandar>(async () => {
      throw new ErrorApi(403, 'Forbidden');
    });
    const a = new CapturaConteo({ llave: LLAVE, mandar: prohibido });
    a.capturar('I1', '3');
    await vi.advanceTimersByTimeAsync(ESPERA_ENVIO_MS);
    expect(a.estado().envio).toEqual({
      tipo: 'rechazado',
      mensaje: 'No enviado: tu usuario ya no puede capturar conteos.',
    });
    await vi.advanceTimersByTimeAsync(REINTENTO_MS * 2);
    expect(prohibido).toHaveBeenCalledTimes(1);
    a.detener();

    const vencida = vi.fn<Mandar>(async () => {
      throw new ErrorApi(401, 'Unauthorized');
    });
    const b = new CapturaConteo({ llave: LLAVE, mandar: vencida });
    await b.enviar();
    expect(b.estado().envio).toMatchObject({ tipo: 'sin-red' });
    expect((b.estado().envio as { mensaje: string }).mensaje).toContain('Tu sesión venció');
    expect(b.estado().borrador).toEqual({ I1: '3' });
    b.detener();
  });

  it('lo que se captura mientras viaja una petición no se pierde ni se confirma de más', async () => {
    let soltar: () => void = () => undefined;
    const mandar = vi.fn<Mandar>(
      (p) =>
        new Promise((res) => {
          soltar = () => void ok(p).then(res);
        }),
    );
    const c = new CapturaConteo({ llave: LLAVE, mandar });
    c.capturar('I1', '1');
    await vi.advanceTimersByTimeAsync(ESPERA_ENVIO_MS);
    c.capturar('I1', '2'); // cambia en vuelo
    soltar();
    await vi.advanceTimersByTimeAsync(0);
    expect(mandar).toHaveBeenCalledTimes(2);
    expect(mandar.mock.calls[1][0]).toEqual([{ insumoOrigenSrId: 'I1', contado: '2' }]);
  });

  it('sin localStorage (lanza) la captura sigue', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    const mandar = vi.fn(ok);
    const c = new CapturaConteo({ llave: LLAVE, mandar });
    c.capturar('I1', '5');
    await vi.advanceTimersByTimeAsync(ESPERA_ENVIO_MS);
    expect(mandar).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
