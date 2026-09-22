import type { MesasSucursal, VentaSucursal } from '../../api/tipos';
import { aCentavos } from '../../dinero/dinero';
import { ventaEnVivo } from '../inicio/ventaEnVivo';

/** Lo que necesita `avisoIncompleta` de la consulta de mesas. */
interface ConsultaMesas {
  data: MesasSucursal[] | undefined;
  dataUpdatedAt: number;
}

/**
 * Por qué la venta de hoy puede estar incompleta: una sucursal que no reporta no ha mandado
 * lo que cerró, así que su Δ baja sin que la venta haya caído (la base sí va completa hasta
 * esta hora). No se corrige la cifra: se dice.
 */
export function avisoIncompleta(mesas: ConsultaMesas, ahora: number): string | null {
  if (!mesas.data) return null;
  const vivo = ventaEnVivo(mesas.data, mesas.dataUpdatedAt, ahora);
  const fuera = [...vivo.desconectadas, ...vivo.sinReporte];
  if (fuera.length === 0) return null;
  return `Sin lectura reciente de ${fuera.join(', ')}: lo que haya cerrado después todavía no llega, y el Δ puede salir más bajo de lo real.`;
}

/** Mejor y peor sucursal por venta: sólo entre las que vendieron. */
export function mejorYPeor(filas: readonly VentaSucursal[]) {
  const conVenta = filas
    .filter((f) => f.cuentas > 0)
    .map((f) => ({ fila: f, centavos: aCentavos(f.venta) }));
  const legibles = conVenta.filter(
    (x): x is { fila: VentaSucursal; centavos: bigint } => x.centavos !== null,
  );
  // Orden por venta y, en empate, por nombre: el mismo resultado en cada render.
  legibles.sort((a, b) =>
    a.centavos === b.centavos
      ? a.fila.nombre.localeCompare(b.fila.nombre, 'es')
      : a.centavos > b.centavos
        ? -1
        : 1,
  );
  return {
    mejor: legibles[0]?.fila ?? null,
    peor: legibles.length > 1 ? legibles[legibles.length - 1].fila : null,
    sinVenta: filas.filter((f) => f.cuentas === 0).map((f) => f.nombre),
    ilegibles: conVenta.filter((x) => x.centavos === null).map((x) => x.fila.nombre),
  };
}
