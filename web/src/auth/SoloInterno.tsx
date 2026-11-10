import type { ReactNode } from 'react';

import { OCULTAR_A_CLIENTES } from './mvp';
import { ROLES_INTERNOS } from './roles';
import { RequiereRol } from './RutaProtegida';

/**
 * Vista oculta del MVP (ver `mvp.ts`): a un cliente que llega por URL le sale "No encontrada",
 * igual que cualquier vista restringida. Con el interruptor apagado, pasa directo.
 */
export function SoloInterno({ children }: { children: ReactNode }) {
  if (!OCULTAR_A_CLIENTES) return children;
  return <RequiereRol roles={ROLES_INTERNOS}>{children}</RequiereRol>;
}
