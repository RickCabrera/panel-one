import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Rol, SuscripcionReporte } from '../api/tipos';
import { Proveedores, Rutas } from '../App';
import { terminarSesion } from '../auth/sesion';
import { crearQueryClient } from '../consultas/queryClient';
import {
  EMPRESA_A,
  instalarApiFalsa,
  json,
  noAutorizado,
  sesion,
  SUCURSAL_A1,
  usuario,
  type Manejador,
} from '../test/apiFalsa';

// F2-141 en el web: la sección "Reportes por correo" de Mi cuenta y la página PÚBLICA de
// baja, contra el router y la app reales y una API falsa.

const A = EMPRESA_A.id;

function suscripcion(p: Partial<SuscripcionReporte> = {}): SuscripcionReporte {
  return {
    empresaId: A,
    diario: false,
    semanal: false,
    zonaHoraria: 'America/Mexico_City',
    horaEnvio: 7,
    ultimosEnvios: [],
    ...p,
  };
}

function api(rol: Rol = 'visor', extra: Record<string, Manejador> = {}) {
  const u = usuario(rol);
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1]),
    'GET /mesas/abiertas': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /alertas/abiertas': () => json(200, []),
    'GET /cuenta/reportes': () => json(200, suscripcion()),
    ...extra,
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

const seccion = async () =>
  within(await screen.findByRole('region', { name: 'Reportes por correo' }));

afterEach(() => {
  cleanup();
  terminarSesion('cerrada');
  window.localStorage.clear();
  vi.unstubAllGlobals();
  document.head.querySelectorAll('meta[name="referrer"]').forEach((m) => m.remove());
});

describe('Mi cuenta → Reportes por correo', () => {
  it('pide la suscripción de la empresa elegida y dice hora, zona y destinatario', async () => {
    const falsa = api();
    montar(`/cuenta?empresa=${A}`);
    const s = await seccion();
    expect(await s.findByText(/a las 7:00 \(hora de America\/Mexico_City\)/)).toBeVisible();
    expect(s.getByText(usuario('visor').email)).toBeVisible();
    expect(falsa.llamadas.find((l) => l.ruta === '/cuenta/reportes')?.query.get('empresaId')).toBe(
      A,
    );
    expect(s.getByRole('checkbox', { name: /Resumen diario/ })).not.toBeChecked();
    expect(s.getByText(/No tienes reportes activos/)).toBeVisible();
    // Sin cambios no hay nada que guardar.
    expect(s.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  it('activar el diario y guardar manda el PUT con la empresa y refleja lo guardado', async () => {
    const falsa = api('visor', {
      'PUT /cuenta/reportes': (l) => {
        const c = l.cuerpo as { diario: boolean; semanal: boolean };
        return json(200, suscripcion({ diario: c.diario, semanal: c.semanal }));
      },
    });
    montar(`/cuenta?empresa=${A}`);
    const s = await seccion();
    await userEvent.click(await s.findByRole('checkbox', { name: /Resumen diario/ }));
    await userEvent.click(s.getByRole('button', { name: 'Guardar' }));
    expect(await s.findByRole('status')).toHaveTextContent('Guardado.');
    const put = falsa.llamadas.find((l) => l.metodo === 'PUT');
    expect(put?.cuerpo).toEqual({ empresaId: A, diario: true, semanal: false });
    expect(s.getByRole('checkbox', { name: /Resumen diario/ })).toBeChecked();
    expect(s.getByText(/Todavía no sale ninguno: el primero llega a las 7:00/)).toBeVisible();
  });

  it('un error al guardar se dice y no finge "Guardado"', async () => {
    api('visor', {
      'PUT /cuenta/reportes': () =>
        json(404, { statusCode: 404, message: 'Recurso no encontrado' }),
    });
    montar(`/cuenta?empresa=${A}`);
    const s = await seccion();
    await userEvent.click(await s.findByRole('checkbox', { name: /Resumen semanal/ }));
    await userEvent.click(s.getByRole('button', { name: 'Guardar' }));
    expect(await s.findByRole('alert')).toHaveTextContent('No se guardó: Recurso no encontrado');
    expect(s.queryByRole('status')).toBeNull();
  });

  it('lista los últimos envíos con su estado en palabras', async () => {
    api('visor', {
      'GET /cuenta/reportes': () =>
        json(
          200,
          suscripcion({
            diario: true,
            semanal: true,
            ultimosEnvios: [
              {
                tipo: 'diario',
                periodo: '2026-09-21',
                estado: 'enviado',
                intentos: 1,
                creadoAt: '2026-09-22T13:00:00Z',
                enviadoAt: '2026-09-22T13:00:01Z',
              },
              {
                tipo: 'semanal',
                periodo: '2026-09-14',
                estado: 'fallido',
                intentos: 1,
                creadoAt: '2026-09-21T13:00:00Z',
                enviadoAt: null,
              },
            ],
          }),
        ),
    });
    montar(`/cuenta?empresa=${A}`);
    const s = await seccion();
    const items = within(await s.findByTestId('envios-reporte')).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Resumen diario · 21 sep 2026 · Enviado',
      'Resumen semanal · semana del 14 sep 2026 · Falló; se reintenta hoy',
    ]);
  });

  it('"Ver un ejemplo" muestra el correo en un iframe sin permisos', async () => {
    const falsa = api('visor', {
      'GET /cuenta/reportes/vista-previa': (l) =>
        json(200, {
          tipo: l.query.get('tipo'),
          periodo: '2026-09-21',
          asunto: 'Resumen del lunes 21 de septiembre de 2026 · Empresa A',
          html: '<p>Venta total: $400.00</p><script>alert(1)</script>',
          texto: 'Venta total: $400.00',
        }),
    });
    montar(`/cuenta?empresa=${A}`);
    const s = await seccion();
    await userEvent.click(await s.findByRole('button', { name: 'Resumen diario' }));
    const iframe = await s.findByTitle(/Ejemplo: Resumen del lunes 21/);
    expect(iframe).toHaveAttribute('sandbox', '');
    expect(iframe.getAttribute('srcdoc')).toContain('$400.00');
    expect(s.getByText(/Asunto:/).parentElement).toHaveTextContent(
      'Resumen del lunes 21 de septiembre de 2026 · Empresa A',
    );
    const previa = falsa.llamadas.find((l) => l.ruta === '/cuenta/reportes/vista-previa');
    expect(previa?.query.get('tipo')).toBe('diario');
    expect(previa?.query.get('empresaId')).toBe(A);
  });

  it('si la API no responde la suscripción, lo dice (no pinta casillas apagadas)', async () => {
    api('visor', {
      'GET /cuenta/reportes': () => json(500, { statusCode: 500, message: 'Falla' }),
    });
    montar(`/cuenta?empresa=${A}`);
    const s = await seccion();
    expect(await s.findByRole('alert')).toHaveTextContent(
      'No se pudo leer tu configuración de reportes',
    );
    expect(s.queryByRole('checkbox')).toBeNull();
  });
});

describe('Baja desde el correo (pública)', () => {
  const RUTA = '/reportes/baja?t=00000000-0000-4000-8000-000000000001.firma&tipo=diario';

  it('abre SIN sesión, no redirige al login y no da de baja al cargar', async () => {
    const falsa = api('visor', { 'POST /auth/refresh': () => noAutorizado() });
    montar(RUTA);
    expect(await screen.findByText('¿Dejar de recibir el resumen diario?')).toBeVisible();
    await waitFor(() => expect(falsa.contar('POST', '/auth/refresh')).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: /Entrar|Iniciar sesión/ })).toBeNull();
    expect(falsa.contar('POST', '/reportes/baja')).toBe(0);
    expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute(
      'content',
      'no-referrer',
    );
  });

  it('confirmar manda el token y el tipo, sin Authorization, y dice cómo quedó', async () => {
    const falsa = api('visor', {
      'POST /auth/refresh': () => noAutorizado(),
      'POST /reportes/baja': () => json(200, { diario: false, semanal: true }),
    });
    montar(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Sí, dejar de recibirlo' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Listo: ya no recibirás el resumen diario. Sigues recibiendo el resumen semanal.',
    );
    const post = falsa.llamadas.find((l) => l.ruta === '/reportes/baja');
    expect(post?.cuerpo).toEqual({
      token: '00000000-0000-4000-8000-000000000001.firma',
      tipo: 'diario',
    });
    expect(post?.autorizacion).toBeNull();
  });

  it('un enlace inválido lo dice y deja reintentar; sin token ni siquiera ofrece el botón', async () => {
    api('visor', {
      'POST /auth/refresh': () => noAutorizado(),
      'POST /reportes/baja': () =>
        json(404, { statusCode: 404, message: 'El enlace no es válido.' }),
    });
    montar(RUTA);
    await userEvent.click(await screen.findByRole('button', { name: 'Sí, dejar de recibirlo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Este enlace no es válido');
    cleanup();
    montar('/reportes/baja');
    expect(await screen.findByRole('alert')).toHaveTextContent('El enlace está incompleto');
    expect(screen.queryByRole('button', { name: 'Sí, dejar de recibirlo' })).toBeNull();
  });
});
