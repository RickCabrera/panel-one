import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  entradaActiva,
  guardarColapsadas,
  leerColapsadas,
  searchDestino,
  SECCIONES,
  seccionesPara,
  SIN_TAREA,
  type EntradaMenu,
} from './menu';

// El mapa del producto de F2-210, compactado en UI-02 (5-nov-2026): sin las cuatro entradas
// «Pronto» sin tarea (D-01), sin la sección Canales de una sola entrada (Ventas por canal vive en
// Ventas y dirección) y con «Comensales» en vez de «Clientes» (los clientes del POS).
const FICHA: [string, string[]][] = [
  ['Principal', ['Inicio', 'Comparativos']],
  // MVP: "Cortes" (turnos de SR) junto a Tickets.
  [
    'Ventas y dirección',
    [
      'Resumen',
      'Tickets',
      'Cortes',
      'Monitor de mesas',
      'Análisis',
      'Ventas por canal',
      'Reportes',
    ],
  ],
  [
    'Catálogos',
    [
      'Productos',
      'Orquestador de menú',
      'Meseros',
      'Comensales',
      // F2-233: el mapeo área → canal vive en su propia vista de catálogo.
      'Áreas y canales',
    ],
  ],
  [
    'Inventario y compras',
    [
      'Existencias',
      // F2-122: la línea de tiempo de pólizas y el kardex por artículo.
      'Movimientos y kardex',
      'Conteos físicos',
      'Recetas',
      'Proyecciones',
      'Compras',
      'Gastos y utilidad',
      'Traspasos',
    ],
  ],
  ['Administración', ['Sucursales', 'Usuarios', 'Agentes', 'Empresas', 'Facturación']],
];

const todas = (): EntradaMenu[] => SECCIONES.flatMap((s) => s.entradas);
const porId = (id: string) => todas().find((e) => e.id === id)!;

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('las cinco secciones del mapa (UI-02)', () => {
  it('en orden, con sus nombres y sus entradas exactas', () => {
    expect(SECCIONES.map((s) => [s.titulo, s.entradas.map((e) => e.texto)])).toEqual(FICHA);
  });

  it('ids únicos (el colapso y el aria-describedby dependen de eso)', () => {
    const ids = [...SECCIONES.map((s) => s.id), ...todas().map((e) => e.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cada entrada tiene destino o pendiente, nunca los dos ni ninguno', () => {
    for (const e of todas()) {
      expect([e.id, Boolean(e.destino) !== Boolean(e.pendiente)]).toEqual([e.id, true]);
    }
  });

  it('toda entrada pendiente nombra su tarea, salvo exactamente las de SIN_TAREA', () => {
    const sinTarea = todas()
      .filter((e) => e.pendiente && !e.pendiente.tarea)
      .map((e) => e.id);
    expect(sinTarea).toEqual([...SIN_TAREA]);
    // UI-02 (D-01): las cuatro que había salieron del menú; no queda ninguna.
    expect(SIN_TAREA).toEqual([]);
    for (const e of todas()) {
      if (!e.pendiente) continue;
      expect(e.pendiente.razon.trim()).not.toBe('');
      if (e.pendiente.tarea) {
        expect(e.pendiente.tarea).toMatch(/^F2-\d{3}$/);
        expect(e.pendiente.razon).toContain(`Se construye en ${e.pendiente.tarea}`);
      }
    }
  });

  it('las tareas de las pendientes son las de la cola que construyen cada vista', () => {
    // F2-140 construyó Comparativos: ya navega.
    expect(porId('principal.comparativos').destino).toEqual({ ruta: '/comparativos' });
    // F2-220 construyó el Resumen: ya navega.
    expect(porId('ventas.resumen').destino).toEqual({ ruta: '/resumen' });
    // F2-221 construyó Análisis: ya navega.
    expect(porId('ventas.analisis').destino).toEqual({ ruta: '/analisis' });
    // F2-145 construyó Productos y el orquestador de menú: ya navegan.
    expect(porId('catalogos.productos').destino).toEqual({ ruta: '/productos' });
    expect(porId('catalogos.orquestador').destino).toEqual({ ruta: '/menu' });
    // F2-231 construyó Meseros: ya navega.
    expect(porId('catalogos.meseros').destino).toEqual({ ruta: '/meseros' });
    // F2-232 construyó Clientes (hoy «Comensales», UI-02): ya navega, a la misma ruta.
    expect(porId('catalogos.clientes').destino).toEqual({ ruta: '/clientes' });
    expect(porId('catalogos.clientes').texto).toBe('Comensales');
    // F2-233 construyó Áreas y canales: navega.
    expect(porId('catalogos.areas').destino).toEqual({ ruta: '/areas' });
    // F2-121 construyó Existencias: navega.
    expect(porId('inventario.existencias').destino).toEqual({ ruta: '/existencias' });
    // F2-122 construyó Movimientos y kardex: navega.
    expect(porId('inventario.movimientos').destino).toEqual({ ruta: '/movimientos' });
    // F2-123 construyó Conteos físicos: navega.
    expect(porId('inventario.conteos').destino).toEqual({ ruta: '/conteos' });
    // F2-125 construyó Recetas: navega.
    expect(porId('inventario.recetas').destino).toEqual({ ruta: '/recetas' });
    // F2-127 construyó Proyecciones: navega.
    expect(porId('inventario.proyecciones').destino).toEqual({ ruta: '/proyecciones' });
    // F2-126 construyó Compras y Gastos y utilidad: navegan.
    expect(porId('inventario.compras').destino).toEqual({ ruta: '/compras' });
    expect(porId('inventario.gastos').destino).toEqual({ ruta: '/gastos' });
    // F2-124 construyó Traspasos: navega.
    expect(porId('inventario.traspasos').destino).toEqual({ ruta: '/traspasos' });
    // F2-144 construyó Ventas por canal: navega. Era la última pendiente con tarea: las que
    // quedan son las de SIN_TAREA.
    expect(porId('canales.ventas').destino).toEqual({ ruta: '/canales' });
    expect(porId('canales.ventas').pendiente).toBeUndefined();
    expect(todas().filter((e) => e.pendiente?.tarea)).toEqual([]);
    // UI-02: ninguna entrada del menú queda sin navegar.
    expect(todas().filter((e) => e.pendiente)).toEqual([]);
    // F2-100 construyó los datos fiscales de Facturación: navega (sólo administradores).
    expect(porId('administracion.facturacion').destino).toEqual({ ruta: '/facturacion' });
  });
});

describe('seccionesPara (permiso, no "pendiente")', () => {
  it('admin_global ve todo', () => {
    expect(seccionesPara('admin_global').map((s) => s.entradas.length)).toEqual(
      FICHA.map(([, entradas]) => entradas.length),
    );
  });

  it('admin_empresa ve Administración sin Empresas (igual que la pestaña)', () => {
    const admin = seccionesPara('admin_empresa').find((s) => s.id === 'administracion')!;
    expect(admin.entradas.map((e) => e.texto)).toEqual([
      'Sucursales',
      'Usuarios',
      'Agentes',
      'Facturación',
    ]);
  });

  it('el visor no ve la sección Administración; de las demás ve todo lo que no pide rol', () => {
    const visor = seccionesPara('visor');
    expect(visor.map((s) => s.titulo)).toEqual(FICHA.slice(0, 4).map(([t]) => t));
    // El filtro es por permiso, nada más: cada entrada sin `roles` le llega, en el mismo orden.
    expect(visor.flatMap((s) => s.entradas.map((e) => e.id))).toEqual(
      todas()
        .filter((e) => !e.roles)
        .map((e) => e.id),
    );
  });
});

describe('searchDestino y entradaActiva', () => {
  const admin = (tab: string) => porId(`administracion.${tab}`);

  it('conserva el alcance y agrega la pestaña de Administración', () => {
    expect(searchDestino({ ruta: '/tickets' }, '?empresa=e1&sucursal=s1')).toBe(
      '?empresa=e1&sucursal=s1',
    );
    expect(searchDestino({ ruta: '/tickets' }, '')).toBe('');
    expect(searchDestino(admin('agentes').destino!, '?empresa=e1')).toBe('?empresa=e1&tab=agentes');
    expect(searchDestino(admin('usuarios').destino!, '')).toBe('?tab=usuarios');
  });

  it('Inicio sólo en "/" exacto; las demás también en sus subrutas', () => {
    const q = new URLSearchParams();
    expect(entradaActiva(porId('principal.inicio'), '/', q)).toBe(true);
    expect(entradaActiva(porId('principal.inicio'), '/tickets', q)).toBe(false);
    expect(entradaActiva(porId('ventas.tickets'), '/tickets', q)).toBe(true);
    expect(entradaActiva(porId('ventas.tickets'), '/tickets/123', q)).toBe(true);
    expect(entradaActiva(porId('ventas.tickets'), '/ticketsx', q)).toBe(false);
    expect(entradaActiva(porId('ventas.resumen'), '/', q)).toBe(false);
  });

  it('en /admin cuenta la pestaña; sin tab o con una desconocida es Sucursales', () => {
    const activas = (search: string) =>
      ['sucursales', 'usuarios', 'agentes', 'empresas'].filter((t) =>
        entradaActiva(admin(t), '/admin', new URLSearchParams(search)),
      );
    expect(activas('')).toEqual(['sucursales']);
    expect(activas('tab=inventada')).toEqual(['sucursales']);
    expect(activas('empresa=e1&tab=agentes')).toEqual(['agentes']);
    expect(activas('tab=empresas')).toEqual(['empresas']);
  });
});

describe('colapso recordado por usuario', () => {
  it('guarda y lee por usuario: otro usuario no hereda el colapso', () => {
    guardarColapsadas('u1', ['catalogos', 'inventario']);
    expect(leerColapsadas('u1')).toEqual(['catalogos', 'inventario']);
    expect(leerColapsadas('u2')).toEqual([]);
    expect(window.localStorage.getItem('monitor.menu.colapsadas.u1')).toBe(
      '["catalogos","inventario"]',
    );
  });

  it('JSON basura, no-arreglo o ids desconocidos no rompen: se ignoran', () => {
    window.localStorage.setItem('monitor.menu.colapsadas.u1', '{no es json');
    expect(leerColapsadas('u1')).toEqual([]);
    window.localStorage.setItem('monitor.menu.colapsadas.u1', '{"catalogos":true}');
    expect(leerColapsadas('u1')).toEqual([]);
    window.localStorage.setItem('monitor.menu.colapsadas.u1', '["catalogos",7,"inventada"]');
    expect(leerColapsadas('u1')).toEqual(['catalogos']);
  });

  it('UI-02: una sección que ya no existe (Canales) recordada como colapsada se ignora', () => {
    window.localStorage.setItem('monitor.menu.colapsadas.u1', '["canales","inventario"]');
    expect(leerColapsadas('u1')).toEqual(['inventario']);
  });

  it('un storage que lanza (modo privado, bloqueado) deja el menú abierto sin tronar', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => guardarColapsadas('u1', ['catalogos'])).not.toThrow();
    expect(leerColapsadas('u1')).toEqual([]);
  });
});
