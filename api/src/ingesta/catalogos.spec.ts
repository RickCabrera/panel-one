import {
  CATALOGOS,
  columnasDe,
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
      precio: null,
    });
  });

  describe('precio (F2-145)', () => {
    it.each([
      ['89', '89.00'],
      ['89.0000', '89.00'],
      ['0.125', '0.13'],
      ['-0.125', '-0.13'],
      ['-0.001', '0.00'],
      ['-0', '0.00'],
    ])('"%s" se guarda como "%s"', async (entrada, guardado) => {
      const r = await valido('productos', { origenSrId: 'P1', nombre: 'a', precio: entrada });
      expect(r.contenido.precio).toBe(guardado);
    });

    it('la misma cifra escrita distinto da el mismo hash; otra cifra, otro hash', async () => {
      const a = await valido('productos', { origenSrId: 'P1', nombre: 'a', precio: '89' });
      const b = await valido('productos', { origenSrId: 'P1', nombre: 'a', precio: '89.0000' });
      const c = await valido('productos', { origenSrId: 'P1', nombre: 'a', precio: '95.00' });
      const cero = await valido('productos', { origenSrId: 'P1', nombre: 'a', precio: '0' });
      const menosCero = await valido('productos', {
        origenSrId: 'P1',
        nombre: 'a',
        precio: '-0.001',
      });
      expect(a.hash).toBe(b.hash);
      expect(c.hash).not.toBe(a.hash);
      expect(menosCero.hash).toBe(cero.hash);
    });

    it('un precio que al redondear no cabe en NUMERIC(12,2) rechaza el registro sin el valor', async () => {
      const r = await normalizarRegistro(
        'productos',
        { origenSrId: 'P1', nombre: 'a', precio: '9999999999.9999' },
        2,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.rechazo).toEqual({
          indice: 2,
          origenSrId: 'P1',
          motivo: 'registros.2.precio: no cabe en NUMERIC(12,2) al redondear',
          reintentable: false,
        });
      }
    });

    it.each([
      ['número JSON', 89],
      ['texto no decimal', '89,50'],
      ['5 decimales', '1.00001'],
    ])('rechaza un precio %s', async (_n, precio) => {
      const r = await normalizarRegistro('productos', { origenSrId: 'P1', nombre: 'a', precio }, 0);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.rechazo.motivo).toContain('registros.0.precio');
        expect(r.rechazo.motivo).not.toContain(String(precio));
      }
    });

    it('el precio sólo existe en productos', async () => {
      const r = await normalizarRegistro(
        'meseros',
        { origenSrId: 'M1', nombre: 'a', precio: '1' },
        0,
      );
      expect(r.ok).toBe(false);
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
    ['campo desconocido', { origenSrId: 'P1', nombre: 'a', costo: '10.00' }],
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

describe('insumos y demás catálogos de inventario (F2-120)', () => {
  const insumo = async (plano: object) => {
    const r = await normalizarRegistro('insumos', plano, 0);
    if (!r.ok) throw new Error(r.rechazo.motivo);
    return r.registro;
  };

  it('el insumo guarda su grupo y su unidad; ausentes = null (también en una incremental)', async () => {
    expect(columnasDe('insumos')).toEqual([
      'clave',
      'nombre',
      'activoPos',
      'grupoOrigenSrId',
      'unidadOrigenSrId',
    ]);
    const completo = await insumo({
      origenSrId: 'I-"01"',
      nombre: 'Jalapeño en escabeche — lata "grande"',
      clave: null,
      grupoOrigenSrId: 'GI04',
      unidadOrigenSrId: 'KG',
    });
    expect(completo.contenido).toEqual({
      clave: null,
      nombre: 'Jalapeño en escabeche — lata "grande"',
      activoPos: null,
      grupoOrigenSrId: 'GI04',
      unidadOrigenSrId: 'KG',
    });
    const sinNada = await insumo({ origenSrId: 'I-"01"', nombre: 'Jalapeño en escabeche' });
    expect(sinNada.contenido.grupoOrigenSrId).toBeNull();
    expect(sinNada.contenido.unidadOrigenSrId).toBeNull();
  });

  it('cambiar el grupo o la unidad cambia el hash', async () => {
    const base = {
      origenSrId: 'I1',
      nombre: 'Leche',
      grupoOrigenSrId: 'GI02',
      unidadOrigenSrId: 'LT',
    };
    const h = (await insumo(base)).hash;
    expect((await insumo({ ...base, unidadOrigenSrId: 'KG' })).hash).not.toBe(h);
    expect((await insumo({ ...base, grupoOrigenSrId: 'GI04' })).hash).not.toBe(h);
    expect((await insumo({ ...base })).hash).toBe(h);
  });

  it('un campo que el catálogo no tiene (costo, grupo en una unidad) rechaza sólo ese registro', async () => {
    const conCosto = await normalizarRegistro(
      'insumos',
      { origenSrId: 'I1', nombre: 'Leche', costo: '26.00' },
      0,
    );
    expect(conCosto.ok).toBe(false);
    const unidadConGrupo = await normalizarRegistro(
      'unidades',
      { origenSrId: 'KG', nombre: 'Kilogramo', grupoOrigenSrId: 'X' },
      0,
    );
    expect(unidadConGrupo.ok).toBe(false);
    for (const c of ['unidades', 'grupos_insumo', 'almacenes', 'proveedores'] as const) {
      expect(columnasDe(c)).toEqual(['clave', 'nombre', 'activoPos']);
      expect((await normalizarRegistro(c, { origenSrId: 'X1', nombre: 'Ñ "x"' }, 0)).ok).toBe(true);
    }
  });

  it('un grupo o unidad de más de 64 se rechaza sin repetir el valor', async () => {
    const largo = 'G'.repeat(65);
    const r = await normalizarRegistro(
      'insumos',
      { origenSrId: 'I1', nombre: 'Leche', grupoOrigenSrId: largo },
      3,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rechazo.motivo).toContain('registros.3.grupoOrigenSrId');
      expect(r.rechazo.motivo).not.toContain(largo);
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
    CATALOGOS.map((catalogo) => ({
      catalogo,
      recibidaAt: t,
    }));

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

  it('F2-120: los once catálogos cuentan; cerrar los seis de F2-230 no basta', () => {
    expect(CATALOGOS).toHaveLength(11);
    const seis = todos(T1).filter((r) =>
      ['grupos', 'productos', 'meseros', 'clientes', 'areas', 'canales'].includes(r.catalogo),
    );
    expect(solicitudPendiente(T1, seis)).toBe(true);
    for (const falta of ['unidades', 'grupos_insumo', 'insumos', 'almacenes', 'proveedores']) {
      expect(
        solicitudPendiente(
          T1,
          todos(T1).filter((r) => r.catalogo !== falta),
        ),
      ).toBe(true);
    }
  });
});
