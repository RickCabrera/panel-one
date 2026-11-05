import { createContext, useContext } from 'react';

import type { CSSProperties } from 'react';

import type { Estilo, Tema, Token, TokenAcento } from './paleta';
import type { PreferenciaTema } from './tema';

export interface ContextoTema {
  /** Lo que eligió la persona (claro, oscuro o sistema). */
  preferencia: PreferenciaTema;
  /** Lo que se ve (con "sistema", el del sistema operativo en este momento). */
  tema: Tema;
  elegir: (preferencia: PreferenciaTema) => void;
  /** UI-06: el estilo de la marca («Noche», por defecto, o «Clásico»). */
  estilo: Estilo;
  elegirEstilo: (estilo: Estilo) => void;
  /** Los colores del tema que se ve, para lo que no lee CSS (las gráficas de Recharts). */
  colores: Record<Token | TokenAcento, string>;
  /**
   * UI-06: el `style` de un marco negro (barra de arriba, cabecera del celular, login): en «Noche»
   * claro trae las variables de la paleta oscura; si no, `undefined`. Ver `zonaOscura`.
   */
  zonaOscura: CSSProperties | undefined;
}

export const TemaContexto = createContext<ContextoTema | null>(null);

export function useTema(): ContextoTema {
  const valor = useContext(TemaContexto);
  if (!valor) throw new Error('useTema fuera de <ProveedorTema>');
  return valor;
}
