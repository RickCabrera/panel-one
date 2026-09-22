import type { FilaProducto } from '../../api/tipos';
import { pesos } from '../../dinero/dinero';

/** Cómo está el producto: en el POS y en la última sincronización completa. */
export function estadoProducto(f: Pick<FilaProducto, 'activo' | 'activoPos'>): string {
  if (!f.activo) return 'Ya no aparece en el POS';
  if (f.activoPos === false) return 'Baja en el POS';
  return 'Vigente';
}

/** El precio del POS, o "Sin precio" si no lo reporta: nunca un `$0.00` inventado. */
export function precioTexto(precio: string | null): string {
  return precio === null ? 'Sin precio' : pesos(precio);
}
