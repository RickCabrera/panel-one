/**
 * Recetas SINTÉTICAS del seed maestro (F2-201): cuánto de cada insumo consume
 * UNA unidad vendida del producto (un kg, si el producto se vende por kg). No es
 * un mapeo de SoftRestaurant (§10 de docs/esquema-sr.md sigue pendiente).
 *
 * El costo de cada receta cae entre el 20 % y el 45 % del precio de venta, para
 * que la utilidad de F2-126 sea verosímil; el spec lo afirma.
 */

export type Renglon = readonly [insumo: string, cantidad: string];

export const RECETAS: Readonly<Record<string, readonly Renglon[]>> = {
  P001: [
    ['I031', '0.150'],
    ['I024', '0.100'],
    ['I011', '0.030'],
    ['I014', '0.030'],
    ['I013', '0.100'],
  ],
  P002: [
    ['I013', '0.120'],
    ['I030', '0.060'],
    ['I021', '0.100'],
    ['I032', '0.080'],
    ['I014', '0.050'],
    ['I020', '0.050'],
  ],
  P003: [
    ['I041', '2'],
    ['I032', '0.100'],
    ['I010', '0.060'],
  ],
  P004: [
    ['I020', '0.250'],
    ['I021', '0.050'],
    ['I022', '0.030'],
    ['I023', '0.020'],
    ['I031', '0.080'],
  ],
  P005: [
    ['I030', '0.080'],
    ['I021', '0.120'],
    ['I011', '0.030'],
    ['I020', '0.040'],
    ['I010', '0.050'],
    ['I026', '0.030'],
  ],
  P006: [
    ['I010', '0.200'],
    ['I030', '0.060'],
  ],
  P007: [
    ['I025', '0.200'],
    ['I021', '0.060'],
    ['I022', '0.030'],
    ['I014', '0.040'],
    ['I020', '0.100'],
  ],
  P008: [
    ['I007', '0.100'],
    ['I023', '0.040'],
    ['I021', '0.040'],
    ['I030', '0.030'],
  ],
  P009: [
    ['I001', '0.150'],
    ['I030', '0.100'],
    ['I022', '0.020'],
    ['I023', '0.020'],
  ],
  P010: [
    ['I002', '0.150'],
    ['I030', '0.100'],
    ['I024', '0.120'],
    ['I011', '0.060'],
    ['I010', '0.050'],
  ],
  P011: [
    ['I002', '0.250'],
    ['I034', '0.080'],
    ['I033', '0.080'],
  ],
  P012: [
    ['I026', '0.250'],
    ['I005', '0.120'],
    ['I040', '0.050'],
    ['I011', '0.060'],
    ['I027', '0.080'],
  ],
  P013: [
    ['I006', '0.400'],
    ['I039', '0.030'],
    ['I033', '0.100'],
  ],
  P014: [
    ['I005', '0.200'],
    ['I035', '0.120'],
    ['I022', '0.030'],
  ],
  P015: [
    ['I003', '1.050'],
    ['I030', '0.200'],
    ['I020', '0.100'],
  ],
  P016: [['I004', '1.050']],
  P017: [
    ['I005', '1.100'],
    ['I030', '0.300'],
  ],
  P018: [
    ['I053', '0.080'],
    ['I037', '0.020'],
  ],
  P019: [
    ['I054', '0.030'],
    ['I037', '0.030'],
  ],
  // P020 (Refresco) y P021 (Cerveza nacional) quedan SIN receta a propósito: se
  // venden tal como se compran y nadie capturó su receta. F2-125 tiene que
  // listarlos aparte sin tronar.
  P022: [
    ['I052', '0.060'],
    ['I055', '0.020'],
    ['I023', '0.030'],
  ],
  P023: [
    ['I042', '0.030'],
    ['I043', '0.002'],
    ['I037', '0.015'],
  ],
  P024: [
    ['I013', '0.060'],
    ['I015', '0.100'],
    ['I016', '0.100'],
    ['I037', '0.020'],
  ],
  P025: [
    ['I036', '0.100'],
    ['I039', '0.050'],
    ['I038', '0.040'],
    ['I012', '0.200'],
    ['I037', '0.020'],
  ],
  P026: [
    ['I036', '0.060'],
    ['I013', '0.050'],
    ['I015', '0.100'],
    ['I016', '0.080'],
    ['I012', '0.100'],
  ],
};

/**
 * Desechables por cheque según el canal (no dependen del producto): un
 * contenedor por cuenta para llevar y una bolsa por pedido a domicilio.
 */
export const DESECHABLES_POR_CANAL: Readonly<Record<string, readonly Renglon[]>> = {
  comedor: [],
  mostrador: [['I060', '1']],
  domicilio: [
    ['I060', '1'],
    ['I061', '1'],
  ],
};
