import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ArchivosDisco,
  URL_BASE_ARCHIVOS_FALSO,
  validarClave,
  verificarFirma,
} from './archivos-disco';
import { ArchivoNoEncontrado, type PuertoArchivos } from './puerto';

/**
 * Comportamiento de `PuertoArchivos` sobre `ArchivosDisco`, que es la implementación de
 * las dos variantes (falso y disco real): esta suite cubre a ambas. El contrato de la
 * URL firmada (su forma exacta) va en snapshot al final.
 */
const SECRETO = 'secreto-sintetico-de-pruebas-de-archivos-000001';
const AHORA = Date.parse('2026-09-22T02:20:00.000Z');

describe('Archivos en disco (F2-202)', () => {
  let raiz: string;
  let reloj: { ahora: () => number };
  // Por la interfaz del puerto: es lo que verá un servicio de negocio.
  let archivos: PuertoArchivos;

  beforeEach(async () => {
    raiz = await mkdtemp(join(tmpdir(), 'monitor-archivos-test-'));
    reloj = { ahora: () => AHORA };
    archivos = new ArchivosDisco(raiz, SECRETO, 'https://panel.ejemplo.test/api/archivos/', reloj);
  });

  afterEach(async () => {
    await rm(raiz, { recursive: true, force: true });
  });

  it('guardar y leer: ida y vuelta byte a byte, con subcarpetas', async () => {
    const contenido = Buffer.from([0, 1, 2, 255, 10, 13]);
    await archivos.guardar('empresa/e1/cfdi/A-1.pdf', contenido, 'application/pdf');
    expect((await archivos.leer('empresa/e1/cfdi/A-1.pdf')).equals(contenido)).toBe(true);
  });

  it('guardar otra vez la misma clave la reemplaza y no deja temporales', async () => {
    await archivos.guardar('a/x.xml', Buffer.from('uno'), 'application/xml');
    await archivos.guardar('a/x.xml', Buffer.from('dos'), 'application/xml');
    expect((await archivos.leer('a/x.xml')).toString()).toBe('dos');
    expect(await readdir(join(raiz, 'a'))).toEqual(['x.xml']);
  });

  it('leer una clave que no existe → ArchivoNoEncontrado', async () => {
    await expect(archivos.leer('no/existe.pdf')).rejects.toBeInstanceOf(ArchivoNoEncontrado);
  });

  it.each([
    '../fuera.txt',
    'a/../../fuera.txt',
    '/absoluta.txt',
    'a\\b.txt',
    'C:/x.txt',
    '',
    'a//b',
    './a',
    'a/ /b',
  ])('rechaza la clave %j (path traversal y rutas raras)', async (clave) => {
    expect(() => validarClave(clave)).toThrow('Clave de archivo inválida');
    await expect(archivos.guardar(clave, Buffer.from('x'), 'text/plain')).rejects.toThrow();
    await expect(archivos.leer(clave)).rejects.toThrow('Clave de archivo inválida');
  });

  describe('URL firmada', () => {
    function partes(url: string) {
      const u = new URL(url);
      return {
        clave: u.pathname.replace('/api/archivos/', ''),
        expira: Number(u.searchParams.get('expira')),
        firma: u.searchParams.get('firma') ?? '',
      };
    }

    it('verifica mientras no vence y deja de verificar al vencer', async () => {
      const { clave, expira, firma } = partes(await archivos.urlFirmada('empresa/e1/A-1.pdf', 300));
      expect(clave).toBe('empresa/e1/A-1.pdf');
      expect(expira).toBe(AHORA / 1000 + 300);
      expect(verificarFirma(SECRETO, clave, expira, firma, AHORA + 299_000)).toBe(true);
      expect(verificarFirma(SECRETO, clave, expira, firma, AHORA + 300_000)).toBe(false);
    });

    it('rechaza firma alterada, otra clave, otra expiración u otro secreto', async () => {
      const { clave, expira, firma } = partes(await archivos.urlFirmada('empresa/e1/A-1.pdf', 300));
      const otraFirma = (firma[0] === 'A' ? 'B' : 'A') + firma.slice(1);
      expect(verificarFirma(SECRETO, clave, expira, otraFirma, AHORA)).toBe(false);
      expect(verificarFirma(SECRETO, 'empresa/e2/A-1.pdf', expira, firma, AHORA)).toBe(false);
      expect(verificarFirma(SECRETO, clave, expira + 1, firma, AHORA)).toBe(false);
      expect(verificarFirma(`${SECRETO}x`, clave, expira, firma, AHORA)).toBe(false);
      expect(verificarFirma(SECRETO, '../x', expira, firma, AHORA)).toBe(false);
    });

    it('verificarUrl (F2-105): por el puerto, con SU secreto y SU reloj', async () => {
      const { clave, expira, firma } = partes(await archivos.urlFirmada('cfdi/e1/A-1.xml', 60));
      expect(archivos.verificarUrl(clave, expira, firma)).toBe(true);
      expect(archivos.verificarUrl(clave, expira, `${firma}x`)).toBe(false);
      expect(archivos.verificarUrl('cfdi/e1/A-2.xml', expira, firma)).toBe(false);
      expect(archivos.verificarUrl(clave, Number.NaN, firma)).toBe(false);
      reloj.ahora = () => AHORA + 60_000;
      expect(archivos.verificarUrl(clave, expira, firma)).toBe(false);
      // Otro adaptador (otro secreto) no reconoce la firma.
      const otro = new ArchivosDisco(raiz, `${SECRETO}-otro`, '/api/archivos', reloj);
      reloj.ahora = () => AHORA;
      expect(otro.verificarUrl(clave, expira, firma)).toBe(false);
    });

    it('la URL base del modo falso es la que ve el navegador (detrás de /api)', () => {
      expect(URL_BASE_ARCHIVOS_FALSO).toBe('/api/archivos');
    });

    it('rechaza ttl no positivo o no entero', async () => {
      await expect(archivos.urlFirmada('a.pdf', 0)).rejects.toThrow('ttlSegundos');
      await expect(archivos.urlFirmada('a.pdf', 1.5)).rejects.toThrow('ttlSegundos');
    });

    it('CONTRATO: forma exacta de la URL (secreto y reloj fijos)', async () => {
      expect(await archivos.urlFirmada('empresa/e1/cfdi/A-1024.pdf', 900)).toMatchSnapshot();
    });
  });
});
