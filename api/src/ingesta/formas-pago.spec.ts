import {
  formaDeTipoSr,
  planearFormasPago,
  validarFormasPago,
  type FilaFormaPago,
  type FormaPagoSr,
} from './formas-pago';

// La parte pura del catálogo de formas de pago de SR (PAG-01). La escritura y el scope se
// prueban contra Postgres en `formas-pago.e2e.spec.ts`.

const SUC = 'f1011000-0000-4000-8000-0000000000a1';
const OTRA = 'f1011000-0000-4000-8000-0000000000a2';

const sr = (nombre: string, tipo: number | null, indice = 0): FormaPagoSr => ({
  indice,
  origenSrId: nombre.slice(0, 4),
  nombre,
  tipo,
});

const fila = (f: Partial<FilaFormaPago> & Pick<FilaFormaPago, 'formaRaw'>): FilaFormaPago => ({
  id: `id-${f.formaRaw}`,
  forma: 'otro',
  origen: 'pos',
  tipoSr: null,
  sucursalOrigenId: SUC,
  ...f,
});

describe('formaDeTipoSr (PAG-01)', () => {
  it.each([
    [1, 'efectivo'],
    [2, 'tarjeta'],
    [3, 'otro'],
    [4, 'otro'],
    [null, null],
    [0, null],
    [5, null],
  ] as const)('tipo %p → %p', (tipo, forma) => {
    expect(formaDeTipoSr(tipo)).toBe(forma);
  });

  it('nunca asigna transferencia: SR no tiene ese tipo', () => {
    const formas = [-1, 0, 1, 2, 3, 4, 5, 6, 99, null].map((t) => formaDeTipoSr(t));
    expect(formas).not.toContain('transferencia');
  });
});

describe('validarFormasPago (PAG-01)', () => {
  it('acepta tipo entero 1-4, nulo o ausente', async () => {
    const r = await validarFormasPago([
      { origenSrId: 'EF', nombre: 'EFECTIVO', tipo: 1 },
      { origenSrId: 'VISA', nombre: 'VISA', tipo: 2 },
      { origenSrId: 'VAL', nombre: 'VALES', tipo: 3 },
      { origenSrId: 'CR', nombre: 'CREDITO', tipo: 4 },
      { origenSrId: 'X', nombre: 'SIN TIPO', tipo: null },
      { origenSrId: 'Y', nombre: 'SIN COLUMNA' },
    ]);
    expect(r).toEqual({
      ok: true,
      rechazos: [],
      validos: [
        { indice: 0, origenSrId: 'EF', nombre: 'EFECTIVO', tipo: 1 },
        { indice: 1, origenSrId: 'VISA', nombre: 'VISA', tipo: 2 },
        { indice: 2, origenSrId: 'VAL', nombre: 'VALES', tipo: 3 },
        { indice: 3, origenSrId: 'CR', nombre: 'CREDITO', tipo: 4 },
        { indice: 4, origenSrId: 'X', nombre: 'SIN TIPO', tipo: null },
        { indice: 5, origenSrId: 'Y', nombre: 'SIN COLUMNA', tipo: null },
      ],
    });
  });

  it.each([
    ['cero', 0],
    ['cinco', 5],
    ['negativo', -1],
    ['decimal', 1.5],
    ['texto', '1'],
    ['booleano', true],
    ['objeto', { tipo: 1 }],
  ])('tipo %s → la página entera es inválida (400), sin repetir el valor', async (_, tipo) => {
    const r = await validarFormasPago([
      { origenSrId: 'EF', nombre: 'EFECTIVO', tipo: 1 },
      { origenSrId: 'VISA', nombre: 'VISA', tipo },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toMatch(/^registros\.1\.tipo: /);
    }
  });

  it('otro error (nombre vacío, campo de más) rechaza sólo ese registro', async () => {
    const r = await validarFormasPago([
      { origenSrId: 'EF', nombre: '', tipo: 1 },
      { origenSrId: 'VISA', nombre: 'VISA', tipo: 2, empresaId: 'x' },
      { origenSrId: 'MC', nombre: 'MASTERCARD', tipo: 2 },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.validos.map((v) => v.nombre)).toEqual(['MASTERCARD']);
      expect(r.rechazos.map((x) => [x.indice, x.origenSrId, x.reintentable])).toEqual([
        [0, 'EF', false],
        [1, 'VISA', false],
      ]);
      expect(r.rechazos[1].motivo).toContain('empresaId');
    }
  });
});

describe('planearFormasPago (PAG-01)', () => {
  it('crea las que no existen con la forma de su tipo; sin tipo no se clasifica', () => {
    const plan = planearFormasPago(
      [
        sr('EFECTIVO', 1),
        sr('VISA', 2),
        sr('DOLARES', 1),
        sr('VALES', 3),
        sr('CREDITO', 4),
        sr('RARA', null),
      ],
      [],
      SUC,
    );
    expect(plan.crear).toEqual([
      { formaRaw: 'EFECTIVO', forma: 'efectivo', tipoSr: 1 },
      { formaRaw: 'VISA', forma: 'tarjeta', tipoSr: 2 },
      { formaRaw: 'DOLARES', forma: 'efectivo', tipoSr: 1 },
      { formaRaw: 'VALES', forma: 'otro', tipoSr: 3 },
      { formaRaw: 'CREDITO', forma: 'otro', tipoSr: 4 },
    ]);
    expect(plan).toMatchObject({ actualizar: [], sinCambios: 0, sinTipo: 1, conflictos: [] });
  });

  it('una fila manual nunca se toca, diga lo que diga el POS', () => {
    const plan = planearFormasPago(
      [sr('VISA', 1), sr('TRANSFER', 4)],
      [
        fila({ formaRaw: 'VISA', forma: 'tarjeta', origen: 'manual', sucursalOrigenId: null }),
        fila({
          formaRaw: 'TRANSFER',
          forma: 'transferencia',
          origen: 'manual',
          sucursalOrigenId: null,
        }),
      ],
      SUC,
    );
    expect(plan).toMatchObject({ crear: [], actualizar: [], manuales: 2, sinCambios: 2 });
  });

  it('idempotente: con lo que dejó el plan, el mismo catálogo no escribe nada', () => {
    const pagina = [sr('EFECTIVO', 1), sr('VISA', 2), sr('VALES', 3)];
    const primero = planearFormasPago(pagina, [], SUC);
    const tras = primero.crear.map((c) => fila({ ...c, sucursalOrigenId: SUC }));
    const segundo = planearFormasPago(pagina, tras, SUC);
    expect(segundo).toEqual({
      crear: [],
      actualizar: [],
      sinCambios: 3,
      manuales: 0,
      sinTipo: 0,
      conflictos: [],
    });
  });

  it('el mismo POS cambia la clasificación de su fila pos → se actualiza', () => {
    const plan = planearFormasPago(
      [sr('VISA', 1)],
      [fila({ formaRaw: 'VISA', forma: 'tarjeta', tipoSr: 2 })],
      SUC,
    );
    expect(plan.actualizar).toEqual([{ id: 'id-VISA', forma: 'efectivo', tipoSr: 1 }]);
  });

  it('mismo POS, otro tipo con la misma forma (vales → otros) → sólo se corrige tipo_sr', () => {
    const plan = planearFormasPago(
      [sr('VALES', 4)],
      [fila({ formaRaw: 'VALES', forma: 'otro', tipoSr: 3 })],
      SUC,
    );
    expect(plan.actualizar).toEqual([{ id: 'id-VALES', forma: 'otro', tipoSr: 4 }]);
  });

  it('otra sucursal ya lo dio de alta con OTRA forma → conflicto, se deja como está', () => {
    const plan = planearFormasPago(
      [sr('VISA', 1)],
      [fila({ formaRaw: 'VISA', forma: 'tarjeta', tipoSr: 2, sucursalOrigenId: OTRA })],
      SUC,
    );
    expect(plan.crear).toEqual([]);
    expect(plan.actualizar).toEqual([]);
    expect(plan.conflictos).toEqual([
      { formaRaw: 'VISA', motivo: 'otra_sucursal', actual: 'tarjeta', pedidas: ['efectivo'] },
    ]);
  });

  it('otra sucursal con la MISMA forma (aunque otro tipo) → sin cambios, no se adueña', () => {
    const plan = planearFormasPago(
      [sr('VALES', 4)],
      [fila({ formaRaw: 'VALES', forma: 'otro', tipoSr: 3, sucursalOrigenId: OTRA })],
      SUC,
    );
    expect(plan).toMatchObject({ crear: [], actualizar: [], sinCambios: 1, conflictos: [] });
  });

  it('el mismo texto dos veces en el POS con formas distintas → conflicto, no se elige', () => {
    const plan = planearFormasPago([sr('TARJETA', 1, 0), sr('TARJETA', 2, 1)], [], SUC);
    expect(plan.crear).toEqual([]);
    expect(plan.conflictos).toEqual([
      { formaRaw: 'TARJETA', motivo: 'mismo_pos', actual: null, pedidas: ['efectivo', 'tarjeta'] },
    ]);
  });

  it('el mismo texto dos veces con la misma forma → una fila, con el tipo menor', () => {
    const plan = planearFormasPago([sr('VALES', 4, 0), sr('VALES', 3, 1)], [], SUC);
    expect(plan.crear).toEqual([{ formaRaw: 'VALES', forma: 'otro', tipoSr: 3 }]);
  });

  it('sin tipo no toca una fila que ya existe', () => {
    const plan = planearFormasPago(
      [sr('VISA', null)],
      [fila({ formaRaw: 'VISA', forma: 'tarjeta', tipoSr: 2 })],
      SUC,
    );
    expect(plan).toMatchObject({ crear: [], actualizar: [], sinCambios: 0, sinTipo: 1 });
  });

  it('match exacto del texto: "Visa" no es "VISA"', () => {
    const plan = planearFormasPago(
      [sr('Visa', 2)],
      [fila({ formaRaw: 'VISA', forma: 'efectivo', origen: 'manual' })],
      SUC,
    );
    expect(plan.crear).toEqual([{ formaRaw: 'Visa', forma: 'tarjeta', tipoSr: 2 }]);
  });
});
