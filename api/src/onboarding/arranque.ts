import type { ClavePaso } from './dto/onboarding.dto';

/**
 * El checklist de arranque de una empresa (F2-147), como función PURA de lo que ya está en la
 * base. No hay tabla de "pasos hechos": un estado guardado aparte se desincroniza (una sucursal
 * nueva sin key volvería a dejar pendiente algo que la tabla diría hecho). Aquí cada paso se
 * DEDUCE, así que la tarjeta desaparece sola cuando la empresa está lista, y vuelve si deja de
 * estarlo.
 */

export interface SucursalArranque {
  id: string;
  nombre: string;
  tieneKey: boolean;
  agenteReporto: boolean;
  tieneVentas: boolean;
}

export interface EntradaArranque {
  /** Sólo las sucursales ACTIVAS: una dada de baja no bloquea el arranque. */
  sucursales: SucursalArranque[];
  adminsEmpresa: number;
}

export interface PasoArranque {
  clave: ClavePaso;
  titulo: string;
  hecho: boolean;
  detalle: string;
  pendientes: { sucursalId: string; nombre: string }[];
}

function faltan(
  sucursales: SucursalArranque[],
  cumple: (s: SucursalArranque) => boolean,
): { sucursalId: string; nombre: string }[] {
  return sucursales.filter((s) => !cumple(s)).map((s) => ({ sucursalId: s.id, nombre: s.nombre }));
}

function cuantas(n: number, total: number): string {
  return `${n} de ${total} ${total === 1 ? 'sucursal' : 'sucursales'}`;
}

export function calcularArranque({ sucursales, adminsEmpresa }: EntradaArranque): {
  completo: boolean;
  pasos: PasoArranque[];
} {
  const total = sucursales.length;
  const hay = total > 0;

  const sinKey = faltan(sucursales, (s) => s.tieneKey);
  const sinAgente = faltan(sucursales, (s) => s.agenteReporto);
  const sinVentas = faltan(sucursales, (s) => s.tieneVentas);
  // Ventas sin que ningún agente haya reportado: datos de demostración (el seed) o de un agente
  // que ya no existe. La tarjeta lo dice, en vez de mostrar "ventas: hecho" como si todo fluyera.
  const ventasSinAgente = sucursales.some((s) => s.tieneVentas && !s.agenteReporto);

  const pasos: PasoArranque[] = [
    {
      clave: 'sucursales',
      titulo: 'Dar de alta las sucursales',
      hecho: hay,
      detalle: hay
        ? `${total} ${total === 1 ? 'sucursal activa' : 'sucursales activas'}.`
        : 'La empresa no tiene ninguna sucursal activa todavía.',
      pendientes: [],
    },
    {
      clave: 'llaves',
      titulo: 'Generar la API key de cada sucursal',
      hecho: hay && sinKey.length === 0,
      detalle: !hay
        ? 'Primero hace falta una sucursal.'
        : sinKey.length === 0
          ? 'Todas las sucursales tienen su key.'
          : `Falta la key en ${cuantas(sinKey.length, total)}.`,
      pendientes: sinKey,
    },
    {
      clave: 'agente',
      titulo: 'Instalar el agente en cada sucursal',
      hecho: hay && sinAgente.length === 0,
      detalle: !hay
        ? 'Primero hace falta una sucursal.'
        : sinAgente.length === 0
          ? 'El agente de cada sucursal ya se reportó con el panel.'
          : `El agente todavía no se reporta en ${cuantas(sinAgente.length, total)}.`,
      pendientes: sinAgente,
    },
    {
      clave: 'ventas',
      titulo: 'Recibir la primera venta',
      hecho: hay && sinVentas.length === 0,
      detalle: !hay
        ? 'Primero hace falta una sucursal.'
        : sinVentas.length > 0
          ? `Todavía no llega ninguna cuenta en ${cuantas(sinVentas.length, total)}. Llega sola ` +
            'cuando el agente lee la primera cuenta cerrada del POS.'
          : ventasSinAgente
            ? 'Hay ventas registradas, pero de sucursales cuyo agente nunca se ha reportado: ' +
              'son datos de demostración o de un agente anterior.'
            : 'Ya llegan las cuentas de cada sucursal.',
      pendientes: sinVentas,
    },
    {
      clave: 'usuario',
      titulo: 'Crear el usuario administrador de la empresa',
      hecho: adminsEmpresa > 0,
      detalle:
        adminsEmpresa > 0
          ? `${adminsEmpresa} ${adminsEmpresa === 1 ? 'administrador activo' : 'administradores activos'}.`
          : 'Nadie de la empresa puede entrar a administrarla todavía.',
      pendientes: [],
    },
  ];

  return { completo: pasos.every((p) => p.hecho), pasos };
}
