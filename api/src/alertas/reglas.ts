import { SeveridadAlerta, TipoAlerta } from '@prisma/client';

/**
 * Las reglas del centro de alertas (F2-224): qué mide cada tipo, en qué unidad va su
 * umbral, en qué rango se acepta y con qué valor nace.
 */

export type UnidadUmbral = 'minutos' | 'porcentaje';

export interface DefinicionRegla {
  tipo: TipoAlerta;
  unidad: UnidadUmbral;
  minimo: number;
  maximo: number;
  /**
   * DECISION PROVISIONAL (nocturno): los valores por defecto salen de la ficha de F2-224
   * (> 10 min sin reportar, mesa > 60 min, sin imprimir > 30 min). El 30 % de caída de venta
   * no lo fija la ficha ("por encima de un umbral"): es una elección conservadora (no avisa
   * por cualquier bache), configurable por empresa. Ver docs/nocturno-log.md (F2-224).
   */
  porDefecto: number;
  /**
   * DECISION PROVISIONAL (nocturno): severidad fija por tipo. Una sucursal que no reporta
   * deja ciega a toda la vista (crítica); lo demás pide atención pero no ciega nada.
   */
  severidad: SeveridadAlerta;
}

/** En el orden en que se muestran. */
export const REGLAS: readonly DefinicionRegla[] = [
  {
    tipo: TipoAlerta.sucursal_sin_reporte,
    unidad: 'minutos',
    minimo: 1,
    maximo: 1440,
    porDefecto: 10,
    severidad: SeveridadAlerta.critica,
  },
  {
    tipo: TipoAlerta.mesa_abierta,
    unidad: 'minutos',
    minimo: 1,
    maximo: 1440,
    // El mismo borde que el semáforo rojo del Monitor (`semaforo()` en
    // web/src/paginas/mesas/reglas.ts: > 60 es rojo). `reglas.spec.ts` lo amarra.
    porDefecto: 60,
    severidad: SeveridadAlerta.advertencia,
  },
  {
    tipo: TipoAlerta.cuenta_sin_imprimir,
    unidad: 'minutos',
    minimo: 1,
    maximo: 1440,
    porDefecto: 30,
    severidad: SeveridadAlerta.advertencia,
  },
  {
    tipo: TipoAlerta.caida_venta,
    unidad: 'porcentaje',
    minimo: 1,
    maximo: 100,
    porDefecto: 30,
    severidad: SeveridadAlerta.advertencia,
  },
  {
    // F2-121. El umbral es el % DEL MÍNIMO de cada artículo: con 100 (el valor por defecto)
    // avisa en cuanto la existencia queda por debajo de su mínimo; con 50, sólo por debajo de
    // la mitad. DECISION PROVISIONAL (nocturno): unidad, rango y default son una elección
    // conservadora (la ficha sólo dice "artículo bajo mínimo"); advertencia, no crítica: no
    // ciega ninguna vista. Ver docs/nocturno-log.md (F2-121).
    tipo: TipoAlerta.bajo_minimo,
    unidad: 'porcentaje',
    minimo: 1,
    maximo: 100,
    porDefecto: 100,
    severidad: SeveridadAlerta.advertencia,
  },
];

export function definicion(tipo: TipoAlerta): DefinicionRegla {
  const d = REGLAS.find((r) => r.tipo === tipo);
  if (!d) {
    throw new Error(`Tipo de alerta sin regla: ${tipo}`);
  }
  return d;
}

/**
 * Edad máxima (s) del último snapshot de mesas para evaluar las alertas de mesa y de
 * cuenta. ESPEJO de `UMBRAL_DESCONEXION_S = 3 * INTERVALO_AGENTE_S` (90 s) de
 * web/src/paginas/mesas/reglas.ts: con un snapshot más viejo el Monitor ya no pinta esas
 * mesas, y aquí no se abren ni se cierran sus alertas. `reglas.spec.ts` lee el archivo del
 * web y falla si divergen.
 */
export const SNAPSHOT_VIVO_S = 90;

/**
 * DECISION PROVISIONAL (nocturno): la caída de venta sólo se evalúa si la base (el mismo día
 * de la semana pasada, a la misma altura) tiene al menos estas cuentas. Con menos, un
 * porcentaje no dice nada (1 cuenta contra 0 es "−100 %" en la primera hora del día).
 */
export const CUENTAS_BASE_MINIMAS = 5;

export interface ReglaEfectiva {
  tipo: TipoAlerta;
  activa: boolean;
  umbral: number;
  /** Sin fila guardada: la regla por defecto. */
  porDefecto: boolean;
}

/** Las reglas de una empresa: lo guardado, o la regla por defecto. */
export function reglasEfectivas(
  guardadas: ReadonlyArray<{ tipo: TipoAlerta; activa: boolean; umbral: number }>,
): ReglaEfectiva[] {
  return REGLAS.map((d) => {
    const g = guardadas.find((r) => r.tipo === d.tipo);
    return g
      ? { tipo: d.tipo, activa: g.activa, umbral: g.umbral, porDefecto: false }
      : { tipo: d.tipo, activa: true, umbral: d.porDefecto, porDefecto: true };
  });
}
