import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  Existencias,
  TraspasoDetalle,
  Traspasos,
  TraspasosSr,
  UsuarioActual,
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
  SUCURSAL_A2,
  usuario,
  type Llamada,
  type Manejador,
} from '../test/apiFalsa';

// F2-124 en el web, contra el router y la app reales: lista (`/traspasos`), leídos de SR, alta
// (`/traspasos/nuevo`) y detalle imprimible (`/traspasos/:id`). Datos escritos a mano.

const A = EMPRESA_A.id;
const AHORA = new Date('2026-09-22T18:00:00Z');
const ZONA = 'America/Mexico_City';

const RESUMEN: TraspasoDetalle['traspaso'] = {
  id: 't-1',
  folio: 7,
  sucursalId: SUCURSAL_A1.id,
  sucursal: 'Centro',
  almacenOrigenSrId: 'A1-GEN',
  almacenOrigen: 'General',
  sucursalDestinoId: SUCURSAL_A2.id,
  sucursalDestino: 'Norte',
  almacenDestinoSrId: 'A2-GEN',
  almacenDestino: 'General norte',
  nota: 'Para el fin de semana',
  estado: 'enviado',
  conciliacion: 'en_alerta',
  // 15:30 UTC = 09:30 en CDMX.
  enviadoAt: '2026-09-19T15:30:00.000Z',
  recibidoAt: null,
  canceladoAt: null,
  conciliadoAt: null,
  articulos: 2,
  conciliados: 1,
};

function lista(p: Partial<Traspasos> = {}): Traspasos {
  return {
    traspasos: [
      RESUMEN,
      {
        ...RESUMEN,
        id: 't-2',
        folio: 8,
        nota: null,
        estado: 'recibido',
        conciliacion: 'conciliado',
        conciliadoAt: '2026-09-20T15:30:00.000Z',
        conciliados: 2,
      },
    ],
    total: 2,
    umbralAlertaHoras: 48,
    sucursales: [
      { sucursalId: SUCURSAL_A1.id, sucursal: 'Centro', zonaHoraria: ZONA },
      { sucursalId: SUCURSAL_A2.id, sucursal: 'Norte', zonaHoraria: ZONA },
    ],
    almacenes: [
      { sucursalId: SUCURSAL_A1.id, almacenOrigenSrId: 'A1-GEN', almacen: 'General' },
      { sucursalId: SUCURSAL_A1.id, almacenOrigenSrId: 'A1-BAR', almacen: 'Barra' },
      { sucursalId: SUCURSAL_A2.id, almacenOrigenSrId: 'A2-GEN', almacen: 'General norte' },
    ],
    ...p,
  };
}

const DETALLE: TraspasoDetalle = {
  traspaso: RESUMEN,
  zonaHoraria: ZONA,
  partidas: [
    {
      insumoOrigenSrId: 'I1',
      insumo: 'Leche',
      clave: 'LEC',
      unidad: 'L',
      cantidad: '2.500',
      costoUnitario: '30.00',
      importe: '75.00',
      salida: {
        polizaId: 'p-s',
        folio: 'SAL-9',
        referencia: 'TR-9',
        renglon: 0,
        fecha: '2026-09-19T16:00:00.000Z',
      },
      entrada: null,
    },
    {
      insumoOrigenSrId: 'I3',
      insumo: 'Cebolla',
      clave: null,
      unidad: null,
      cantidad: '1.000',
      costoUnitario: null,
      importe: null,
      salida: null,
      entrada: null,
    },
  ],
  totales: { importe: '75.00', sinCosto: 1 },
};

const SR: TraspasosSr = {
  traspasos: [
    {
      referencia: 'TR-9',
      polizas: [
        {
          polizaId: 'p-s',
          folio: 'SAL-9',
          tipo: 'traspaso_salida',
          sucursalId: SUCURSAL_A1.id,
          sucursal: 'Centro',
          almacenOrigenSrId: 'A1-GEN',
          almacen: 'General',
          fecha: '2026-09-19T16:00:00.000Z',
          cancelada: false,
          partidas: 1,
        },
      ],
      traspasosPanel: [{ id: 't-1', folio: 7 }],
    },
  ],
  truncado: false,
  hayPolizas: true,
  sucursales: lista().sucursales,
};

const EXISTENCIAS: Existencias = {
  kpis: { articulos: 2, valor: '0', atencion: 0, sinExistencia: 0, sobreMaximo: 0, sinLectura: 0 },
  filas: [
    {
      sucursalId: SUCURSAL_A1.id,
      sucursal: 'Centro',
      almacenOrigenSrId: 'A1-GEN',
      almacen: 'General',
      insumoOrigenSrId: 'I1',
      insumo: 'Leche',
      clave: 'LEC',
      unidad: 'L',
      cantidad: '3.000',
      costoPromedio: '30.00',
      valor: '90.00',
      minimo: null,
      maximo: null,
      estado: 'sin_limites',
    },
  ],
  almacenes: [],
  sucursales: [],
};

function api(u: UsuarioActual, datos: () => Traspasos = () => lista()) {
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /usuarios': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /alertas/abiertas': () => json(200, []),
    'GET /inventario/traspasos': () => json(200, datos()),
    'GET /inventario/traspasos/sr': () => json(200, SR),
    'GET /inventario/traspasos/t-1': () => json(200, DETALLE),
    'GET /inventario/existencias': () => json(200, EXISTENCIAS),
    'POST /inventario/traspasos': () => json(201, DETALLE),
    'POST /inventario/traspasos/t-1/recibir': () =>
      json(200, {
        ...DETALLE,
        traspaso: { ...RESUMEN, estado: 'recibido', recibidoAt: '2026-09-22T18:00:00.000Z' },
      }),
  });
}

function montar(ruta: string) {
  const queryClient = crearQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  return render(
    <MemoryRouter initialEntries={[ruta]}>
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

const T = { timeout: 5000 };

describe('Traspasos (F2-124) · lista', () => {
  it('flujo y conciliación en palabras, hora de la sucursal; el visor no registra', async () => {
    api(usuario('visor'));
    montar(`/traspasos?empresa=${A}`);
    const fila = (await screen.findByText('#7 · 2 artículos', undefined, T)).closest('tr')!;
    expect(fila).toHaveTextContent('Centro · General');
    expect(fila).toHaveTextContent('Norte · General norte');
    expect(fila).toHaveTextContent('Enviado');
    expect(fila).toHaveTextContent('Sin registrar en SR (alerta)');
    expect(fila).toHaveTextContent('1 de 2 renglones en SR');
    expect(fila).toHaveTextContent('19/09/2026 09:30');
    const otra = screen.getByText('#8 · 2 artículos').closest('tr')!;
    expect(otra).toHaveTextContent('Conciliado con SR');
    expect(otra).not.toHaveTextContent('renglones en SR');
    expect(screen.getByText(/sin conciliar después de 48 h/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Nuevo traspaso' })).not.toBeInTheDocument();
  });

  it('sin almacenes: dice por qué no se puede traspasar, no una tabla vacía', async () => {
    api(usuario('admin_empresa'), () => lista({ traspasos: [], total: 0, almacenes: [] }));
    montar(`/traspasos?empresa=${A}`);
    const vacio = await screen.findByTestId('traspasos-vacio', undefined, T);
    expect(vacio).toHaveTextContent('todavía no conoce ningún almacén');
    expect(vacio).toHaveTextContent('catálogo de SoftRestaurant');
    expect(screen.queryByRole('link', { name: 'Nuevo traspaso' })).not.toBeInTheDocument();
  });

  it('leídos de SR: documento, pólizas y el traspaso del panel que concilia', async () => {
    const user = userEvent.setup();
    const falsa = api(usuario('visor'));
    montar(`/traspasos?empresa=${A}`);
    await user.click(await screen.findByRole('tab', { name: 'Leídos de SoftRestaurant' }, T));
    const fila = (await screen.findByText('TR-9', undefined, T)).closest('tr')!;
    expect(fila).toHaveTextContent('Salida SAL-9 · Centro · General · 19/09/2026 10:00');
    expect(within(fila).getByRole('link', { name: '#7' })).toBeInTheDocument();
    const pedida = falsa.llamadas.find((l: Llamada) => l.ruta === '/inventario/traspasos/sr')!;
    expect(pedida.query.get('empresaId')).toBe(A);
    expect(pedida.query.get('desde')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('leídos de SR sin nada todavía: explica de dónde llegarían', async () => {
    const user = userEvent.setup();
    const falsa = api(usuario('visor'));
    falsa.manejadores['GET /inventario/traspasos/sr'] = (() =>
      json(200, { ...SR, traspasos: [], hayPolizas: false })) as Manejador;
    montar(`/traspasos?empresa=${A}`);
    await user.click(await screen.findByRole('tab', { name: 'Leídos de SoftRestaurant' }, T));
    const vacio = await screen.findByTestId('traspasos-sr-vacio', undefined, T);
    expect(vacio).toHaveTextContent('Todavía no llega ningún traspaso de SoftRestaurant');
    expect(vacio).toHaveTextContent('Si la instalación no usa traspasos');
  });
});

describe('Traspasos (F2-124) · alta', () => {
  it('admin arma el traspaso: valida, avisa sobre la lectura y manda lo capturado', async () => {
    const user = userEvent.setup();
    const falsa = api(usuario('admin_empresa'));
    montar(`/traspasos?empresa=${A}`);
    await user.click(await screen.findByRole('link', { name: 'Nuevo traspaso' }, T));
    const origen = await screen.findByRole('combobox', { name: 'Sale de' }, T);
    expect(
      within(origen)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Centro · General', 'Centro · Barra', 'Norte · General norte']);
    const destino = screen.getByRole('combobox', { name: 'Llega a' });
    // El destino nunca ofrece el mismo almacén del origen.
    expect(
      within(destino)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Centro · Barra', 'Norte · General norte']);
    await user.selectOptions(
      destino,
      within(destino).getByRole('option', { name: 'Norte · General norte' }),
    );

    // Sin artículos: no se manda.
    await user.click(screen.getByRole('button', { name: 'Enviar traspaso' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Agrega al menos un artículo.');

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Artículo' }, T), 'I1');
    await user.click(screen.getByRole('button', { name: 'Agregar' }));
    const cantidad = screen.getByRole('textbox', { name: 'Leche (L)' });
    await user.type(cantidad, '3.5');
    expect(
      screen.getByText('Más de lo que dice la última lectura del almacén de origen.'),
    ).toBeInTheDocument();
    await user.clear(cantidad);
    await user.type(cantidad, '2.5');
    await user.click(screen.getByRole('button', { name: 'Enviar traspaso' }));
    expect(await screen.findByTestId('traspaso-reporte', undefined, T)).toBeInTheDocument();
    const post = falsa.llamadas.find(
      (l: Llamada) => l.metodo === 'POST' && l.ruta === '/inventario/traspasos',
    )!;
    expect(post.cuerpo).toEqual({
      empresaId: A,
      sucursalOrigenId: SUCURSAL_A1.id,
      almacenOrigenSrId: 'A1-GEN',
      sucursalDestinoId: SUCURSAL_A2.id,
      almacenDestinoSrId: 'A2-GEN',
      partidas: [{ insumoOrigenSrId: 'I1', cantidad: '2.5' }],
    });
  });

  it('el visor no puede registrar', async () => {
    api(usuario('visor'));
    montar(`/traspasos/nuevo?empresa=${A}`);
    expect(
      await screen.findByText(
        'Tu usuario puede ver los traspasos, pero no registrarlos.',
        undefined,
        T,
      ),
    ).toBeInTheDocument();
  });
});

describe('Traspasos (F2-124) · detalle', () => {
  it('reporte: renglones con su espejo en SR, importe y lo que no tiene costo', async () => {
    api(usuario('visor'));
    montar(`/traspasos/t-1?empresa=${A}`);
    const reporte = await screen.findByTestId('traspaso-reporte', undefined, T);
    expect(reporte).toHaveTextContent('Traspaso #7');
    expect(reporte).toHaveTextContent('Sin registrar en SR (alerta)');
    expect(screen.getByTestId('traspaso-pendiente')).toHaveTextContent('Ya pasó el plazo');
    const leche = reporte.querySelector('[data-partida="I1"]')!;
    expect(leche).toHaveTextContent('2.5 L');
    expect(leche).toHaveTextContent('$75.00');
    expect(leche).toHaveTextContent('SAL-9 · 19/09/2026 10:00');
    expect(leche).toHaveTextContent('Todavía no aparece');
    const cebolla = reporte.querySelector('[data-partida="I3"]')!;
    expect(cebolla).toHaveTextContent('Sin lectura');
    expect(screen.getByTestId('traspaso-total')).toHaveTextContent('$75.00');
    expect(reporte).toHaveTextContent('1 artículo(s) sin costo');
    // El visor imprime, pero no confirma ni cancela.
    expect(screen.getByRole('button', { name: 'Imprimir reporte' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar recepción' })).not.toBeInTheDocument();
  });

  it('imprimir abre el diálogo del navegador', async () => {
    const user = userEvent.setup();
    const imprimir = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    api(usuario('visor'));
    montar(`/traspasos/t-1?empresa=${A}`);
    await user.click(await screen.findByRole('button', { name: 'Imprimir reporte' }, T));
    expect(imprimir).toHaveBeenCalledTimes(1);
  });

  it('admin confirma la recepción en la página (sin diálogos del navegador)', async () => {
    const user = userEvent.setup();
    const falsa = api(usuario('admin_empresa'));
    montar(`/traspasos/t-1?empresa=${A}`);
    await user.click(await screen.findByRole('button', { name: 'Confirmar recepción' }, T));
    // Con un renglón ya registrado en SR no se ofrece cancelar.
    expect(screen.queryByRole('button', { name: 'Cancelar traspaso' })).not.toBeInTheDocument();
    expect(screen.getByTestId('traspaso-confirmar')).toHaveTextContent(
      'recibió todos los artículos',
    );
    await user.click(screen.getByRole('button', { name: 'Sí, recibido' }));
    expect(
      await screen.findByText('Recibido', { selector: '[data-testid="traspaso-estado"]' }, T),
    ).toBeInTheDocument();
    const post = falsa.llamadas.find(
      (l: Llamada) => l.ruta === '/inventario/traspasos/t-1/recibir',
    )!;
    expect(post.cuerpo).toEqual({ empresaId: A });
  });

  it('sin espejo en SR se puede cancelar; un 409 se explica en palabras', async () => {
    const user = userEvent.setup();
    const falsa = api(usuario('admin_empresa'));
    const sinEspejo = {
      ...DETALLE,
      partidas: DETALLE.partidas.map((p) => ({ ...p, salida: null, entrada: null })),
    };
    falsa.manejadores['GET /inventario/traspasos/t-1'] = (() => json(200, sinEspejo)) as Manejador;
    falsa.manejadores['POST /inventario/traspasos/t-1/cancelar'] = (() =>
      json(409, { statusCode: 409, message: 'ya tiene movimientos' })) as Manejador;
    montar(`/traspasos/t-1?empresa=${A}`);
    await user.click(await screen.findByRole('button', { name: 'Cancelar traspaso' }, T));
    await user.click(screen.getByRole('button', { name: 'Sí, cancelar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se puede cancelar');
  });
});
