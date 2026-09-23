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
