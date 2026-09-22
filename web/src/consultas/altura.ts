/**
 * El corte "a la misma altura" (`alturaAl`, F2-220) en las llaves de React Query.
 *
 * - Sin `alturaAl`, la llave es EXACTAMENTE la de antes: Inicio y Reportes conservan su
 *   caché y la comparten con el Resumen.
 * - Con él, va al final. Como cambia cada minuto, la consulta de comparación cambia de llave
 *   cada minuto; `mantenerSiSoloCambiaLaAltura` deja ver el dato del minuto anterior mientras
 *   llega el nuevo, pero SÓLO si lo único que cambió fue la altura: con otra empresa,
 *   sucursal o periodo no se pinta el dato viejo bajo el título nuevo.
 */
export function llaveConAltura(base: readonly unknown[], alturaAl: string | undefined): unknown[] {
  return alturaAl === undefined ? [...base] : [...base, alturaAl];
}

export function mantenerSiSoloCambiaLaAltura<T>(
  anterior: T | undefined,
  llaveAnterior: readonly unknown[] | undefined,
  llave: readonly unknown[],
  alturaAl: string | undefined,
): T | undefined {
  if (alturaAl === undefined || anterior === undefined || llaveAnterior === undefined) {
    return undefined;
  }
  if (llaveAnterior.length !== llave.length) return undefined;
  const sinAltura = (k: readonly unknown[]) => JSON.stringify(k.slice(0, -1));
  return sinAltura(llaveAnterior) === sinAltura(llave) ? anterior : undefined;
}
