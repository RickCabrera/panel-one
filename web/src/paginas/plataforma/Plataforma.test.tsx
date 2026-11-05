import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  AdminInterno,
  ClienteDetalle,
  ClienteResumen,
  MetricasPlataforma,
  PagosMes,
  Plan,
  Rol,
  Suscripcion,
} from '../../api/tipos';
import { Proveedores, Rutas } from '../../App';
import { terminarSesion } from '../../auth/sesion';
import { crearQueryClient } from '../../consultas/queryClient';
import {
  EMPRESA_A,
  EMPRESA_B,
  instalarApiFalsa,
  json,
  sesion,
  SUCURSAL_A1,
  usuario,
  type Manejador,
} from '../../test/apiFalsa';

// El panel de plataforma (membresías) contra una API falsa. Las reglas (quién entra, qué se
// puede) las garantiza la API (e2e de /api); aquí: que la sección sólo existe para
// admin_global, que pinta lo que dice el contrato y que manda exactamente lo que el contrato pide.

const PLAN: Plan = {
  id: 'plan-1',
  nombre: 'Esencial',
  descripcion: null,
  precioMensual: '499.00',
  periodicidad: 'mensual',
  limiteSucursales: 1,
  activo: true,
  clientes: 2,
};

const SUSCRIPCION: Suscripcion = {
  id: 'sus-a',
  plan: { ...PLAN },
  estado: 'activa',
  estadoEfectivo: 'activa',
  inicio: '2026-09-05',
  vencimiento: '2026-11-05',
  fechaLimite: '2026-11-10',
  diasGracia: 5,
  diaCorte: 5,
  notas: null,
};

const CLIENTES: ClienteResumen[] = [
  {
    id: EMPRESA_A.id,
    nombre: EMPRESA_A.nombre,
    activo: true,
    suscripcion: SUSCRIPCION,
    ultimoPago: null,
    sucursales: 1,
    agentesConectados: 1,
    usuarios: 2,
    ultimaVentaRecibidaAt: '2026-11-02T22:00:00Z',
  },
  {
    id: EMPRESA_B.id,
    nombre: EMPRESA_B.nombre,
    activo: false,
    suscripcion: {
      ...SUSCRIPCION,
      id: 'sus-b',
      estadoEfectivo: 'vencida',
      vencimiento: '2026-10-01',
    },
    ultimoPago: null,
    sucursales: 0,
    agentesConectados: 0,
    usuarios: 1,
    ultimaVentaRecibidaAt: null,
  },
];

const DETALLE_A: ClienteDetalle = {
  ...CLIENTES[0],
  contacto: {
    contactoNombre: 'Dueña Demo',
    contactoTelefono: '55 0000 0000',
    contactoEmail: null,
    rfc: null,
    notasPlataforma: null,
  },
  creadaAt: '2026-09-05T18:00:00Z',
  listaSucursales: [
    {
      id: SUCURSAL_A1.id,
      nombre: SUCURSAL_A1.nombre,
      activo: true,
      tieneApiKey: true,
      ultimoContactoAt: '2026-11-03T17:58:00Z',
      versionAgente: '1.4.0',
    },
  ],
  listaUsuarios: [
    {
      id: 'u-1',
      nombre: 'Dueña Demo',
      email: 'duena@demo.local',
      rol: 'admin_empresa',
      activo: true,
      ultimoAccesoAt: null,
    },
  ],
  pagos: [
    {
      id: 'pago-1',
      empresaId: EMPRESA_A.id,
      monto: '499.00',
      moneda: 'MXN',
      fechaPago: '2026-10-04',
      metodo: 'transferencia',
      referencia: 'SPEI 1',
      periodoDesde: '2026-10-05',
      periodoHasta: '2026-11-05',
      notas: null,
      registradoPor: 'Ana Global <ana@demo.local>',
      registradoAt: '2026-10-04T18:00:00Z',
      anuladoAt: null,
      anuladoPor: null,
      motivoAnulacion: null,
    },
  ],
};

const METRICAS: MetricasPlataforma = {
  mrr: '1497.00',
  activos: 3,
  prueba: 1,
  vencidos: 1,
  suspendidos: 0,
  cancelados: 0,
  sinSuscripcion: 2,
  ingresosMes: '998.00',
  vencenProximos7Dias: 1,
  hoy: '2026-11-03',
};

const PAGOS_MES: PagosMes = {
  mes: '2026-11',
  conteos: { todos: 2, pagados: 0, pendientes: 1, vencidos: 1 },
  cobradoMes: '0.00',
  mensualidades: [
    {
      empresaId: EMPRESA_A.id,
      empresa: EMPRESA_A.nombre,
      empresaActiva: true,
      plan: 'Esencial',
      precioMensual: '499.00',
      periodicidad: 'mensual',
      diaCorte: 5,
      vencimiento: '2026-11-05',
      estadoEfectivo: 'activa',
      estadoPago: 'pendiente',
      ultimoPago: null,
    },
    {
      empresaId: EMPRESA_B.id,
      empresa: EMPRESA_B.nombre,
      empresaActiva: false,
      plan: 'Esencial',
      precioMensual: '499.00',
      periodicidad: 'mensual',
      diaCorte: 1,
      vencimiento: '2026-10-01',
      estadoEfectivo: 'vencida',
      estadoPago: 'vencido',
      ultimoPago: { fechaPago: '2026-09-01', monto: '499.00', moneda: 'MXN' },
    },
  ],
};

const YO = usuario('admin_global');
const ADMINS: AdminInterno[] = [
  {
    id: 'otro-admin',
    nombre: 'Erick',
    email: 'erick@demo.local',
    activo: true,
    ultimoAccesoAt: '2026-10-31T16:15:00Z',
  },
  {
    id: YO.id,
    nombre: YO.nombre,
    email: YO.email,
    activo: true,
    ultimoAccesoAt: '2026-11-03T07:31:00Z',
  },
];

function api(rol: Rol, extra: Record<string, Manejador> = {}) {
  const yo = usuario(rol);
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(yo)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1]),
    'GET /sistema': () => json(200, { modoDemo: false, colorAcento: null }),
    'GET /plataforma/metricas': () => json(200, METRICAS),
    'GET /plataforma/planes': () => json(200, [PLAN]),
    'GET /plataforma/clientes': () => json(200, CLIENTES),
    [`GET /plataforma/clientes/${EMPRESA_A.id}`]: () => json(200, DETALLE_A),
    'GET /plataforma/pagos': () => json(200, PAGOS_MES),
    'GET /plataforma/administradores': () => json(200, ADMINS),
    'GET /plataforma/ajustes': () => json(200, { colorAcento: null }),
    'GET /plataforma/bitacora': () =>
      json(200, {
        total: 1,
        pagina: 1,
        porPagina: 25,
        entradas: [
          {
            id: 'b1',
            createdAt: '2026-11-03T17:00:00Z',
            actorId: YO.id,
            actorEmail: YO.email,
            accion: 'pago.registrar',
            empresaId: EMPRESA_A.id,
            empresa: EMPRESA_A.nombre,
            recurso: 'pago',
            recursoId: 'pago-1',
            antes: { vencimiento: '2026-10-05' },
            despues: { vencimiento: '2026-11-05', monto: '499.00' },
          },
        ],
      }),
    ...extra,
  });
}

function montar(ruta: string) {
  const queryClient = crearQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Proveedores queryClient={queryClient}>
        <Rutas />
      </Proveedores>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  terminarSesion('cerrada');
  window.localStorage.clear();
});

describe('Plataforma: sólo admin_global', () => {
  it.each(['admin_empresa', 'visor'] as const)(
    '%s ve "No encontrada" y no pide nada a /plataforma',
    async (rol) => {
      const falsa = api(rol);
      montar('/plataforma');
      expect(await screen.findByText(/no encontrada/i)).toBeInTheDocument();
      expect(falsa.llamadas.some((l) => l.ruta.startsWith('/plataforma'))).toBe(false);
    },
  );

  it('admin_global: barra lateral propia con secciones, nombre, correo, tema oscuro y cerrar sesión', async () => {
    api('admin_global');
    montar('/plataforma');
    const nav = await screen.findByRole('navigation', { name: 'Plataforma' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Tablero', 'Clientes', 'Pagos', 'Planes', 'Ajustes', 'Administradores', 'Bitácora']);
    expect(screen.getByText('Administración')).toBeInTheDocument();
    expect(screen.getByText(YO.email)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Tema oscuro' })).toBeInTheDocument();
    // UI-06: el estilo de la marca, junto al tema.
    expect(screen.getByRole('group', { name: 'Estilo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
    // Tablero con las métricas (dinero exacto desde el texto de la API).
    expect(await screen.findByText('$1,497.00')).toBeInTheDocument();
    expect(screen.getByText('Ingreso mensual recurrente (MRR)')).toBeInTheDocument();
    expect(screen.getByText('Hay 2 empresas sin plan asignado.')).toBeInTheDocument();
  });

  it('el interruptor de tema oscuro cambia el tema', async () => {
    const usuarioEv = userEvent.setup();
    api('admin_global');
    montar('/plataforma');
    const interruptor = await screen.findByRole('switch', { name: 'Tema oscuro' });
    const antes = interruptor.getAttribute('aria-checked');
    await usuarioEv.click(interruptor);
    expect(interruptor.getAttribute('aria-checked')).not.toBe(antes);
    expect(document.documentElement.dataset.tema).toBe(antes === 'true' ? 'claro' : 'oscuro');
  });

  it('el panel normal ofrece "Plataforma" sólo al admin_global', async () => {
    api('admin_global');
    montar('/cuenta');
    expect(await screen.findByRole('link', { name: 'Plataforma' })).toHaveAttribute(
      'href',
      '/plataforma',
    );
    cleanup();
    terminarSesion('cerrada');
    api('admin_empresa');
    montar('/cuenta');
    await screen.findByRole('link', { name: 'Mi cuenta' });
    expect(screen.queryByRole('link', { name: 'Plataforma' })).toBeNull();
  });
});

describe('Clientes', () => {
  it('lista: nombre, "N sucursales, N agentes, N usuarios" y chip de estado', async () => {
    api('admin_global');
    montar('/plataforma/clientes');
    const lista = await screen.findByRole('list', { name: 'Clientes' });
    const filas = within(lista).getAllByRole('listitem');
    expect(filas).toHaveLength(2);
    expect(filas[0]).toHaveTextContent(EMPRESA_A.nombre);
    expect(filas[0]).toHaveTextContent('1 sucursal, 1 agente conectado, 2 usuarios');
    expect(within(filas[0]).getByText('Activo')).toBeInTheDocument();
    expect(within(filas[1]).getByText('Vencido')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dar de alta cliente' })).toBeInTheDocument();
  });

  it('filtra por estado y busca por nombre (manda estado y q)', async () => {
    const usuarioEv = userEvent.setup();
    const falsa = api('admin_global');
    montar('/plataforma/clientes');
    await screen.findByRole('list', { name: 'Clientes' });
    await usuarioEv.selectOptions(screen.getByRole('combobox', { name: 'Estado' }), 'vencida');
    await usuarioEv.type(screen.getByPlaceholderText('Nombre del cliente'), 'Mariscos');
    await usuarioEv.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => {
      const ultima = falsa.llamadas.filter((l) => l.ruta === '/plataforma/clientes').at(-1)!;
      expect(ultima.query.get('estado')).toBe('vencida');
      expect(ultima.query.get('q')).toBe('Mariscos');
    });
  });

  it('alta de cliente: manda empresa, plan, día de corte y su administrador', async () => {
    const usuarioEv = userEvent.setup();
    const falsa = api('admin_global', {
      'POST /plataforma/clientes': () => json(201, DETALLE_A),
    });
    montar('/plataforma/clientes');
    await usuarioEv.click(await screen.findByRole('button', { name: 'Dar de alta cliente' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Dar de alta cliente' });
    await within(dialogo).findByRole('combobox', { name: 'Plan' });
    await usuarioEv.type(within(dialogo).getByLabelText('Nombre del negocio'), 'Tacos Nuevos');
    const dia = within(dialogo).getByLabelText('Día de corte (1 a 28)');
    await usuarioEv.clear(dia);
    await usuarioEv.type(dia, '12');
    await usuarioEv.type(within(dialogo).getByLabelText('Nombre'), 'Doña Nueva');
    await usuarioEv.type(
      within(dialogo).getByLabelText('Correo (con el que entra)'),
      'nueva@demo.local',
    );
    await usuarioEv.click(within(dialogo).getByRole('button', { name: 'Dar de alta' }));
    await waitFor(() => expect(falsa.contar('POST', '/plataforma/clientes')).toBe(1));
    const cuerpo = falsa.llamadas.find(
      (l) => l.ruta === '/plataforma/clientes' && l.metodo === 'POST',
    )!.cuerpo as Record<string, unknown>;
    expect(cuerpo).toMatchObject({
      nombre: 'Tacos Nuevos',
      planId: PLAN.id,
      estado: 'activa',
      diaCorte: 12,
      administrador: { nombre: 'Doña Nueva', email: 'nueva@demo.local' },
    });
    expect((cuerpo.administrador as { password: string }).password).toHaveLength(16);
    // Navega al detalle del cliente creado.
    expect(await screen.findByRole('heading', { name: EMPRESA_A.nombre })).toBeInTheDocument();
  });

  it('detalle: suscripción, pagos, sucursales con su agente y usuarios; suspender pide confirmación', async () => {
    const usuarioEv = userEvent.setup();
    const falsa = api('admin_global', {
      [`POST /plataforma/clientes/${EMPRESA_A.id}/estado`]: () =>
        json(200, { ...SUSCRIPCION, estado: 'suspendida', estadoEfectivo: 'suspendida' }),
    });
    montar(`/plataforma/clientes/${EMPRESA_A.id}`);
    const sus = await screen.findByRole('region', { name: 'Suscripción' });
    expect(sus).toHaveTextContent('Esencial · $499.00 al mes');
    expect(sus).toHaveTextContent('5 nov 2026');
    expect(screen.getByRole('region', { name: 'Pagos' })).toHaveTextContent(
      '$499.00 MXN · Transferencia',
    );
    expect(screen.getByRole('region', { name: 'Sucursales' })).toHaveTextContent('v1.4.0');
    expect(screen.getByRole('region', { name: 'Usuarios' })).toHaveTextContent('duena@demo.local');

    await usuarioEv.click(within(sus).getByRole('button', { name: 'Suspender' }));
    const dialogo = await screen.findByRole('dialog');
    expect(dialogo).toHaveTextContent('SIGUEN mandando ventas');
    await usuarioEv.type(within(dialogo).getByLabelText(/Motivo/), 'Falta de pago');
    await usuarioEv.click(within(dialogo).getByRole('button', { name: 'Suspender' }));
    await waitFor(() =>
      expect(falsa.llamadas.find((l) => l.ruta.endsWith('/estado'))?.cuerpo).toEqual({
        estado: 'suspendida',
        motivo: 'Falta de pago',
      }),
    );
  });

  it('anular un pago manda el motivo', async () => {
    const usuarioEv = userEvent.setup();
    const falsa = api('admin_global', {
      'POST /plataforma/pagos/pago-1/anular': () =>
        json(200, { ...DETALLE_A.pagos[0], anuladoAt: '2026-11-03T18:00:00Z' }),
    });
    montar(`/plataforma/clientes/${EMPRESA_A.id}`);
    const pagos = await screen.findByRole('region', { name: 'Pagos' });
    await usuarioEv.click(within(pagos).getByRole('button', { name: 'Anular' }));
    const dialogo = await screen.findByRole('dialog');
    await usuarioEv.type(within(dialogo).getByLabelText('Motivo'), 'Rebotó');
    await usuarioEv.click(within(dialogo).getByRole('button', { name: 'Anular pago' }));
    await waitFor(() =>
      expect(falsa.llamadas.find((l) => l.ruta.endsWith('/anular'))?.cuerpo).toEqual({
        motivo: 'Rebotó',
      }),
    );
  });
});

describe('Pagos', () => {
  it('título con el mes, 4 tarjetas, pestañas con conteo y filas con chips', async () => {
    api('admin_global');
    montar('/plataforma/pagos');
    expect(await screen.findByText(/Las mensualidades de noviembre de 2026/)).toHaveTextContent(
      'Nada corta el servicio automáticamente',
    );
    const resumen = screen.getByRole('region', { name: 'Resumen del mes' });
    expect(resumen).toHaveTextContent('Pagados');
    expect(resumen).toHaveTextContent('Cobrado de noviembre de 2026');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Todos 2',
      'Pagados 0',
      'Pendientes 1',
      'Vencidos 1',
    ]);
    const filaA = screen.getByRole('listitem', { name: EMPRESA_A.nombre });
    expect(filaA).toHaveTextContent('Plan Esencial · corte el día 5');
    expect(filaA).toHaveTextContent('Sin pagos registrados');
    expect(within(filaA).getByText('Pendiente')).toBeInTheDocument();
    const filaB = screen.getByRole('listitem', { name: EMPRESA_B.nombre });
    expect(within(filaB).getByText('Desactivado')).toBeInTheDocument();
    expect(within(filaB).getByText('Vencido')).toBeInTheDocument();
  });

  it('la pestaña filtra en la API', async () => {
    const usuarioEv = userEvent.setup();
    const falsa = api('admin_global');
    montar('/plataforma/pagos');
    await usuarioEv.click(await screen.findByRole('tab', { name: /Vencidos/ }));
    await waitFor(() =>
      expect(
        falsa.llamadas
          .filter((l) => l.ruta === '/plataforma/pagos')
          .at(-1)
          ?.query.get('estado'),
      ).toBe('vencido'),
    );
  });

  it('Registrar pago: monto del plan como texto, fecha, método y periodos', async () => {
    const usuarioEv = userEvent.setup();
    const falsa = api('admin_global', {
      [`POST /plataforma/clientes/${EMPRESA_A.id}/pagos`]: () =>
        json(201, {
          pago: DETALLE_A.pagos[0],
          suscripcion: { ...SUSCRIPCION, vencimiento: '2026-12-05' },
        }),
    });
    montar('/plataforma/pagos');
    const fila = await screen.findByRole('listitem', { name: EMPRESA_A.nombre });
    await usuarioEv.click(within(fila).getByRole('button', { name: 'Registrar pago' }));
    const dialogo = await screen.findByRole('dialog', {
      name: `Registrar pago de ${EMPRESA_A.nombre}`,
    });
    expect(within(dialogo).getByLabelText('Monto (MXN)')).toHaveValue('499.00');
    await usuarioEv.selectOptions(within(dialogo).getByLabelText('Método'), 'efectivo');
    await usuarioEv.type(within(dialogo).getByLabelText('Referencia (opcional)'), 'Recibo 7');
    await usuarioEv.click(within(dialogo).getByRole('button', { name: 'Registrar pago' }));
    expect(await within(dialogo).findByRole('status')).toHaveTextContent(
      'Pago registrado. Ahora vence el 5 dic 2026.',
    );
    const cuerpo = falsa.llamadas.find((l) => l.ruta.endsWith('/pagos') && l.metodo === 'POST')!
      .cuerpo as Record<string, unknown>;
    expect(cuerpo).toMatchObject({
      monto: '499.00',
      metodo: 'efectivo',
      referencia: 'Recibo 7',
      periodos: 1,
      notas: null,
    });
    expect(cuerpo.fechaPago).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('Administradores internos', () => {
  it('"Tú", último acceso, sin desactivarte a ti mismo y SIN ninguna opción de contraseña', async () => {
    api('admin_global');
    montar('/plataforma/administradores');
    const lista = await screen.findByRole('list', { name: 'Administradores' });
    const yo = within(lista).getByRole('listitem', { name: YO.nombre });
    const otro = within(lista).getByRole('listitem', { name: 'Erick' });
    expect(within(yo).getByText('Tú')).toBeInTheDocument();
    expect(within(otro).queryByText('Tú')).toBeNull();
    expect(otro).toHaveTextContent('Último acceso: 31 oct 2026');
    expect(within(yo).queryByRole('button', { name: 'Desactivar' })).toBeNull();
    expect(within(otro).getByRole('button', { name: 'Desactivar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /contraseña/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /eliminar|borrar/i })).toBeNull();
  });

  it('desactivar a otro manda activo: false', async () => {
    const usuarioEv = userEvent.setup();
    const falsa = api('admin_global', {
      'PATCH /plataforma/administradores/otro-admin': () =>
        json(200, { ...ADMINS[0], activo: false }),
    });
    montar('/plataforma/administradores');
    const otro = await screen.findByRole('listitem', { name: 'Erick' });
    await usuarioEv.click(within(otro).getByRole('button', { name: 'Desactivar' }));
    await waitFor(() =>
      expect(falsa.llamadas.find((l) => l.metodo === 'PATCH')?.cuerpo).toEqual({ activo: false }),
    );
  });

  it('editar no ofrece contraseña: sólo nombre y correo', async () => {
    const usuarioEv = userEvent.setup();
    api('admin_global');
    montar('/plataforma/administradores');
    const otro = await screen.findByRole('listitem', { name: 'Erick' });
    await usuarioEv.click(within(otro).getByRole('button', { name: 'Editar' }));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByLabelText('Nombre')).toBeInTheDocument();
    expect(within(dialogo).getByLabelText('Correo')).toBeInTheDocument();
    expect(within(dialogo).queryByLabelText(/contraseña/i)).toBeNull();
  });

  it('convertir una cuenta de cliente: busca por correo y la hace administrador', async () => {
    const usuarioEv = userEvent.setup();
    const falsa = api('admin_global', {
      'GET /plataforma/administradores/buscar-cuenta': () =>
        json(200, {
          id: 'u-cliente',
          nombre: 'Jorge Dueño',
          email: 'dueno@negocio.mx',
          rol: 'admin_empresa',
          activo: true,
          empresaId: EMPRESA_A.id,
          empresa: EMPRESA_A.nombre,
        }),
      'POST /plataforma/administradores/convertir': () =>
        json(200, {
          admin: {
            id: 'u-cliente',
            nombre: 'Jorge Dueño',
            email: 'dueno@negocio.mx',
            activo: true,
            ultimoAccesoAt: null,
          },
          empresaId: EMPRESA_A.id,
          empresaSinAdmin: true,
        }),
    });
    montar('/plataforma/administradores');
    const seccion = await screen.findByRole('region', { name: 'Convertir una cuenta de cliente' });
    await usuarioEv.type(within(seccion).getByLabelText('Correo de la cuenta'), 'dueno@negocio.mx');
    await usuarioEv.click(within(seccion).getByRole('button', { name: 'Buscar cuenta' }));
    expect(await within(seccion).findByText('Jorge Dueño')).toBeInTheDocument();
    expect(falsa.llamadas.find((l) => l.ruta.endsWith('/buscar-cuenta'))?.query.get('email')).toBe(
      'dueno@negocio.mx',
    );
    await usuarioEv.click(within(seccion).getByRole('button', { name: 'Hacer administrador' }));
    expect(await within(seccion).findByRole('status')).toHaveTextContent(
      `se quedó sin administrador`,
    );
    expect(falsa.llamadas.find((l) => l.ruta.endsWith('/convertir'))?.cuerpo).toEqual({
      usuarioId: 'u-cliente',
    });
  });
});

describe('Ajustes y bitácora', () => {
  it('elegir un color, ver la vista previa y guardarlo manda la CLAVE (nunca un hex) y relee /sistema', async () => {
    const usuarioEv = userEvent.setup();
    const falsa = api('admin_global', {
      'PUT /plataforma/ajustes': () => json(200, { colorAcento: 'morado' }),
    });
    montar('/plataforma/ajustes');
    expect(
      await screen.findByText('Valen para todos los clientes. Los negocios no pueden cambiarlos.'),
    ).toBeInTheDocument();
    const radios = (await screen.findAllByRole('radio')).map((r) => r.textContent);
    expect(radios).toEqual([
      'Naranja',
      // UI-02: la clave `morado` es el violeta de la marca.
      'Morado Yo Controlo',
      'Azul eléctrico',
      'Verde azulado',
      'Ámbar dorado',
      'Magenta',
      'Rojo',
    ]);
    await usuarioEv.click(screen.getByRole('radio', { name: 'Magenta' }));
    expect(screen.getByRole('radio', { name: 'Magenta' })).toHaveAttribute('aria-checked', 'true');
    // La vista previa usa el color elegido sólo dentro de su recuadro.
    expect(screen.getByTestId('vista-previa').style.getPropertyValue('--acento')).toBe('#db2777');
    await usuarioEv.click(screen.getByRole('radio', { name: 'Morado Yo Controlo' }));
    expect(screen.getByRole('radio', { name: 'Morado Yo Controlo' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByTestId('vista-previa').style.getPropertyValue('--acento')).toBe('#6d3fc0');
    const sistemaAntes = falsa.contar('GET', '/sistema');
    await usuarioEv.click(screen.getByRole('button', { name: 'Guardar color' }));
    expect(await screen.findByText('Color guardado.')).toBeInTheDocument();
    expect(falsa.llamadas.find((l) => l.metodo === 'PUT')?.cuerpo).toEqual({
      colorAcento: 'morado',
    });
    await waitFor(() => expect(falsa.contar('GET', '/sistema')).toBeGreaterThan(sistemaAntes));
  });

  it('bitácora: acción en español, quién, cliente y el antes/después', async () => {
    api('admin_global');
    montar('/plataforma/bitacora');
    const lista = await screen.findByRole('list', { name: 'Bitácora' });
    expect(lista).toHaveTextContent('Registró un pago');
    expect(lista).toHaveTextContent(YO.email);
    expect(within(lista).getByRole('link', { name: EMPRESA_A.nombre })).toBeInTheDocument();
    expect(lista).toHaveTextContent('vencimiento: 2026-10-05 → 2026-11-05');
  });
});

describe('El color global de la plataforma se aplica al cargar', () => {
  it('con colorAcento en /sistema, el acento de la página es el de esa clave', async () => {
    api('admin_global', {
      'GET /sistema': () => json(200, { modoDemo: false, colorAcento: 'rojo' }),
    });
    montar('/plataforma');
    await screen.findByRole('navigation', { name: 'Plataforma' });
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--acento')).toBe('#dc2626'),
    );
    expect(window.localStorage.getItem('monitor.acento.global')).toBe('rojo');
  });
});
