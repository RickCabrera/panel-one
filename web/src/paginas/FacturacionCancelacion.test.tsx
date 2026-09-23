import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CatalogosSat,
  CfdiFila,
  ConsultaCancelacion,
  PaginaCfdis,
  ResultadoCancelacion,
  TableroFacturacion,
} from '../api/tipos';
import { Proveedores, Rutas } from '../App';
import { terminarSesion } from '../auth/sesion';
import { crearQueryClient } from '../consultas/queryClient';
import {
  EMPRESA_A,
  instalarApiFalsa,
  json,
  sesion,
  SUCURSAL_A1,
  usuario,
  type Manejador,
} from '../test/apiFalsa';
import { MENSAJE_01_SIN_SUSTITUTO, MENSAJE_CON_SUSTITUTO } from './facturacion/emision/cancelacion';

// F2-109 en el web, contra el router y la app reales: la cancelación desde la tabla del Tablero. Lo
// que se prueba: sólo se ofrecen los motivos que aplican (sin 04 en un ticket, sin 01 en una
// global); con 01 sin sustituto el formulario NO deja continuar y ofrece refacturar; con sustituto
// manda su UUID; el resultado dice si quedó cancelada o EN PROCESO; una solicitud abierta se
// consulta ("Actualizar estado") en vez de pedir otra.

const A = EMPRESA_A.id;
const AHORA = new Date('2026-09-22T18:00:00Z');
const RUTA = `/facturacion?empresa=${A}&periodo=mes`;
const SUSTITUTO = 'AAAAAAAA-396D-4725-8521-CDC4BDD20C99';

const CATALOGOS: CatalogosSat = {
  regimenesFiscales: [
    { clave: '601', descripcion: 'General de Ley Personas Morales', fisica: false, moral: true },
  ],
  usosCfdi: [
    {
      clave: 'G03',
      descripcion: 'Gastos en general',
      fisica: true,
      moral: true,
      regimenes: ['601'],
    },
  ],
};

const TABLERO: TableroFacturacion = {
  ventas: { venta: '1000.00', cuentas: 3 },
  facturado: { monto: '500.00', cfdis: 2 },
  global: { monto: '0.00', cfdis: 0 },
  cancelados: { monto: '0.00', cfdis: 0 },
  tasa: '0.5000',
  porFacturar: { cuentas: 0, monto: '0.00' },
  porSucursal: [],
  porMes: [{ mes: '2026-09', facturado: '500.00', cfdis: 2 }],
  porHora: Array.from({ length: 24 }, (_, hora) => ({ hora, facturado: '0.00', cfdis: 0 })),
};

function cfdi(n: number, c: Partial<CfdiFila> = {}): CfdiFila {
  return {
    id: `cfdi-${n}`,
    uuid: `5FB2822E-396D-4725-8521-CDC4BDD20C${String(n).padStart(2, '0')}`,
    serieFolio: `A-${100 + n}`,
    sucursalId: SUCURSAL_A1.id,
    sucursal: SUCURSAL_A1.nombre,
    receptorRfc: 'EKU9003173C9',
    receptorNombre: 'ESCUELA KEMPER URGATE',
    total: '100.00',
    estado: 'vigente',
    emitidoAt: '2026-09-10T20:30:00.000Z',
    folioTicket: `T-${n}`,
    xml: true,
    pdf: true,
    origen: 'ticket',
    receptor: {
      rfc: 'EKU9003173C9',
      razonSocial: 'ESCUELA KEMPER URGATE',
      regimenFiscal: '601',
      cp: '42501',
      usoCfdi: 'G03',
      email: 'kemper@ejemplo.test',
    },
    sustituyeA: null,
    sustituidoPor: null,
    sustitucionPendiente: false,
    motivoCancelacion: null,
    cancelacion: null,
    ...c,
  };
}

const PAGINA: PaginaCfdis = {
  total: 6,
  pagina: 1,
  porPagina: 20,
  cfdis: [
    cfdi(1),
    cfdi(2, { origen: 'global', folioTicket: null, receptorRfc: 'XAXX010101000' }),
    cfdi(3, { sustituidoPor: SUSTITUTO, sustitucionPendiente: true }),
    cfdi(4, { estado: 'cancelado', motivoCancelacion: '02' }),
    cfdi(5, {
      cancelacion: {
        estado: 'en_proceso',
        motivo: '02',
        solicitadaAt: '2026-09-21T16:00:00.000Z',
        resueltaAt: null,
      },
    }),
    cfdi(6, {
      cancelacion: {
        estado: 'rechazada',
        motivo: '03',
        solicitadaAt: '2026-09-20T16:00:00.000Z',
        resueltaAt: '2026-09-21T16:00:00.000Z',
      },
    }),
  ],
};

function api(extra: Record<string, Manejador> = {}) {
  const u = usuario('admin_empresa');
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1]),
    'GET /alertas/abiertas': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /mesas/abiertas': () => json(200, []),
    'GET /facturacion/catalogos-sat': () => json(200, CATALOGOS),
    'GET /facturacion/tablero': () => json(200, TABLERO),
    'GET /facturacion/cfdis': () => json(200, PAGINA),
    'GET /facturacion/por-facturar': () =>
      json(200, { total: 0, monto: '0.00', pagina: 1, porPagina: 20, cuentas: [] }),
    'GET /facturacion/envios': () => json(200, []),
    ...extra,
  });
}

function montar() {
  const queryClient = crearQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  return render(
    <MemoryRouter initialEntries={[RUTA]}>
      <Proveedores queryClient={queryClient}>
        <Rutas />
      </Proveedores>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  cleanup();
  terminarSesion('cerrada');
  window.localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** La fila de la tabla cuya celda de folio fiscal es `uuid`. */
async function filaDe(n: number): Promise<HTMLElement> {
  const tabla = await screen.findByTestId('tabla-cfdis');
  return within(tabla).getByText(cfdi(n).uuid).closest('tr')!;
}

async function abrirCancelar(u: ReturnType<typeof userEvent.setup>, n: number) {
  await u.click(within(await filaDe(n)).getByRole('button', { name: 'Cancelar' }));
  return screen.findByRole('dialog', { name: `Cancelar A-${100 + n}` });
}

const motivosDe = (dialogo: HTMLElement) =>
  within(dialogo)
    .getAllByRole('radio')
    .map((r) => (r as HTMLInputElement).value);

describe('cancelación de CFDI (F2-109)', () => {
  it('la tabla: Cancelar en vigentes sin solicitud; en proceso se consulta; rechazada se puede repedir', async () => {
    api();
    montar();
    expect(within(await filaDe(1)).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(within(await filaDe(4)).queryByRole('button', { name: 'Cancelar' })).toBeNull();
    const enProceso = await filaDe(5);
    expect(within(enProceso).getByText(/Cancelación en proceso \(motivo 02\)/)).toBeInTheDocument();
    expect(within(enProceso).queryByRole('button', { name: 'Cancelar' })).toBeNull();
    expect(
      within(enProceso).getByRole('button', { name: 'Actualizar estado' }),
    ).toBeInTheDocument();
    const rechazada = await filaDe(6);
    expect(
      within(rechazada).getByText(/El receptor rechazó la cancelación \(motivo 03\)/),
    ).toBeInTheDocument();
    expect(within(rechazada).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });

  it('un ticket: 01, 02 y 03 (no 04); 01 sin sustituto NO deja continuar y ofrece refacturar', async () => {
    const a = api();
    const u = userEvent.setup();
    montar();
    const dialogo = await abrirCancelar(u, 1);
    expect(motivosDe(dialogo)).toEqual(['01', '02', '03']);
    const confirmar = within(dialogo).getByRole('button', { name: 'Cancelar ante el SAT' });
    expect(confirmar).toBeDisabled();
    await u.click(within(dialogo).getByRole('radio', { name: /^01/ }));
    expect(within(dialogo).getByRole('alert')).toHaveTextContent(MENSAJE_01_SIN_SUSTITUTO);
    expect(confirmar).toBeDisabled();
    await u.click(confirmar);
    expect(a.contar('POST', '/facturacion/cfdis/cfdi-1/cancelar')).toBe(0);
    await u.click(within(dialogo).getByRole('button', { name: 'Refacturar en su lugar' }));
    expect(await screen.findByRole('dialog', { name: 'Refacturar A-101' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Cancelar A-101' })).toBeNull();
  });

  it('con 02 manda sólo el motivo y dice que quedó cancelada y a quién se avisó', async () => {
    const resultado: ResultadoCancelacion = {
      cfdiId: 'cfdi-1',
      uuid: cfdi(1).uuid,
      motivo: '02',
      estado: 'cancelado',
      mensaje: null,
    };
    const a = api({ 'POST /facturacion/cfdis/cfdi-1/cancelar': () => json(201, resultado) });
    const u = userEvent.setup();
    montar();
    const dialogo = await abrirCancelar(u, 1);
    await u.click(within(dialogo).getByRole('radio', { name: /^02/ }));
    await u.click(within(dialogo).getByRole('button', { name: 'Cancelar ante el SAT' }));
    expect(await within(dialogo).findByRole('status')).toHaveTextContent(
      'La factura A-101 quedó CANCELADA ante el SAT (motivo 02). Se avisó a kemper@ejemplo.test.',
    );
    const post = a.llamadas.find((l) => l.ruta === '/facturacion/cfdis/cfdi-1/cancelar')!;
    expect(post.cuerpo).toEqual({ motivo: '02' });
  });

  it('una global: 02, 03 y 04 (sin 01); EN PROCESO se dice como tal', async () => {
    const resultado: ResultadoCancelacion = {
      cfdiId: 'cfdi-2',
      uuid: cfdi(2).uuid,
      motivo: '04',
      estado: 'en_proceso',
      mensaje: 'La cancelación está EN PROCESO: el SAT espera la respuesta del receptor.',
    };
    const a = api({ 'POST /facturacion/cfdis/cfdi-2/cancelar': () => json(201, resultado) });
    const u = userEvent.setup();
    montar();
    const dialogo = await abrirCancelar(u, 2);
    expect(motivosDe(dialogo)).toEqual(['02', '03', '04']);
    await u.click(within(dialogo).getByRole('radio', { name: /^04/ }));
    await u.click(within(dialogo).getByRole('button', { name: 'Cancelar ante el SAT' }));
    expect(await within(dialogo).findByRole('status')).toHaveTextContent('EN PROCESO');
    expect(a.llamadas.find((l) => l.ruta === '/facturacion/cfdis/cfdi-2/cancelar')!.cuerpo).toEqual(
      { motivo: '04' },
    );
  });

  it('con el sustituto ya emitido: 01 manda su UUID; otro motivo no deja continuar', async () => {
    const a = api({
      'POST /facturacion/cfdis/cfdi-3/cancelar': () =>
        json(409, { statusCode: 409, message: 'Esta factura ya tiene una solicitud en curso.' }),
    });
    const u = userEvent.setup();
    montar();
    const dialogo = await abrirCancelar(u, 3);
    await u.click(within(dialogo).getByRole('radio', { name: /^02/ }));
    expect(within(dialogo).getByRole('alert')).toHaveTextContent(MENSAJE_CON_SUSTITUTO);
    await u.click(within(dialogo).getByRole('radio', { name: /^01/ }));
    expect(within(dialogo).getByText(SUSTITUTO)).toBeInTheDocument();
    await u.click(within(dialogo).getByRole('button', { name: 'Cancelar ante el SAT' }));
    // Un error del api se dice tal cual.
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
      'Esta factura ya tiene una solicitud en curso.',
    );
    expect(a.llamadas.find((l) => l.ruta === '/facturacion/cfdis/cfdi-3/cancelar')!.cuerpo).toEqual(
      { motivo: '01', uuidSustitucion: SUSTITUTO },
    );
  });

  it('"Actualizar estado" consulta al api y dice en qué quedó', async () => {
    const consulta: ConsultaCancelacion = {
      cfdiId: 'cfdi-5',
      estado: 'rechazada',
      mensaje: 'El receptor RECHAZÓ la cancelación: la factura sigue vigente.',
    };
    const a = api({
      'POST /facturacion/cfdis/cfdi-5/cancelacion/consultar': () => json(200, consulta),
    });
    const u = userEvent.setup();
    montar();
    await u.click(within(await filaDe(5)).getByRole('button', { name: 'Actualizar estado' }));
    expect(await within(await filaDe(5)).findByRole('status')).toHaveTextContent(
      'El receptor RECHAZÓ la cancelación',
    );
    expect(a.contar('POST', '/facturacion/cfdis/cfdi-5/cancelacion/consultar')).toBe(1);
  });
});
