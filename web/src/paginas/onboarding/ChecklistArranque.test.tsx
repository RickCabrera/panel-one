import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Arranque, Rol } from '../../api/tipos';
import { Proveedores, Rutas } from '../../App';
import { terminarSesion } from '../../auth/sesion';
import { crearQueryClient } from '../../consultas/queryClient';
import {
  EMPRESA_A,
  instalarApiFalsa,
  json,
  sesion,
  SUCURSAL_A1,
  usuario,
} from '../../test/apiFalsa';

// La lista de arranque en Inicio (F2-147): se ve mientras falte algo, desaparece completa, y el
// visor ni la pide (la API le daría 403 por ruta).

const A = EMPRESA_A.id;

function arranque(completo: boolean): Arranque {
  return {
    empresaId: A,
    completo,
    descargaAgente: null,
    pasos: [
      {
        clave: 'sucursales',
        titulo: 'Dar de alta las sucursales',
        hecho: true,
        detalle: '1 sucursal activa.',
        pendientes: [],
      },
      {
        clave: 'llaves',
        titulo: 'Generar la API key de cada sucursal',
        hecho: completo,
        detalle: completo
          ? 'Todas las sucursales tienen su key.'
          : 'Falta la key en 1 de 1 sucursal.',
        pendientes: completo ? [] : [{ sucursalId: SUCURSAL_A1.id, nombre: 'Centro' }],
      },
      {
        clave: 'agente',
        titulo: 'Instalar el agente en cada sucursal',
        hecho: completo,
        detalle: '—',
        pendientes: [],
      },
      {
        clave: 'ventas',
        titulo: 'Recibir la primera venta',
        hecho: true,
        detalle:
          'Hay ventas registradas, pero de sucursales cuyo agente nunca se ha reportado: son datos de demostración o de un agente anterior.',
        pendientes: [],
      },
      {
        clave: 'usuario',
        titulo: 'Crear el usuario administrador de la empresa',
        hecho: true,
        detalle: '1 administrador activo.',
        pendientes: [],
      },
    ],
  };
}

function montar(rol: Rol, respuesta: () => Response) {
  const yo = usuario(rol);
  const api = instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(yo)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1]),
    [`GET /empresas/${A}/arranque`]: respuesta,
  });
  const queryClient = crearQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  render(
    <MemoryRouter initialEntries={[`/?empresa=${A}`]}>
      <Proveedores queryClient={queryClient}>
        <Rutas />
      </Proveedores>
    </MemoryRouter>,
  );
  return api;
}

afterEach(() => {
  cleanup();
  terminarSesion('cerrada');
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('Lista de arranque en Inicio (F2-147)', () => {
  it('incompleta: se ve, dice qué falta y a dónde ir, conservando la empresa', async () => {
    montar('admin_empresa', () => json(200, arranque(false)));
    const lista = await screen.findByRole('region', { name: 'Lista de arranque' });
    expect(within(lista).getByText('3 de 5 pasos')).toBeInTheDocument();
    expect(within(lista).getByText('Falta en: Centro')).toBeInTheDocument();
    expect(
      within(lista).getByLabelText('Generar la API key de cada sucursal: pendiente'),
    ).toBeInTheDocument();
    const ir = within(lista).getByRole('link', { name: 'Generar keys en Sucursales' });
    expect(ir.getAttribute('href')).toBe(`/admin?empresa=${A}&tab=sucursales`);
    expect(within(lista).getByRole('link', { name: 'Ver la guía de instalación' })).toHaveAttribute(
      'href',
      `/ayuda/agente?empresa=${A}`,
    );
    // Ventas del seed sin agente: lo dice, no finge.
    expect(within(lista).getByText(/son datos de demostración/)).toBeInTheDocument();
    // Sin descarga configurada: la razón, no un enlace roto.
    expect(within(lista).getByText(/pídelo a soporte/)).toBeInTheDocument();
  });

  it('completa: no se muestra', async () => {
    const api = montar('admin_global', () => json(200, arranque(true)));
    await screen.findByRole('heading', { name: 'Panel de ventas' });
    await vi.waitFor(() => expect(api.contar('GET', `/empresas/${A}/arranque`)).toBe(1));
    expect(screen.queryByRole('region', { name: 'Lista de arranque' })).not.toBeInTheDocument();
  });

  it('visor: ni la pide ni la muestra', async () => {
    const api = montar('visor', () => json(403, { statusCode: 403, message: 'Forbidden' }));
    await screen.findByRole('heading', { name: 'Panel de ventas' });
    expect(api.contar('GET', `/empresas/${A}/arranque`)).toBe(0);
    expect(screen.queryByRole('region', { name: 'Lista de arranque' })).not.toBeInTheDocument();
  });

  it('si el api falla, lo dice en vez de esconder que no se pudo revisar', async () => {
    montar('admin_empresa', () => json(500, { statusCode: 500, message: 'x' }));
    expect(
      await screen.findByText('No se pudo revisar la lista de arranque de la empresa.'),
    ).toBeInTheDocument();
  });
});
