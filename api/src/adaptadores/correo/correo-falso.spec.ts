import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';

import { RELOJ_FIJO } from '../../../test/fixtures-cfdi';
import { CorreoFalso } from './correo-falso';

// Contra el Postgres de DATABASE_URL, como el resto de specs con base. Cada test
// borra SÓLO las filas que creó (por id) y su directorio temporal.
describe('Correo falso (F2-202)', () => {
  const prisma = new PrismaClient();
  const creados: string[] = [];
  const empresas: string[] = [];
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'correos-test-'));
  });

  afterEach(async () => {
    await prisma.correoEnviado.deleteMany({ where: { id: { in: creados.splice(0) } } });
    await prisma.empresa.deleteMany({ where: { id: { in: empresas.splice(0) } } });
    await rm(dir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const PLANTILLA = {
    nombre: 'factura-emitida',
    asunto: 'Tu factura A-1024',
    html: '<p>Hola</p>',
    texto: 'Hola',
  };

  it('deja el .json y los adjuntos en su directorio, y una fila consultable', async () => {
    const correo = new CorreoFalso(prisma, RELOJ_FIJO, dir);
    const pdf = Buffer.from('%PDF-1.4 falso');
    const { id } = await correo.enviar(
      { email: 'cliente@ejemplo.test', nombre: 'Cliente' },
      PLANTILLA,
      [
        { nombre: 'A-1024.pdf', tipo: 'application/pdf', contenido: pdf },
        { nombre: '../raro nombre.xml', tipo: 'application/xml', contenido: Buffer.from('<a/>') },
      ],
    );
    creados.push(id);

    const fila = await prisma.correoEnviado.findUniqueOrThrow({ where: { id } });
    expect(fila).toEqual({
      id,
      empresaId: null,
      destinatario: 'cliente@ejemplo.test',
      plantilla: 'factura-emitida',
      asunto: 'Tu factura A-1024',
      adjuntos: [
        {
          nombre: 'A-1024.pdf',
          tipo: 'application/pdf',
          bytes: pdf.length,
          sha256: createHash('sha256').update(pdf).digest('hex'),
        },
        expect.objectContaining({ nombre: '../raro nombre.xml', bytes: 4 }),
      ],
      enviadoAt: new Date(RELOJ_FIJO.ahora()),
    });

    // El nombre del adjunto no escapa del directorio del correo.
    expect((await readdir(join(dir, id))).sort()).toEqual([
      '0-A-1024.pdf',
      '1-_raro_nombre.xml',
      'correo.json',
    ]);
    expect((await readFile(join(dir, id, '0-A-1024.pdf'))).equals(pdf)).toBe(true);
    const json = JSON.parse(await readFile(join(dir, id, 'correo.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(json).toMatchObject({
      id,
      enviadoAt: '2026-09-22T02:20:00.000Z',
      destinatario: { email: 'cliente@ejemplo.test', nombre: 'Cliente' },
      plantilla: PLANTILLA,
    });
  });

  it('guarda la empresa cuando el correo es de una', async () => {
    const empresa = await prisma.empresa.create({ data: { nombre: 'Empresa sintética correo' } });
    empresas.push(empresa.id);
    const { id } = await new CorreoFalso(prisma, RELOJ_FIJO, dir).enviar(
      { email: 'a@ejemplo.test' },
      PLANTILLA,
      [],
      { empresaId: empresa.id },
    );
    creados.push(id);
    const filas = await prisma.correoEnviado.findMany({ where: { empresaId: empresa.id } });
    expect(filas.map((f) => f.id)).toEqual([id]);
  });
});
