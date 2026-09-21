import { registerDecorator, type ValidationOptions } from 'class-validator';

/**
 * Las zonas que acepta una sucursal (F1-060): SÓLO los nombres IANA que el ICU
 * de Node lista (`America/Mexico_City`), comparados tal cual.
 *
 * `Intl.DateTimeFormat` a secas no alcanza: acepta offsets como `+05:00`, y
 * Postgres lee `'+05:00'` en `AT TIME ZONE` con la convención POSIX de signo
 * invertido. Los cortes de "hoy" de esa sucursal saldrían corridos 10 horas sin
 * que nada falle.
 */
const ZONAS: ReadonlySet<string> = new Set(Intl.supportedValuesOf('timeZone'));

export function esZonaIana(valor: unknown): valor is string {
  return typeof valor === 'string' && ZONAS.has(valor);
}

export function EsZonaIana(opciones?: ValidationOptions): PropertyDecorator {
  return (objeto: object, propiedad: string | symbol) => {
    registerDecorator({
      name: 'esZonaIana',
      target: objeto.constructor,
      propertyName: String(propiedad),
      options: {
        message: `${String(propiedad)} debe ser una zona IANA (p. ej. America/Mexico_City)`,
        ...opciones,
      },
      validator: { validate: esZonaIana },
    });
  };
}
