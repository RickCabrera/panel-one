import { describe, expect, it } from 'vitest';

import { contraste } from '../../tema/contraste';
import { ESTILOS, PALETAS, type Tema } from '../../tema/paleta';

// El mapa de calor de Análisis (F2-221) en los dos temas. Lo que distingue "sin ventas", "cero
// pesos" y "no está en el periodo" NO es el color del relleno (regla de F2-211):
// - "0" y "—" son TEXTO `tinta-medio` sobre `superficie` → contraste de texto, 4.5:1;
// - "sin ventas" es una celda vacía con borde punteado `tinta-tenue` → contraste de un
//   componente gráfico (WCAG 1.4.11), 3:1 contra `superficie`.
// La intensidad del relleno (`serie-1` por quintil) sólo ordena de menos a más venta, y cada
// celda lleva la cifra en su etiqueta accesible. Si algún día una de estas cuentas no alcanza,
// se cambia el token de la celda, no este mínimo.

const TEMAS: Tema[] = ['claro', 'oscuro'];
// UI-06: en los dos estilos de marca.
const CASOS = ESTILOS.flatMap((estilo) => TEMAS.map((tema) => [estilo, tema] as const));

describe('contraste del mapa de calor (F2-221)', () => {
  it.each(CASOS)('estilo %s, tema %s: "0" y "—" se leen (≥ 4.5:1)', (estilo, tema) => {
    const p = PALETAS[estilo][tema];
    expect(contraste(p['tinta-medio'], p.superficie)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(CASOS)('estilo %s, tema %s: el borde punteado de "sin ventas" se ve (≥ 3:1)', (estilo, tema) => {
    const p = PALETAS[estilo][tema];
    expect(contraste(p['tinta-tenue'], p.superficie)).toBeGreaterThanOrEqual(3);
  });
});
