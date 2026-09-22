import type { FilaResumenCliente, ResumenClientes, SucursalClientes } from '../../api/tipos';
import { PARAMS_FILTRO } from '../../filtros/tickets';
import { queryVista } from '../../filtros/vista';

/**
 * Reglas y textos de Clientes (F2-232), fuera del componente para probarlos solos. Ningún texto
 * afirma más de lo que se sabe: un catálogo que llegó vacío puede ser un POS que no usa
 * clientes o una lectura que falló.
 */

/** Cómo se nombra una fila: su nombre, o el id del POS si no hay ficha. */
export function nombreFila(f: FilaResumenCliente): string {
  return f.nombre ?? `Id del POS ${f.origenSrId}`;
}

export function estadoFila(f: FilaResumenCliente): string {
  if (f.cruce === 'sin-ficha') return 'Sin ficha en el catálogo';
  if (f.cruce === 'sin-sincronizar') return 'Catálogo de la sucursal sin sincronizar';
  if (f.activo === false) return 'Ya no está en el catálogo del POS';
  if (f.activoPos === false) return 'Dado de baja en el POS';
  return 'En el catálogo';
}

export type Vacio =
  | { tipo: 'hay' }
  /** Ninguna sucursal tiene clientes ni cuentas con cliente: se explica por qué y qué falta. */
  | { tipo: 'sin-clientes'; porque: string; falta: string };

const lista = (s: readonly SucursalClientes[]) => s.map((x) => x.sucursal).join(', ');

/** Si la vista está vacía, el porqué (por sucursal) y qué haría falta para llenarla. */
export function vacio(r: ResumenClientes): Vacio {
  if (r.usaClientes) return { tipo: 'hay' };
  const sinSincronizar = r.sucursales.filter((s) => s.catalogo === 'sin-sincronizar');
  const vacias = r.sucursales.filter((s) => s.catalogo === 'vacio');
  const partes: string[] = [];
  if (vacias.length > 0) {
    partes.push(
      `El catálogo de clientes de ${lista(vacias)} llegó vacío y ninguna cuenta del periodo trae cliente.`,
    );
  }
  if (sinSincronizar.length > 0) {
    partes.push(
      `${lista(sinSincronizar)} ${sinSincronizar.length === 1 ? 'todavía no ha enviado' : 'todavía no han enviado'} su catálogo de clientes, y ninguna cuenta del periodo trae cliente.`,
    );
  }
  if (partes.length === 0) {
    partes.push('Ninguna sucursal del alcance tiene clientes ni cuentas con cliente.');
  }
  return {
    tipo: 'sin-clientes',
    porque: partes.join(' '),
    falta:
      'Para llenar esta vista hace falta que el POS capture al cliente en la cuenta (es lo común ' +
      'en domicilio y para facturar) y que el agente de la sucursal esté conectado leyendo el ' +
      'catálogo de clientes. Si en el POS sí se capturan clientes, revisa la lectura del agente: ' +
      'un catálogo vacío también puede ser una lectura que falló.',
  };
}

/** Sucursales con clientes en el catálogo pero ninguna cuenta del periodo que traiga cliente. */
export function sinCuentasConCliente(r: ResumenClientes): SucursalClientes[] {
  return r.sucursales.filter((s) => s.clientesActivos > 0 && s.cuentasConCliente === 0);
}

/** "3 de 40 cuentas (7.5 %)", con un decimal, sin float para el conteo. */
export function participacion(con: number, de: number): string {
  if (de === 0) return 'sin cuentas en el periodo';
  const porMil = Math.round((con * 1000) / de);
  return `${con} de ${de} cuenta${de === 1 ? '' : 's'} (${Math.trunc(porMil / 10)}.${porMil % 10} %)`;
}

/**
 * El enlace a Tickets con las cuentas de ESE cliente: mismo alcance y periodo, y sin las
 * canceladas, para que el conteo de Tickets sea el de sus visitas. Sólo el id, nunca el nombre.
 */
export function enlaceTickets(parametros: URLSearchParams, id: string) {
  const search = new URLSearchParams(queryVista(parametros).replace(/^\?/, ''));
  search.set(PARAMS_FILTRO.cliente, id);
  search.set(PARAMS_FILTRO.canceladas, 'excluir');
  return { pathname: '/tickets', search: `?${search.toString()}` };
}
