/** El mayor de cada sucursal, para las barras. */
export function maximosPorSucursal<T>(
  filas: readonly T[],
  sucursal: (f: T) => string,
  valor: (f: T) => bigint | null,
): Map<string, bigint> {
  const maximos = new Map<string, bigint>();
  for (const f of filas) {
    const v = valor(f);
    if (v === null) continue;
    const actual = maximos.get(sucursal(f));
    if (actual === undefined || v > actual) maximos.set(sucursal(f), v);
  }
  return maximos;
}
