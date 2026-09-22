import { createContext, useContext } from 'react';

import type { Tema, Token, TokenAcento } from './paleta';
import type { PreferenciaTema } from './tema';

export interface ContextoTema {
  /** Lo que eligió la persona (claro, oscuro o sistema). */
  preferencia: PreferenciaTema;
  /** Lo que se ve (con "sistema", el del sistema operativo en este momento). */
  tema: Tema;
  elegir: (preferencia: PreferenciaTema) => void;
  /** Los colores del tema que se ve, para lo que no lee CSS (las gráficas de Recharts). */
  colores: Record<Token | TokenAcento, string>;
}

export const TemaContexto = createContext<ContextoTema | null>(null);

export function useTema(): ContextoTema {
  const valor = useContext(TemaContexto);
  if (!valor) throw new Error('useTema fuera de <ProveedorTema>');
  return valor;
}
