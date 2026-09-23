/**
 * Catálogos y formatos del SAT que usa el perfil fiscal (F2-100). Puro, sin base.
 *
 * c_RegimenFiscal del Anexo 20 (CFDI 4.0) con su columna "aplica a persona física / moral". Es
 * lo que el SAT publica; si cambia el catálogo, se cambia aquí y en `web/src/paginas/facturacion`.
 */

export type TipoPersona = 'moral' | 'fisica';

export interface RegimenFiscal {
  clave: string;
  descripcion: string;
  fisica: boolean;
  moral: boolean;
}

export const REGIMENES_FISCALES: readonly RegimenFiscal[] = [
  { clave: '601', descripcion: 'General de Ley Personas Morales', fisica: false, moral: true },
  {
    clave: '603',
    descripcion: 'Personas Morales con Fines no Lucrativos',
    fisica: false,
    moral: true,
  },
  {
    clave: '605',
    descripcion: 'Sueldos y Salarios e Ingresos Asimilados a Salarios',
    fisica: true,
    moral: false,
  },
  { clave: '606', descripcion: 'Arrendamiento', fisica: true, moral: false },
  {
    clave: '607',
    descripcion: 'Régimen de Enajenación o Adquisición de Bienes',
    fisica: true,
    moral: false,
  },
  { clave: '608', descripcion: 'Demás ingresos', fisica: true, moral: false },
  {
    clave: '610',
    descripcion: 'Residentes en el Extranjero sin Establecimiento Permanente en México',
    fisica: true,
    moral: true,
  },
  {
    clave: '611',
    descripcion: 'Ingresos por Dividendos (socios y accionistas)',
    fisica: true,
    moral: false,
  },
  {
    clave: '612',
    descripcion: 'Personas Físicas con Actividades Empresariales y Profesionales',
    fisica: true,
    moral: false,
  },
  { clave: '614', descripcion: 'Ingresos por intereses', fisica: true, moral: false },
  {
    clave: '615',
    descripcion: 'Régimen de los ingresos por obtención de premios',
    fisica: true,
    moral: false,
  },
  { clave: '616', descripcion: 'Sin obligaciones fiscales', fisica: true, moral: false },
  {
    clave: '620',
    descripcion: 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos',
    fisica: false,
    moral: true,
  },
  { clave: '621', descripcion: 'Incorporación Fiscal', fisica: true, moral: false },
  {
    clave: '622',
    descripcion: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras',
    fisica: false,
    moral: true,
  },
  { clave: '623', descripcion: 'Opcional para Grupos de Sociedades', fisica: false, moral: true },
  { clave: '624', descripcion: 'Coordinados', fisica: false, moral: true },
  {
    clave: '625',
    descripcion: 'Actividades Empresariales con ingresos a través de Plataformas Tecnológicas',
    fisica: true,
    moral: false,
  },
  { clave: '626', descripcion: 'Régimen Simplificado de Confianza', fisica: true, moral: true },
  { clave: '628', descripcion: 'Hidrocarburos', fisica: false, moral: true },
  {
    clave: '629',
    descripcion: 'De los Regímenes Fiscales Preferentes y de las Empresas Multinacionales',
    fisica: true,
    moral: false,
  },
  {
    clave: '630',
    descripcion: 'Enajenación de acciones en bolsa de valores',
    fisica: true,
    moral: false,
  },
];

/** RFC genéricos: público en general y extranjeros. No son un emisor ni un cliente identificable. */
export const RFC_GENERICOS: readonly string[] = ['XAXX010101000', 'XEXX010101000'];

/** 3 letras (moral) o 4 (física), fecha AAMMDD y homoclave de 3. */
const RFC_MORAL = /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/;
const RFC_FISICA = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/;

/** El RFC como se compara y se guarda: sin espacios alrededor y en mayúsculas. */
export function normalizarRfc(rfc: string): string {
  return rfc.trim().toLocaleUpperCase('es-MX');
}

/** Moral o física según el formato; null si no es un RFC con forma válida. */
export function tipoPersona(rfc: string): TipoPersona | null {
  if (RFC_MORAL.test(rfc)) return 'moral';
  if (RFC_FISICA.test(rfc)) return 'fisica';
  return null;
}

/** ¿El régimen existe y aplica a ese tipo de persona? */
export function regimenAplica(clave: string, tipo: TipoPersona): boolean {
  const r = REGIMENES_FISCALES.find((x) => x.clave === clave);
  return r !== undefined && (tipo === 'moral' ? r.moral : r.fisica);
}

/**
 * La forma del RFC del receptor que valida el SAT en CFDI 4.0 (Anexo 20, patrón de
 * `Receptor/@Rfc` sin los genéricos): 3 letras (moral) o 4 (física), fecha AAMMDD con mes y día
 * posibles, y homoclave de 2 alfanuméricos más un dígito verificador (0–9 o A). Más estricta que
 * `tipoPersona`, que sólo mira la forma general.
 */
const RFC_SAT = /^[A-ZÑ&]{3,4}\d{2}(0[1-9]|1[012])(0[1-9]|[12]\d|3[01])[A-Z0-9]{2}[0-9A]$/;

/** ¿El RFC (ya normalizado) tiene la forma que exige el SAT? */
export function esRfcValidoSat(rfc: string): boolean {
  return RFC_SAT.test(rfc);
}

export interface UsoCfdi {
  clave: string;
  descripcion: string;
  fisica: boolean;
  moral: boolean;
  /** Claves de c_RegimenFiscal del receptor con las que el SAT acepta este uso. */
  regimenes: readonly string[];
}

/** Los regímenes con actividad que deduce gastos e inversiones (G01–G03, I01–I08). */
const REGIMENES_ACTIVIDAD = [
  '601',
  '603',
  '606',
  '612',
  '620',
  '621',
  '622',
  '623',
  '624',
  '625',
  '626',
] as const;
/** Los de persona física que pueden aplicar deducciones personales (D01–D10). */
const REGIMENES_PERSONALES = [
  '605',
  '606',
  '607',
  '608',
  '611',
  '612',
  '614',
  '615',
  '625',
] as const;
/** Todos los del catálogo: "Sin efectos fiscales" (S01) y "Pagos" (CP01) aplican a cualquiera. */
const TODOS_LOS_REGIMENES = REGIMENES_FISCALES.map((r) => r.clave);

const actividad = (clave: string, descripcion: string): UsoCfdi => ({
  clave,
  descripcion,
  fisica: true,
  moral: true,
  regimenes: REGIMENES_ACTIVIDAD,
});
const personal = (clave: string, descripcion: string): UsoCfdi => ({
  clave,
  descripcion,
  fisica: true,
  moral: false,
  regimenes: REGIMENES_PERSONALES,
});

/**
 * c_UsoCFDI del Anexo 20 (CFDI 4.0) con su columna "aplica a física / moral" y los regímenes del
 * receptor con que es compatible. Es lo que el SAT publica; si cambia el catálogo, se cambia aquí
 * (la web lo lee de `GET /facturacion/usos-cfdi`). Para un consumo de restaurante lo común es
 * G03 o S01, pero el SAT acepta el catálogo completo y el portal no inventa restricciones.
 */
export const USOS_CFDI: readonly UsoCfdi[] = [
  actividad('G01', 'Adquisición de mercancías'),
  actividad('G02', 'Devoluciones, descuentos o bonificaciones'),
  actividad('G03', 'Gastos en general'),
  actividad('I01', 'Construcciones'),
  actividad('I02', 'Mobiliario y equipo de oficina por inversiones'),
  actividad('I03', 'Equipo de transporte'),
  actividad('I04', 'Equipo de cómputo y accesorios'),
  actividad('I05', 'Dados, troqueles, moldes, matrices y herramental'),
  actividad('I06', 'Comunicaciones telefónicas'),
  actividad('I07', 'Comunicaciones satelitales'),
  actividad('I08', 'Otra maquinaria y equipo'),
  personal('D01', 'Honorarios médicos, dentales y gastos hospitalarios'),
  personal('D02', 'Gastos médicos por incapacidad o discapacidad'),
  personal('D03', 'Gastos funerales'),
  personal('D04', 'Donativos'),
  personal(
    'D05',
    'Intereses reales efectivamente pagados por créditos hipotecarios (casa habitación)',
  ),
  personal('D06', 'Aportaciones voluntarias al SAR'),
  personal('D07', 'Primas por seguros de gastos médicos'),
  personal('D08', 'Gastos de transportación escolar obligatoria'),
  personal(
    'D09',
    'Depósitos en cuentas para el ahorro, primas que tengan como base planes de pensiones',
  ),
  personal('D10', 'Pagos por servicios educativos (colegiaturas)'),
  {
    clave: 'S01',
    descripcion: 'Sin efectos fiscales',
    fisica: true,
    moral: true,
    regimenes: TODOS_LOS_REGIMENES,
  },
  {
    clave: 'CP01',
    descripcion: 'Pagos',
    fisica: true,
    moral: true,
    regimenes: TODOS_LOS_REGIMENES,
  },
  {
    clave: 'CN01',
    descripcion: 'Nómina',
    fisica: true,
    moral: false,
    regimenes: ['605'],
  },
];

/** ¿El uso existe y el SAT lo acepta para ese régimen y tipo de persona del receptor? */
export function usoAplica(clave: string, regimen: string, tipo: TipoPersona): boolean {
  const u = USOS_CFDI.find((x) => x.clave === clave);
  return (
    u !== undefined && (tipo === 'moral' ? u.moral : u.fisica) && u.regimenes.includes(regimen)
  );
}
