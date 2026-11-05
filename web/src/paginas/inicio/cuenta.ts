import { useEffect, useState } from 'react';

import { prefiereMovimiento } from '../../tema/movimiento';

/** Cuánto dura el conteo de una cifra que cambia. */
export const DURACION_CONTEO_MS = 650;

/** Escala entera del avance (milésimas): la interpolación es toda en `bigint`. */
const ESCALA = 1000n;
const COMPLETO = 1000;

interface Estado {
  objetivo: bigint | null;
  /** Desde dónde cuenta la animación en curso; `null` = no se anima (se ve el objetivo). */
  desde: bigint | null;
  /** Cambia con cada objetivo nuevo: arranca la animación. */
  vuelta: number;
}

/** Lo que se ve con un avance dado (0..1000): siempre `bigint`, redondeado hacia `desde`. */
export function intermedio(desde: bigint, objetivo: bigint, avance: number): bigint {
  if (avance >= COMPLETO) return objetivo;
  return desde + ((objetivo - desde) * BigInt(Math.max(0, avance))) / ESCALA;
}

function mostrado(estado: Estado, avance: number): bigint | null {
  if (estado.objetivo === null || estado.desde === null) return estado.objetivo;
  return intermedio(estado.desde, estado.objetivo, avance);
}

/**
 * UI-05: una cifra que «cuenta» del valor anterior al nuevo cuando cambia (el refresco de
 * cada minuto, el socket del en vivo). La primera vez se ve el valor tal cual, sin contar
 * desde cero: el dato no se esconde detrás de un efecto.
 *
 * Todo es `bigint` (centavos, o unidades en los conteos): ningún importe pasa por un float.
 * El avance de la curva es un entero de 0 a 1000. Al terminar se ve EXACTAMENTE el objetivo.
 *
 * Con «reducir movimiento» (o sin `matchMedia`) no hay conteo: cambia de golpe.
 */
export function useCuenta(objetivo: bigint | null): bigint | null {
  const [estado, setEstado] = useState<Estado>({ objetivo, desde: null, vuelta: 0 });
  const [avance, setAvance] = useState(COMPLETO);

  // Ajuste de estado durante el render (el patrón de React para «derivar de una prop que
  // cambió»): el mismo render que recibe el objetivo nuevo ya pinta el punto de partida.
  if (estado.objetivo !== objetivo) {
    const animar = estado.objetivo !== null && objetivo !== null && prefiereMovimiento();
    setEstado({
      objetivo,
      desde: animar ? mostrado(estado, avance) : null,
      vuelta: estado.vuelta + 1,
    });
    setAvance(animar ? 0 : COMPLETO);
  }

  useEffect(() => {
    if (estado.desde === null) return;
    let cuadro = 0;
    const inicio = performance.now();
    const paso = (ahora: number) => {
      const t = Math.min(1, (ahora - inicio) / DURACION_CONTEO_MS);
      // ease-out cúbica: arranca rápido y se asienta en la cifra.
      const curva = 1 - (1 - t) ** 3;
      setAvance(t >= 1 ? COMPLETO : Math.round(curva * COMPLETO));
      if (t < 1) cuadro = requestAnimationFrame(paso);
    };
    cuadro = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(cuadro);
  }, [estado.vuelta, estado.desde]);

  return mostrado(estado, avance);
}
