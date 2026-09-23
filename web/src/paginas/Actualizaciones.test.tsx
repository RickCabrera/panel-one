import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EstadoAgenteSucursal, Rol, VersionAgente } from '../api/tipos';
import { Proveedores, Rutas } from '../App';
import { describirAlerta, NOMBRE_TIPO, textoRegla } from '../alertas/textos';
import { terminarSesion } from '../auth/sesion';
import { crearQueryClient } from '../consultas/queryClient';
import { estadoActualizacion } from './admin/reglasActualizacion';
import {
  EMPRESA_A,
  EMPRESA_B,
  instalarApiFalsa,
  json,
  sesion,
  SUCURSAL_A1,
  SUCURSAL_A2,
  usuario,
  type Manejador,
} from '../test/apiFalsa';

// Auto-update del agente (F2-143) desde la administración, contra una API falsa: el canal de
// versiones (publicar, retirar) y la bandera de rollout por sucursal. Que el api respete la
// bandera, firme la descarga y calcule el SHA lo prueba su e2e; el swap, los tests del agente.

const A = EMPRESA_A.id;
const SHA = 'ab'.repeat(32);

function version(v: string, extra: Partial<VersionAgente> = {}): VersionAgente {
  return {
    version: v,
    sha256: SHA,
    tamanoBytes: 70 * 1024 * 1024,
    notas: null,
    publicadaAt: '2026-09-23T18:00:00Z',
    retiradaAt: null,
    vigente: false,
    ...extra,
  };
}

function fila(
  sucursal: { id: string; nombre: string; zonaHoraria: string },
  extra: Partial<EstadoAgenteSucursal> = {},
): EstadoAgenteSucursal {
  return {
    sucursalId: sucursal.id,
    nombre: sucursal.nombre,
    zonaHoraria: sucursal.zonaHoraria,
    ultimoContactoAt: '2026-09-23T18:00:00Z',
    edadContactoSegundos: 10,
    ultimaLecturaAt: null,
    edadLecturaSegundos: null,
    versionAgente: '1.0.0+abc1234',
    versionSr: '10.0',
    tamanoCola: 0,
    latenciaQueryMs: 12,
    ultimoError: null,
    actualizacionAutomatica: false,
    versionObjetivo: null,
    actualizacion: null,
    ...extra,
  };
}

function apiActualizaciones(
  rol: Rol,
  { versiones, estado }: { versiones: Manejador; estado: Manejador },
  extra: Record<string, Manejador> = {},
) {
  const yo = usuario(rol);
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(yo)),
    'GET /empresas': () => json(200, rol === 'admin_global' ? [EMPRESA_A, EMPRESA_B] : [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /usuarios': () => json(200, []),
    'GET /agentes/estado': estado,
    'GET /agente/versiones': versiones,
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
  vi.unstubAllGlobals();
});

describe('Administración › Actualizaciones (F2-143)', () => {
  it('sólo admin_global ve la pestaña; admin_empresa no', async () => {
    apiActualizaciones('admin_empresa', {
      versiones: () => json(403, {}),
      estado: () => json(200, []),
    });
    montar(`/admin?empresa=${A}&tab=actualizaciones`);
    await screen.findByRole('tab', { name: 'Sucursales' });
    expect(screen.queryByRole('tab', { name: 'Actualizaciones' })).toBeNull();
    // Con el ?tab= a mano, cae en Sucursales.
    expect(screen.getByRole('tab', { name: 'Sucursales' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('sin versiones publicadas lo dice (no una tabla vacía) y las sucursales salen en manual', async () => {
    apiActualizaciones('admin_global', {
      versiones: () => json(200, []),
      estado: () => json(200, [fila(SUCURSAL_A1)]),
    });
    montar(`/admin?empresa=${A}&tab=actualizaciones`);
    expect(
      await screen.findByText(
        /Todavía no hay versiones publicadas: ninguna sucursal se actualiza sola/,
      ),
    ).toBeVisible();
    const centro = await screen.findByRole('row', { name: 'Centro' });
    expect(within(centro).getByRole('switch')).not.toBeChecked();
    expect(centro).toHaveTextContent('Manual: no se actualiza sola');
  });

  it('lista las versiones con la vigente marcada, y retirar pide confirmación', async () => {
    const api = apiActualizaciones(
      'admin_global',
      {
        versiones: () =>
          json(200, [
            version('1.1.0', { vigente: true, notas: 'arregla la cola' }),
            version('1.0.0'),
            version('0.9.0', { retiradaAt: '2026-09-22T12:00:00Z' }),
          ]),
        estado: () => json(200, []),
      },
      { 'POST /agente/versiones/1.1.0/retirar': () => json(200, version('1.1.0')) },
    );
    montar(`/admin?empresa=${A}&tab=actualizaciones`);

    const vigente = await screen.findByRole('row', { name: '1.1.0' });
    expect(vigente).toHaveTextContent('Vigente');
    expect(vigente).toHaveTextContent('arregla la cola');
    expect(vigente).toHaveTextContent('70 MB');
    expect(vigente).toHaveTextContent(`${SHA.slice(0, 12)}…`);
    expect(screen.getByRole('row', { name: '1.0.0' })).toHaveTextContent('Anterior');
    const retirada = screen.getByRole('row', { name: '0.9.0' });
    expect(retirada).toHaveTextContent('Retirada');
    expect(within(retirada).queryByRole('button', { name: 'Retirar' })).toBeNull();

    await userEvent.click(within(vigente).getByRole('button', { name: 'Retirar' }));
    expect(api.contar('POST', '/agente/versiones/1.1.0/retirar')).toBe(0);
    await userEvent.click(within(vigente).getByRole('button', { name: 'Sí, retirar 1.1.0' }));
    await waitFor(() => expect(api.contar('POST', '/agente/versiones/1.1.0/retirar')).toBe(1));
  });

  it('publicar manda el archivo TAL CUAL como octet-stream, con versión y notas en la query', async () => {
    let versiones: VersionAgente[] = [];
    const api = apiActualizaciones(
      'admin_global',
      { versiones: () => json(200, versiones), estado: () => json(200, []) },
      {
        'POST /agente/versiones': () => {
          versiones = [version('1.2.0', { vigente: true })];
          return json(201, versiones[0]);
        },
      },
    );
    montar(`/admin?empresa=${A}&tab=actualizaciones`);
    const form = await screen.findByRole('form', { name: 'Publicar versión' });
    const boton = within(form).getByRole('button', { name: 'Publicar versión' });
    expect(boton).toBeDisabled();

    const exe = new File([new Uint8Array([77, 90, 1, 2, 3])], 'agente.exe', {
      type: 'application/octet-stream',
    });
    await userEvent.upload(within(form).getByLabelText('Archivo agente.exe'), exe);
    await userEvent.type(within(form).getByLabelText('Versión (X.Y.Z)'), '1.2');
    expect(within(form).getByText('Tiene que ser X.Y.Z, por ejemplo 1.4.0.')).toBeVisible();
    expect(boton).toBeDisabled();
    await userEvent.type(within(form).getByLabelText('Versión (X.Y.Z)'), '.0');
    await userEvent.type(within(form).getByLabelText('Notas (opcional)'), 'primera');
    await userEvent.click(boton);

    expect(await screen.findByRole('status')).toHaveTextContent(
      `Versión 1.2.0 publicada (SHA-256 ${SHA.slice(0, 12)}…).`,
    );
    const llamada = api.llamadas.find(
      (l) => l.metodo === 'POST' && l.ruta === '/agente/versiones',
    )!;
    expect(llamada.query.get('version')).toBe('1.2.0');
    expect(llamada.query.get('notas')).toBe('primera');
    expect(llamada.contentType).toBe('application/octet-stream');
    expect(llamada.binario).toBe(exe);
    expect(await screen.findByRole('row', { name: '1.2.0' })).toHaveTextContent('Vigente');
  });

  it('la bandera por sucursal: encenderla hace el PUT de ESA sucursal, y cada estado se dice con palabras', async () => {
    let a1Encendida = false;
    const api = apiActualizaciones(
      'admin_global',
      {
        versiones: () => json(200, [version('1.1.0', { vigente: true })]),
        estado: () =>
          json(200, [
            fila(SUCURSAL_A1, {
              actualizacionAutomatica: a1Encendida,
              versionObjetivo: a1Encendida ? '1.1.0' : null,
            }),
            fila(SUCURSAL_A2, {
              actualizacionAutomatica: true,
              versionObjetivo: '1.1.0',
              actualizacion: {
                resultado: 'fallida',
                version: '1.1.0',
                motivo: 'hash_invalido',
                detalle: 'SHA distinto',
                primeraFallaAt: '2026-09-23T18:00:00Z',
                reportadaAt: '2026-09-23T18:05:00Z',
              },
            }),
          ]),
      },
      {
        [`PUT /sucursales/${SUCURSAL_A1.id}/actualizacion-automatica`]: (l) => {
          a1Encendida = (l.cuerpo as { activa: boolean }).activa;
          return json(200, { sucursalId: SUCURSAL_A1.id, actualizacionAutomatica: a1Encendida });
        },
      },
    );
    montar(`/admin?empresa=${A}&tab=actualizaciones`);

    const tijuana = await screen.findByRole('row', { name: 'Tijuana' });
    expect(tijuana).toHaveTextContent('Falló: el binario no coincide con el publicado (SHA-256)');
    const centro = screen.getByRole('row', { name: 'Centro' });
    await userEvent.click(
      within(centro).getByRole('switch', { name: 'Actualización automática de Centro' }),
    );

    await waitFor(() =>
      expect(api.contar('PUT', `/sucursales/${SUCURSAL_A1.id}/actualizacion-automatica`)).toBe(1),
    );
    const put = api.llamadas.find((l) => l.metodo === 'PUT')!;
    expect(put.cuerpo).toEqual({ activa: true });
    await waitFor(() =>
      expect(screen.getByRole('row', { name: 'Centro' })).toHaveTextContent(
        'Pendiente: la toma en su siguiente revisión',
      ),
    );
    expect(within(screen.getByRole('row', { name: 'Centro' })).getByRole('switch')).toBeChecked();
  });
});

describe('estadoActualizacion() (F2-143)', () => {
  const base = fila(SUCURSAL_A1, { actualizacionAutomatica: true, versionObjetivo: '1.1.0' });

  it.each<[string, Partial<EstadoAgenteSucursal>, string]>([
    ['sin bandera', { actualizacionAutomatica: false, versionObjetivo: null }, 'sin-bandera'],
    ['sin versión publicada', { versionObjetivo: null }, 'sin-version'],
    ['corre la objetivo (con +commit)', { versionAgente: '1.1.0+deadbee' }, 'al-dia'],
    ['todavía no la toma', {}, 'pendiente'],
    [
      'falló la objetivo',
      {
        actualizacion: {
          resultado: 'fallida',
          version: '1.1.0',
          motivo: 'arranque',
          detalle: null,
          primeraFallaAt: '2026-09-23T18:00:00Z',
          reportadaAt: '2026-09-23T18:00:00Z',
        },
      },
      'fallo',
    ],
    [
      'la falla era de OTRA versión',
      {
        actualizacion: {
          resultado: 'fallida',
          version: '1.0.5',
          motivo: 'arranque',
          detalle: null,
          primeraFallaAt: '2026-09-23T18:00:00Z',
          reportadaAt: '2026-09-23T18:00:00Z',
        },
      },
      'pendiente',
    ],
  ])('%s', (_caso, extra, esperado) => {
    expect(estadoActualizacion({ ...base, ...extra })).toBe(esperado);
  });
});

describe('la alerta actualizacion_fallida en el centro de alertas (F2-143)', () => {
  it('nombre, regla y descripción con el motivo en palabras (lectura defensiva)', () => {
    expect(NOMBRE_TIPO.actualizacion_fallida).toBe('Actualización del agente fallida');
    expect(textoRegla('actualizacion_fallida', 5)).toContain('más de 5 min fallando');
    const alerta = {
      id: 'x',
      sucursalId: SUCURSAL_A1.id,
      sucursal: 'Centro',
      tipo: 'actualizacion_fallida' as const,
      severidad: 'advertencia' as const,
      llave: '1.1.0',
      umbral: 1,
      detalle: { version: '1.1.0', motivo: 'hash_invalido', detalle: 'SHA distinto', minutos: 2 },
      abiertaAt: '2026-09-23T18:00:00Z',
      cerradaAt: null,
      motivoCierre: null,
    };
    expect(describirAlerta(alerta)).toBe(
      'Centro: el agente no se pudo actualizar a la versión 1.1.0: el binario no coincide con el publicado (SHA-256). Sigue corriendo su versión anterior.',
    );
    expect(describirAlerta({ ...alerta, detalle: { motivo: 'otro' } })).toBe(
      'Centro: el agente no se pudo actualizar a la versión 1.1.0: motivo sin dato. Sigue corriendo su versión anterior.',
    );
  });
});
