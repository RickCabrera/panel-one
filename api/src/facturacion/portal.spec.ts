import {
  esSlugValido,
  MAX_BYTES_LOGO,
  normalizarColor,
  tipoDeLogo,
  validarReceptor,
  type ReceptorPortal,
} from './portal';
import { esRfcValidoSat, USOS_CFDI, usoAplica } from './sat';

const BUENO: ReceptorPortal = {
  rfc: 'EKU9003173C9',
  razonSocial: 'ESCUELA KEMPER URGATE',
  regimenFiscal: '601',
  cp: '42501',
  usoCfdi: 'G03',
  email: 'facturas@ejemplo.mx',
};

describe('portal de autofactura: slug y marca (F2-103)', () => {
  it.each(['centro', 'demo-norte', 'suc-2', 'abc', 'a'.repeat(40)])('slug válido: %s', (s) => {
    expect(esSlugValido(s)).toBe(true);
  });

  it.each([
    'ab',
    'a'.repeat(41),
    'Centro',
    'demo_norte',
    '-centro',
    'centro-',
    'demo--norte',
    'centro norte',
    'sucursal/1',
    'ñandú',
    '',
  ])('slug inválido: %j', (s) => {
    expect(esSlugValido(s)).toBe(false);
  });

  it('color: normaliza a minúsculas y rechaza lo que no es #rrggbb', () => {
    expect(normalizarColor(' #0F766E ')).toBe('#0f766e');
    expect(normalizarColor('#abc')).toBeNull();
    expect(normalizarColor('0f766e')).toBeNull();
    expect(normalizarColor('red')).toBeNull();
    expect(normalizarColor('#0f766e; background:url(x)')).toBeNull();
  });
});

describe('portal: tipo del logo por sus bytes', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const webp = Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('WEBPVP8 '),
  ]);

  it('reconoce PNG, JPEG y WebP', () => {
    expect(tipoDeLogo(png)).toBe('image/png');
    expect(tipoDeLogo(jpeg)).toBe('image/jpeg');
    expect(tipoDeLogo(webp)).toBe('image/webp');
  });

  it('rechaza SVG (puede llevar script), GIF, texto y lo truncado', () => {
    expect(tipoDeLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(tipoDeLogo(Buffer.from('<?xml version="1.0"?><svg/>'))).toBeNull();
    expect(tipoDeLogo(Buffer.from('GIF89a......'))).toBeNull();
    expect(tipoDeLogo(Buffer.from('hola'))).toBeNull();
    expect(tipoDeLogo(png.subarray(0, 7))).toBeNull();
    expect(tipoDeLogo(Buffer.from('RIFF\0\0\0\0AVI '))).toBeNull();
    expect(tipoDeLogo(Buffer.alloc(0))).toBeNull();
  });

  it('el tope del logo es de 200 KB', () => {
    expect(MAX_BYTES_LOGO).toBe(204_800);
  });
});

describe('portal: RFC con la forma del SAT', () => {
  it.each(['EKU9003173C9', 'XIQB891116QE4', 'IIA040805DZ4', 'ÑAÑ010101AB1', 'A&C010101AB1'])(
    'válido: %s',
    (rfc) => expect(esRfcValidoSat(rfc)).toBe(true),
  );

  it.each([
    'EKU900317',
    'EKU9013173C9', // mes 13
    'EKU9002323C9', // día 32
    'EKU9000173C9', // mes 00
    'EKU9003003C9', // día 00
    'EKU9003173CZ', // verificador que no es dígito ni A
    'eku9003173c9', // sin normalizar
    'EKU9003173C9X',
    '1KU9003173C9',
  ])('inválido: %s', (rfc) => expect(esRfcValidoSat(rfc)).toBe(false));
});

describe('portal: catálogo c_UsoCFDI', () => {
  it('G03 aplica a moral 601 y a física 612 y 626, pero no a sueldos (605)', () => {
    expect(usoAplica('G03', '601', 'moral')).toBe(true);
    expect(usoAplica('G03', '612', 'fisica')).toBe(true);
    expect(usoAplica('G03', '626', 'fisica')).toBe(true);
    expect(usoAplica('G03', '605', 'fisica')).toBe(false);
  });

  it('S01 aplica a cualquier régimen; las deducciones personales sólo a física', () => {
    expect(usoAplica('S01', '616', 'fisica')).toBe(true);
    expect(usoAplica('S01', '601', 'moral')).toBe(true);
    expect(usoAplica('D01', '612', 'fisica')).toBe(true);
    expect(usoAplica('D01', '601', 'moral')).toBe(false);
    expect(usoAplica('CN01', '605', 'fisica')).toBe(true);
    expect(usoAplica('CN01', '612', 'fisica')).toBe(false);
  });

  it('un uso que no existe nunca aplica, y las claves son únicas', () => {
    expect(usoAplica('P01', '601', 'moral')).toBe(false); // P01 era de CFDI 3.3
    const claves = USOS_CFDI.map((u) => u.clave);
    expect(new Set(claves).size).toBe(claves.length);
  });
});

describe('portal: validarReceptor (campo por campo, en español)', () => {
  it('datos correctos: sin errores (el RFC se normaliza antes de validar)', () => {
    expect(validarReceptor(BUENO)).toEqual({});
    expect(validarReceptor({ ...BUENO, rfc: ' eku9003173c9 ' })).toEqual({});
  });

  it('todo vacío: un error por cada campo a la vez', () => {
    const e = validarReceptor({
      rfc: '',
      razonSocial: '  ',
      regimenFiscal: '',
      cp: '',
      usoCfdi: '',
      email: '',
    });
    expect(Object.keys(e).sort()).toEqual(
      ['cp', 'email', 'razonSocial', 'regimenFiscal', 'rfc', 'usoCfdi'].sort(),
    );
    expect(e.rfc).toBe('Escribe tu RFC.');
  });

  it('RFC genérico: se explica que hace falta el RFC propio', () => {
    expect(validarReceptor({ ...BUENO, rfc: 'XAXX010101000' }).rfc).toMatch(/público en general/);
    expect(validarReceptor({ ...BUENO, rfc: 'XEXX010101000' }).rfc).toMatch(/público en general/);
  });

  it('RFC con forma mala', () => {
    expect(validarReceptor({ ...BUENO, rfc: 'EKU9013173C9' }).rfc).toMatch(/forma correcta/);
  });

  it('régimen de física con RFC de empresa (y al revés)', () => {
    expect(validarReceptor({ ...BUENO, regimenFiscal: '612' }).regimenFiscal).toMatch(
      /persona física y tu RFC es de empresa/,
    );
    expect(
      validarReceptor({ ...BUENO, rfc: 'XIQB891116QE4', regimenFiscal: '601' }).regimenFiscal,
    ).toMatch(/persona moral y tu RFC es de persona física/);
  });

  it('uso que no aplica al régimen', () => {
    const e = validarReceptor({ ...BUENO, usoCfdi: 'D01' });
    expect(e).toEqual({
      usoCfdi: 'Ese uso no aplica a tu régimen fiscal. Elige otro de la lista.',
    });
  });

  it('con el régimen equivocado sólo se marca el régimen, no también el uso', () => {
    const e = validarReceptor({ ...BUENO, regimenFiscal: '612', usoCfdi: 'G03' });
    expect(Object.keys(e)).toEqual(['regimenFiscal']);
  });

  it('CP, razón social larga y correo', () => {
    expect(validarReceptor({ ...BUENO, cp: '4250' }).cp).toMatch(/5 dígitos/);
    expect(validarReceptor({ ...BUENO, cp: '4250a' }).cp).toMatch(/5 dígitos/);
    expect(validarReceptor({ ...BUENO, razonSocial: 'x'.repeat(255) }).razonSocial).toMatch(/254/);
    expect(validarReceptor({ ...BUENO, email: 'no-es-correo' }).email).toMatch(/forma correcta/);
    expect(validarReceptor({ ...BUENO, email: 'a b@c.mx' }).email).toMatch(/forma correcta/);
  });
});
