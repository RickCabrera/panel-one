import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NotificacionesCuenta, PreferenciasPush, Rol } from '../api/tipos';
import { Proveedores, Rutas } from '../App';
import { terminarSesion } from '../auth/sesion';
import { crearQueryClient } from '../consultas/queryClient';
import { llaveABytes } from '../pwa/push';
import {
  EMPRESA_A,
  instalarApiFalsa,
  json,
  sesion,
  SUCURSAL_A1,
  usuario,
  type Manejador,
} from '../test/apiFalsa';
import { ENDPOINT_FALSO, instalarPushFalso, quitarPushFalso } from '../test/pushFalso';

// F2-146 en el web: la sección "Notificaciones" de Mi cuenta (este dispositivo + qué avisos),
// el aviso de "sin conexión" y la baja del navegador al salir, contra la app real, una API
// falsa y un navegador con push falso.

const CLAVE =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const APAGADAS: PreferenciasPush = {
  mesaAbierta: false,
  sucursalSinReporte: false,
  foliosBajo: false,
  cierreDia: false,
};

function vista(p: Partial<NotificacionesCuenta> = {}, rol: Rol = 'visor'): NotificacionesCuenta {
  return {
    clavePublica: CLAVE,
    preferencias: APAGADAS,
    disponibles:
      rol === 'admin_global'
        ? ['mesa_abierta', 'sucursal_sin_reporte', 'folios_bajo', 'cierre_dia']
        : ['mesa_abierta', 'sucursal_sin_reporte', 'cierre_dia'],
    dispositivos: 0,
    ...p,
  };
}

function api(rol: Rol = 'visor', extra: Record<string, Manejador> = {}) {
  const u = usuario(rol);
  let guardadas = APAGADAS;
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'POST /auth/logout': () => new Response(null, { status: 204 }),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1]),
    'GET /mesas/abiertas': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /alertas/abiertas': () => json(200, []),
    'GET /cuenta/reportes': () =>
      json(200, {
        empresaId: EMPRESA_A.id,
        diario: false,
        semanal: false,
        zonaHoraria: 'America/Mexico_City',
        horaEnvio: 7,
        ultimosEnvios: [],
      }),
    'GET /cuenta/notificaciones': () => json(200, vista({ preferencias: guardadas }, rol)),
    'PUT /cuenta/notificaciones/preferencias': (l) => {
      guardadas = l.cuerpo as PreferenciasPush;
      return json(200, vista({ preferencias: guardadas }, rol));
    },
    ...extra,
  });
}

function montar(ruta = `/cuenta?empresa=${EMPRESA_A.id}`) {
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

const seccion = async () => within(await screen.findByRole('region', { name: 'Notificaciones' }));

afterEach(() => {
  cleanup();
  quitarPushFalso();
  terminarSesion('cerrada');
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('Mi cuenta → Notificaciones: qué avisos', () => {
  it('un interruptor por aviso; cada uno se guarda SOLO, sin tocar los demás', async () => {
    const falsa = api();
    montar();
    const s = await seccion();
    const sucursal = await s.findByRole('checkbox', { name: /Sucursal desconectada/ });
    const mesa = s.getByRole('checkbox', { name: /Mesa abierta demasiado tiempo/ });
    const cierre = s.getByRole('checkbox', { name: /Resumen de cierre del día/ });
    expect([sucursal, mesa, cierre].map((c) => (c as HTMLInputElement).checked)).toEqual([
      false,
      false,
      false,
    ]);

    await userEvent.click(sucursal);
    await waitFor(() => expect(sucursal).toBeChecked());
    await userEvent.click(cierre);
    await waitFor(() => expect(cierre).toBeChecked());
    await userEvent.click(sucursal);
    await waitFor(() => expect(sucursal).not.toBeChecked());

    const puts = falsa.llamadas
      .filter((l) => l.ruta === '/cuenta/notificaciones/preferencias')
      .map((l) => l.cuerpo);
    expect(puts).toEqual([
      { ...APAGADAS, sucursalSinReporte: true },
      { ...APAGADAS, sucursalSinReporte: true, cierreDia: true },
      { ...APAGADAS, cierreDia: true },
    ]);
    expect(cierre).toBeChecked();
  });

  it('folios sólo aparece para admin_global', async () => {
    api('admin_empresa');
    montar();
    const s = await seccion();
    await s.findByRole('checkbox', { name: /Sucursal desconectada/ });
    expect(s.queryByRole('checkbox', { name: /Saldo de folios bajo/ })).toBeNull();
    cleanup();
    terminarSesion('cerrada');

    api('admin_global');
    montar();
    expect(
      await (await seccion()).findByRole('checkbox', { name: /Saldo de folios bajo/ }),
    ).toBeVisible();
  });

  it('un PUT rechazado lo dice y el interruptor queda como estaba', async () => {
    api('visor', {
      'PUT /cuenta/notificaciones/preferencias': () =>
        json(400, {
          statusCode: 400,
          message: 'El aviso de saldo de folios sólo lo puede activar un administrador global.',
        }),
    });
    montar();
    const s = await seccion();
    const mesa = await s.findByRole('checkbox', { name: /Mesa abierta/ });
    await userEvent.click(mesa);
    expect(await s.findByRole('alert')).toHaveTextContent(/No se guardó/);
    expect(mesa).not.toBeChecked();
  });
});

describe('Mi cuenta → Notificaciones: este dispositivo', () => {
  it('navegador sin push: lo dice (y qué hacer en iPhone); los avisos se configuran igual', async () => {
    api();
    montar();
    const s = await seccion();
    expect(await s.findByText(/Este navegador no admite notificaciones/)).toBeVisible();
    expect(s.queryByRole('button', { name: /Activar/ })).toBeNull();
    expect(s.getByRole('checkbox', { name: /Sucursal desconectada/ })).toBeEnabled();
  });

  it('servidor sin llaves VAPID: lo dice, sin botón de activar', async () => {
    instalarPushFalso();
    api('visor', { 'GET /cuenta/notificaciones': () => json(200, vista({ clavePublica: null })) });
    montar();
    const s = await seccion();
    expect(await s.findByText(/no tiene notificaciones configuradas/)).toBeVisible();
    expect(s.queryByRole('button', { name: /Activar/ })).toBeNull();
  });

  it('bloqueado por el usuario: dice cómo desbloquear', async () => {
    instalarPushFalso({ permiso: 'denied' });
    api();
    montar();
    expect(await (await seccion()).findByText(/Bloqueaste las notificaciones/)).toBeVisible();
  });

  it('activar: pide permiso, suscribe y registra; queda "activas" con prueba y desactivar', async () => {
    const nav = instalarPushFalso();
    const falsa = api('visor', {
      'POST /cuenta/notificaciones/dispositivos': () => json(200, vista({ dispositivos: 1 })),
      'POST /cuenta/notificaciones/prueba': () =>
        json(200, { entregados: 1, descartados: 0, fallidos: 0 }),
    });
    montar();
    const s = await seccion();
    await userEvent.click(await s.findByRole('button', { name: 'Activar en este dispositivo' }));
    expect(await s.findByText(/Activas en este dispositivo/)).toBeVisible();
    expect(nav.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: llaveABytes(CLAVE),
    });
    expect(falsa.contar('POST', '/cuenta/notificaciones/dispositivos')).toBe(1);
    expect(s.getByText(/tienes 1 registrado/)).toBeVisible();

    await userEvent.click(s.getByRole('button', { name: 'Enviar prueba' }));
    expect(await s.findByText(/Enviada a 1 dispositivo/)).toBeVisible();
  });

  it('prueba que no llega a nadie: dice qué hacer', async () => {
    instalarPushFalso({ permiso: 'granted', suscritaCon: llaveABytes(CLAVE) });
    api('visor', {
      'POST /cuenta/notificaciones/dispositivos': () => json(200, vista({ dispositivos: 1 })),
      'POST /cuenta/notificaciones/prueba': () =>
        json(200, { entregados: 0, descartados: 1, fallidos: 0 }),
    });
    montar();
    const s = await seccion();
    await userEvent.click(await s.findByRole('button', { name: 'Enviar prueba' }));
    expect(await s.findByText(/No se entregó a ningún dispositivo/)).toBeVisible();
  });

  it('desactivar: DELETE al api y baja en el navegador; vuelve a "Activar"', async () => {
    const nav = instalarPushFalso({ permiso: 'granted', suscritaCon: llaveABytes(CLAVE) });
    const falsa = api('visor', {
      'POST /cuenta/notificaciones/dispositivos': () => json(200, vista({ dispositivos: 1 })),
      'DELETE /cuenta/notificaciones/dispositivos': () => json(200, vista()),
    });
    montar();
    const s = await seccion();
    await userEvent.click(await s.findByRole('button', { name: 'Desactivar en este dispositivo' }));
    expect(await s.findByRole('button', { name: 'Activar en este dispositivo' })).toBeVisible();
    expect(falsa.contar('DELETE', '/cuenta/notificaciones/dispositivos')).toBe(1);
    expect(nav.bajas).toEqual([ENDPOINT_FALSO]);
  });

  it('con el panel abierto y la suscripción viva, el layout RENUEVA el registro', async () => {
    instalarPushFalso({ permiso: 'granted', suscritaCon: llaveABytes(CLAVE) });
    const falsa = api('visor', {
      'POST /cuenta/notificaciones/dispositivos': () => json(200, vista({ dispositivos: 1 })),
    });
    montar(`/?empresa=${EMPRESA_A.id}`);
    await waitFor(() =>
      expect(falsa.contar('POST', '/cuenta/notificaciones/dispositivos')).toBe(1),
    );
  });

  it('al salir, este navegador se da de baja ANTES del logout', async () => {
    const nav = instalarPushFalso({ permiso: 'granted', suscritaCon: llaveABytes(CLAVE) });
    const falsa = api('visor', {
      'POST /cuenta/notificaciones/dispositivos': () => json(200, vista({ dispositivos: 1 })),
      'DELETE /cuenta/notificaciones/dispositivos': () => json(200, vista()),
    });
    montar();
    await seccion();
    await userEvent.click(await screen.findByRole('button', { name: /Salir/ }));
    await waitFor(() => expect(falsa.contar('POST', '/auth/logout')).toBe(1));
    const rutas = falsa.llamadas.map((l) => `${l.metodo} ${l.ruta}`);
    expect(rutas.indexOf('DELETE /cuenta/notificaciones/dispositivos')).toBeGreaterThan(-1);
    expect(rutas.indexOf('DELETE /cuenta/notificaciones/dispositivos')).toBeLessThan(
      rutas.indexOf('POST /auth/logout'),
    );
    expect(nav.bajas).toEqual([ENDPOINT_FALSO]);
  });
});

describe('sin conexión', () => {
  it('sin red, el layout lo dice; al volver, desaparece', async () => {
    api();
    const enLinea = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    montar(`/?empresa=${EMPRESA_A.id}`);
    expect(await screen.findByTestId('sin-conexion')).toHaveTextContent(/Sin conexión a internet/);
    enLinea.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByTestId('sin-conexion')).toBeNull();
    enLinea.mockRestore();
  });
});
