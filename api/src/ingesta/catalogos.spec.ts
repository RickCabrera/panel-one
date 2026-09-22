import {
  decidir,
  hashContenido,
  normalizarPagina,
  normalizarRegistro,
  solicitudPendiente,
  type FilaExistente,
  type RegistroNormalizado,
} from './catalogos';

// La parte pura de la ingesta de catálogos (F2-230): validación por registro, hash y
// la decisión de qué hacer con cada registro frente a lo guardado.

const T0 = new Date('2026-09-20T03:00:00.000Z');
const T1 = new Date('2026-09-21T03:00:00.000Z');
const SINC_A = '11111111-1111-4111-8111-111111111111';
const SINC_B = '22222222-2222-4222-8222-222222222222';

async function valido(catalogo: 'productos' | 'meseros' | 'clientes', plano: object, i = 0) {
  const r = await normalizarRegistro(catalogo, plano, i);
  if (!r.ok) throw new Error(r.rechazo.motivo);
  return r.registro;
}

describe('normalizarRegistro()', () => {
  it('acepta acentos, comillas y NULL, y rellena con null lo ausente', async () => {
    const r = await valido('productos', {
      origenSrId: 'P-\'01"',
      nombre: 'Café "de olla" con piloncillo — ñandú',
      clave: null,
    });
    expect(r.origenSrId).toBe('P-\'01"');
    expect(r.contenido).toEqual({
      clave: null,
      nombre: 'Café "de olla" con piloncillo — ñandú',
      activoPos: null,
      grupoOrigenSrId: null,
    });
  });

  it('el hash no depende del orden de las llaves ni distingue ausente de null', async () => {
    const a = await valido('meseros', { origenSrId: 'M1', nombre: 'Ana', activoPos: true });
    const b = await valido('meseros', {
      activoPos: true,
      nombre: 'Ana',
      origenSrId: 'M1',
      clave: null,
    });
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    const c = await valido('meseros', { origenSrId: 'M1', nombre: 'Ana ', activoPos: true });
    expect(c.hash).not.toBe(a.hash);
  });

  it('el hash no incluye el origenSrId (es la llave, no el contenido)', () => {
    expect(hashContenido({ nombre: 'x' })).toBe(hashContenido({ nombre: 'x' }));
  });

  it.each([
    ['sin nombre', { origenSrId: 'P1' }],
    ['nombre vacío', { origenSrId: 'P1', nombre: '' }],
    ['nombre de 201', { origenSrId: 'P1', nombre: 'x'.repeat(201) }],
    ['origen de 65', { origenSrId: 'x'.repeat(65), nombre: 'a' }],
    ['campo desconocido', { origenSrId: 'P1', nombre: 'a', precio: '10.00' }],
    ['activoPos no booleano', { origenSrId: 'P1', nombre: 'a', activoPos: 'si' }],
    ['no es objeto', 'P1'],
  ])('rechaza %s con reintentable=false', async (_n, plano) => {
    const r = await normalizarRegistro('productos', plano, 4);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rechazo.indice).toBe(4);
      expect(r.rechazo.reintentable).toBe(false);
      expect(r.rechazo.motivo).toMatch(/^registros\.4\./);
    }
  });

  it('un rechazado conserva su origenSrId si ése sí era válido', async () => {
    const r = await normalizarRegistro('productos', { origenSrId: 'P7', nombre: '' }, 0);
    expect(!r.ok && r.rechazo.origenSrId).toBe('P7');
    const s = await normalizarRegistro('productos', { origenSrId: '', nombre: 'a' }, 0);
    expect(!s.ok && s.rechazo.origenSrId).toBeNull();
  });

  it('el motivo de un cliente inválido NO repite sus datos personales', async () => {
    const telefono = '555-010-9999-extra-larguisimo-de-mas-de-40-caracteres';
    const correo = `${'z'.repeat(195)}@ejemplo.test`;
    const rfc = 'EKU9003173C9XX';
    const r = await normalizarRegistro(
      'clientes',
      { origenSrId: 'C1', nombre: 'Regina Campos', telefono, correo, rfc, curp: 'SECRETO' },
      2,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      for (const dato of [telefono, correo, rfc, 'Regina Campos', 'SECRETO', '9999', 'EKU9']) {
        expect(r.rechazo.motivo).not.toContain(dato);
      }
      expect(r.rechazo.motivo).toContain('registros.2.telefono');
      expect(r.rechazo.motivo).toContain('registros.2.rfc');
    }
  });
});

describe('normalizarPagina()', () => {
  it('rechaza sólo los inválidos y todas las apariciones de un origen repetido', async () => {
    const { validos, rechazos } = await normalizarPagina('meseros', [
      { origenSrId: 'M1', nombre: 'Ana' },
      { origenSrId: 'M2', nombre: '' },
      { origenSrId: 'M3', nombre: 'Luis' },
      { origenSrId: 'M1', nombre: 'Otra Ana' },
      { origenSrId: 'M4', nombre: 'Sofía' },
    ]);
    expect(validos.map((v) => v.origenSrId)).toEqual(['M3', 'M4']);
    expect(rechazos.map((r) => [r.indice, r.origenSrId])).toEqual([
      [0, 'M1'],
      [1, 'M2'],
      [3, 'M1'],
    ]);
    expect(rechazos[0].motivo).toContain('repetido');
  });
});

describe('decidir()', () => {
  let r1: RegistroNormalizado;
  let r2: RegistroNormalizado;
  beforeAll(async () => {
    r1 = await valido('meseros', { origenSrId: 'M1', nombre: 'Ana' }, 0);
    r2 = await valido('meseros', { origenSrId: 'M2', nombre: 'Luis' }, 1);
  });

  const fila = (
    o: Partial<FilaExistente> & { origenSrId: string; hash: string },
  ): FilaExistente => ({
    id: `id-${o.origenSrId}`,
    activo: true,
    vistoAt: T0,
    sincronizacionId: SINC_A,
    ...o,
  });

  it('sin fila crea; misma página con las mismas marcas no hace nada', () => {
    const p = decidir({
      existentes: [fila({ origenSrId: 'M1', hash: r1.hash })],
      validos: [r1, r2],
      rechazos: [],
      capturadoAt: T0,
      sincronizacionId: SINC_A,
    });
    expect(p.crear.map((c) => c.origenSrId)).toEqual(['M2']);
    expect(p.actualizar).toEqual([]);
    expect(p.marcar).toEqual([]);
    expect(p.sinCambios).toBe(1);
  });

  it('mismo contenido en una sincronización nueva sólo mueve marcas', () => {
    const p = decidir({
      existentes: [fila({ origenSrId: 'M1', hash: r1.hash })],
      validos: [r1],
      rechazos: [],
      capturadoAt: T1,
      sincronizacionId: SINC_B,
    });
    expect(p.marcar).toEqual(['id-M1']);
    expect(p.actualizar).toEqual([]);
    expect(p.sinCambios).toBe(1);
  });

  it('contenido distinto o fila inactiva → actualizar (y reactivar)', () => {
    const p = decidir({
      existentes: [
        fila({ origenSrId: 'M1', hash: 'otro'.padEnd(64, '0') }),
        fila({ origenSrId: 'M2', hash: r2.hash, activo: false }),
      ],
      validos: [r1, r2],
      rechazos: [],
      capturadoAt: T1,
      sincronizacionId: SINC_B,
    });
    expect(p.actualizar.map((a) => a.id)).toEqual(['id-M1', 'id-M2']);
  });

  it('una página más vieja que la fila es obsoleta y no revierte', () => {
    const p = decidir({
      existentes: [fila({ origenSrId: 'M1', hash: 'otro'.padEnd(64, '0'), vistoAt: T1 })],
      validos: [r1],
      rechazos: [],
      capturadoAt: T0,
      sincronizacionId: SINC_B,
    });
    expect(p.obsoletos).toBe(1);
    expect(p.actualizar).toEqual([]);
    expect(p.marcar).toEqual([]);
  });

  it('un rechazado con fila se marca visto; sin fila cuenta para el cierre', () => {
    const p = decidir({
      existentes: [fila({ origenSrId: 'M9', hash: 'h'.padEnd(64, '0') })],
      validos: [],
      rechazos: [
        { indice: 0, origenSrId: 'M9', motivo: 'x', reintentable: false },
        { indice: 1, origenSrId: 'M8', motivo: 'x', reintentable: false },
        { indice: 2, origenSrId: null, motivo: 'x', reintentable: false },
      ],
      capturadoAt: T1,
      sincronizacionId: SINC_B,
    });
    expect(p.vistos).toBe(1);
    expect(p.marcar).toEqual(['id-M9']);
    expect(p.rechazadosSinFila).toBe(2);
  });

  it('un origen repetido con fila: una aparición la marca, las demás cuentan para el cierre', () => {
    const p = decidir({
      existentes: [fila({ origenSrId: 'M9', hash: 'h'.padEnd(64, '0') })],
      validos: [],
      rechazos: [
        { indice: 0, origenSrId: 'M9', motivo: 'x', reintentable: false },
        { indice: 3, origenSrId: 'M9', motivo: 'x', reintentable: false },
      ],
      capturadoAt: T1,
      sincronizacionId: SINC_B,
    });
    expect(p.vistos).toBe(1);
    expect(p.marcar).toEqual(['id-M9']);
    expect(p.rechazadosSinFila).toBe(1);
  });

  it('un rechazado con fila NO mueve marcas hacia atrás (visto_at nunca retrocede)', () => {
    const p = decidir({
      existentes: [fila({ origenSrId: 'M9', hash: 'h'.padEnd(64, '0'), vistoAt: T1 })],
      validos: [],
      rechazos: [{ indice: 0, origenSrId: 'M9', motivo: 'x', reintentable: false }],
      capturadoAt: T0,
      sincronizacionId: SINC_B,
    });
    expect(p.marcar).toEqual([]);
  });
});

describe('solicitudPendiente()', () => {
  const todos = (t: Date) =>
    (['grupos', 'productos', 'meseros', 'clientes', 'areas', 'canales'] as const).map(
      (catalogo) => ({
        catalogo,
        recibidaAt: t,
      }),
    );

  it('sin solicitud no hay pendiente', () => {
    expect(solicitudPendiente(null, [])).toBe(false);
  });

  it('pendiente mientras falte un catálogo o alguno se haya recibido antes', () => {
    expect(solicitudPendiente(T1, todos(T1).slice(1))).toBe(true);
    expect(
      solicitudPendiente(T1, [...todos(T1).slice(1), { catalogo: 'grupos', recibidaAt: T0 }]),
    ).toBe(true);
    expect(solicitudPendiente(T1, todos(T1))).toBe(false);
  });
});
