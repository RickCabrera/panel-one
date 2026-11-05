import { useCuenta } from './cuenta';

/**
 * La cifra animada ya con su formato. `valor` null = no hay número que contar (se pinta
 * `sinValor`: "Sin dato", "—"...).
 */
export function CifraAnimada({
  valor,
  formato,
  sinValor,
}: {
  valor: bigint | null;
  formato: (v: bigint) => string;
  sinValor: string;
}) {
  const visto = useCuenta(valor);
  return <>{visto === null ? sinValor : formato(visto)}</>;
}
