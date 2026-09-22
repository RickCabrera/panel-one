import { PrismaClient } from '@prisma/client';

import { PrismaService } from './prisma.service';
import { STATEMENT_TIMEOUT_APP_MS, urlConTimeout } from './url-timeout';

const opciones = (url: string) => new URL(url).searchParams.getAll('options');

describe('urlConTimeout (F2-203)', () => {
  it('URL sin query: agrega options codificado para URL', () => {
    const r = urlConTimeout('postgresql://u:p@localhost:5432/monitor', 15000);
    expect(r).toBe('postgresql://u:p@localhost:5432/monitor?options=-c+statement_timeout%3D15000');
    expect(opciones(r)).toEqual(['-c statement_timeout=15000']);
  });

  it('con otros parámetros: los conserva', () => {
    const r = urlConTimeout('postgresql://u:p@h:5432/db?schema=public&connection_limit=5', 15000);
    const q = new URL(r).searchParams;
    expect(q.get('schema')).toBe('public');
    expect(q.get('connection_limit')).toBe('5');
    expect(opciones(r)).toEqual(['-c statement_timeout=15000']);
  });

  it('con un options ya presente: se combina en el mismo, nunca un segundo options', () => {
    const r = urlConTimeout('postgresql://u:p@h/db?options=-c%20search_path%3Dx', 15000);
    expect(opciones(r)).toEqual(['-c search_path=x -c statement_timeout=15000']);
  });

  it('si la URL ya fija statement_timeout, la URL manda', () => {
    const url = 'postgresql://u:p@h/db?options=-c%20statement_timeout%3D2000';
    expect(urlConTimeout(url)).toBe(url);
  });

  it('el default es 15 s', () => {
    expect(STATEMENT_TIMEOUT_APP_MS).toBe(15_000);
    expect(opciones(urlConTimeout('postgresql://h/db'))).toEqual(['-c statement_timeout=15000']);
  });
});

// Contra el Postgres real de DATABASE_URL: que el motor de Prisma sí pasa el
// `options` al servidor (si lo ignorara, esto es lo que se pondría rojo).
describe('statement_timeout en la conexión (Postgres real)', () => {
  it('PrismaService abre sus conexiones con 15 s', async () => {
    const prisma = new PrismaService();
    try {
      const [fila] = await prisma.$queryRaw<
        { statement_timeout: string }[]
      >`SHOW statement_timeout`;
      expect(fila.statement_timeout).toBe('15s');
    } finally {
      await prisma.$disconnect();
    }
  });

  it('una consulta que pasa del tope se corta con 57014 (canceling statement)', async () => {
    const url = process.env.DATABASE_URL as string;
    const prisma = new PrismaClient({ datasources: { db: { url: urlConTimeout(url, 200) } } });
    try {
      await expect(prisma.$queryRaw`SELECT pg_sleep(2)`).rejects.toThrow(/57014|statement timeout/);
    } finally {
      await prisma.$disconnect();
    }
  });
});
