import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PerfilFiscal,
  RegimenFiscal,
  RespuestaPerfilFiscal,
  SucursalPortal,
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
  usuario,
  type Manejador,
} from '../test/apiFalsa';

// F2-100 en el web, contra el router y la app reales: Facturación → Datos fiscales
// (`/facturacion`). Lo que se prueba: los estados vacíos dicen por qué; la vigencia del CSD y la
// alerta de < 30 días salen de la metadata; el formulario valida antes de mandar; el CSD se manda
// en base64 y la contraseña se BORRA del formulario al terminar, salga bien o mal.

const A = EMPRESA_A.id;
// 22-sep-2026, 12:00 en CDMX.
const AHORA = new Date('2026-09-22T18:00:00Z');
const RUTA = `/facturacion?empresa=${A}`;
const DIA = 24 * 60 * 60 * 1000;

const REGIMENES: RegimenFiscal[] = [
  { clave: '601', descripcion: 'General de Ley Personas Morales', fisica: false, moral: true },
  { clave: '612', descripcion: 'Actividades Empresariales', fisica: true, moral: false },
];

function perfil(p: Partial<PerfilFiscal> = {}): PerfilFiscal {
  return {
    rfc: 'EKU9003173C9',
    razonSocial: 'ESCUELA KEMPER URGATE',
    regimenFiscal: '601',
    cp: '06700',
    serie: 'A',
    folioActual: 12,
    activo: true,
    emisorRegistrado: true,
    csd: {
      noCertificado: '30001000000500003416',
      rfc: 'EKU9003173C9',
      vigenteDesde: '2022-10-12T06:00:00.000Z',
      // 20 días y 12 horas después de AHORA: alerta.
      vigenteHasta: new Date(AHORA.getTime() + 20 * DIA + 12 * 3600 * 1000).toISOString(),
      cargadoAt: '2026-09-01T18:00:00.000Z',
    },
    actualizadoAt: '2026-09-01T18:00:00.000Z',
    ...p,
  };
}

function api(
  u: UsuarioActual = usuario('admin_empresa'),
  respuesta: RespuestaPerfilFiscal = { perfil: perfil(), pacSimulado: true },
  extra: Record<string, Manejador> = {},
) {
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1]),
    'GET /alertas/abiertas': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /facturacion/perfil-fiscal': () => json(200, respuesta),
    'GET /facturacion/regimenes-fiscales': () => json(200, REGIMENES),
    'GET /facturacion/portales': () => json(200, []),
    ...extra,
  });
}

function montar(ruta = RUTA) {
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

const region = (nombre: string) => screen.findByRole('region', { name: nombre });
/** La tarjeta de datos YA cargada (mientras carga hay otra con el mismo título y un esqueleto). */
async function tarjetaDatos() {
  await screen.findByLabelText('RFC');
  return screen.getByRole('region', { name: 'Datos fiscales' });
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

describe('estados vacíos', () => {
  it('sin datos fiscales: dice por qué y qué hace falta; el CSD espera a los datos', async () => {
    const falsa = api(usuario('admin_empresa'), { perfil: null, pacSimulado: true });
    montar();
    expect(await screen.findByTestId('sin-perfil')).toHaveTextContent(
      'Esta empresa todavía no tiene datos fiscales: sin ellos no se puede facturar.',
    );
    expect(await region('Certificado de sello digital (CSD)')).toHaveTextContent(
      'Guarda primero los datos fiscales: el CSD se valida contra su RFC.',
    );
    expect(screen.getByTestId('pac-simulado')).toHaveTextContent('PAC simulado');
    expect(screen.queryByLabelText('Contraseña de la llave')).toBeNull();
    expect(
      falsa.llamadas.find((l) => l.ruta === '/facturacion/perfil-fiscal')?.query.get('empresaId'),
    ).toBe(A);
  });

  it('con datos y sin CSD: lo dice, y ofrece subirlo', async () => {
    api(usuario('admin_empresa'), {
      perfil: perfil({ csd: null, emisorRegistrado: false }),
      pacSimulado: false,
    });
    montar();
    expect(await screen.findByTestId('sin-csd')).toHaveTextContent(
      'Sin CSD cargado: sin él no se puede facturar.',
    );
    expect(screen.getByRole('button', { name: 'Subir CSD' })).toBeInTheDocument();
    expect(screen.queryByTestId('pac-simulado')).toBeNull();
    expect(screen.queryByTestId('alerta-csd')).toBeNull();
  });
});

describe('vigencia del CSD (calculada en la vista)', () => {
  it('vence en 20 días: alerta con los días y la fecha local', async () => {
    api();
    montar();
    const alerta = await screen.findByTestId('alerta-csd');
    expect(alerta).toHaveTextContent('El CSD vence en 20 días (13 de octubre de 2026)');
    const csd = screen.getByTestId('csd');
    expect(csd).toHaveTextContent('30001000000500003416');
    expect(csd).toHaveTextContent('Vigente desde12 de octubre de 2022');
    expect(screen.getByRole('button', { name: 'Reemplazar CSD' })).toBeInTheDocument();
  });

  it('faltan 30 días o más: sin alerta, con los días al lado de la fecha', async () => {
    const hasta = new Date(AHORA.getTime() + 30 * DIA).toISOString();
    api(usuario('admin_empresa'), {
      perfil: perfil({ csd: { ...perfil().csd!, vigenteHasta: hasta } }),
      pacSimulado: true,
    });
    montar();
    expect(await screen.findByTestId('csd-hasta')).toHaveTextContent('vence en 30 días');
    expect(screen.queryByTestId('alerta-csd')).toBeNull();
  });

  it('vencido: alerta de que no se puede facturar', async () => {
    api(usuario('admin_empresa'), {
      perfil: perfil({ csd: { ...perfil().csd!, vigenteHasta: '2026-09-01T06:00:00.000Z' } }),
      pacSimulado: true,
    });
    montar();
    expect(await screen.findByTestId('alerta-csd')).toHaveTextContent(
      'El CSD venció el 1 de septiembre de 2026: no se puede facturar hasta subir uno vigente.',
    );
  });
});

describe('datos fiscales', () => {
  it('valida antes de mandar; luego manda normalizado', async () => {
    const falsa = api(
      usuario('admin_empresa'),
      { perfil: null, pacSimulado: true },
      {
        'PUT /facturacion/perfil-fiscal': (l) =>
          json(200, {
            perfil: perfil({ ...(l.cuerpo as object), csd: null }),
            pacSimulado: true,
            csdQuitado: false,
          }),
      },
    );
    montar();
    const datos = await tarjetaDatos();
    await userEvent.click(within(datos).getByRole('button', { name: 'Guardar datos fiscales' }));
    expect(datos).toHaveTextContent('El RFC debe tener 12 caracteres');
    expect(datos).toHaveTextContent('El código postal lleva 5 dígitos.');
    expect(falsa.contar('PUT', '/facturacion/perfil-fiscal')).toBe(0);

    await userEvent.type(within(datos).getByLabelText('RFC'), ' eku9003173c9');
    await userEvent.type(within(datos).getByLabelText('Razón social'), 'ESCUELA KEMPER URGATE');
    // Moral: el régimen de física no está entre las opciones.
    const regimen = within(datos).getByLabelText('Régimen fiscal');
    expect(within(regimen).queryByRole('option', { name: /612/ })).toBeNull();
    await userEvent.selectOptions(regimen, '601');
    await userEvent.type(within(datos).getByLabelText('Código postal fiscal'), '06700');
    await userEvent.type(within(datos).getByLabelText('Serie de las facturas'), 'b');
    await userEvent.click(within(datos).getByRole('button', { name: 'Guardar datos fiscales' }));

    await waitFor(() => expect(falsa.contar('PUT', '/facturacion/perfil-fiscal')).toBe(1));
    expect(falsa.llamadas.find((l) => l.metodo === 'PUT')?.cuerpo).toEqual({
      empresaId: A,
      rfc: 'EKU9003173C9',
      razonSocial: 'ESCUELA KEMPER URGATE',
      regimenFiscal: '601',
      cp: '06700',
      serie: 'B',
    });
    expect(await screen.findByTestId('sin-csd')).toBeInTheDocument();
  });

  it('cambiar el RFC con CSD cargado avisa que se quita el CSD', async () => {
    api();
    montar();
    const datos = await tarjetaDatos();
    expect(screen.queryByTestId('aviso-cambio-rfc')).toBeNull();
    const rfc = within(datos).getByLabelText('RFC');
    await userEvent.clear(rfc);
    await userEvent.type(rfc, 'XIA190128J61');
    expect(screen.getByTestId('aviso-cambio-rfc')).toHaveTextContent(
      'al guardar se quita el CSD cargado, porque es de EKU9003173C9',
    );
    expect(
      within(datos).getByRole('button', { name: 'Guardar y quitar el CSD' }),
    ).toBeInTheDocument();
  });
});

describe('carga del CSD', () => {
  const cer = () => new File([new Uint8Array([48, 130, 1, 2])], 'csd.cer');
  const key = () => new File([new Uint8Array([48, 130, 5, 6, 255])], 'csd.key');

  async function llenar(contrasena: string) {
    const tarjeta = await region('Certificado de sello digital (CSD)');
    await userEvent.upload(within(tarjeta).getByLabelText('Certificado (.cer)'), cer());
    await userEvent.upload(within(tarjeta).getByLabelText('Llave privada (.key)'), key());
    await userEvent.type(within(tarjeta).getByLabelText('Contraseña de la llave'), contrasena);
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Reemplazar CSD' }));
    return tarjeta;
  }

  it('manda los archivos en base64 y la contraseña; al terminar la borra', async () => {
    const nuevo = perfil({
      csd: {
        ...perfil().csd!,
        vigenteHasta: '2030-01-01T06:00:00.000Z',
        noCertificado: '30001000000500009999',
      },
    });
    const falsa = api(usuario('admin_empresa'), undefined, {
      'POST /facturacion/perfil-fiscal/csd': () => json(200, { perfil: nuevo, pacSimulado: true }),
    });
    montar();
    await llenar('mi-contrasena-secreta');
    await waitFor(() => expect(falsa.contar('POST', '/facturacion/perfil-fiscal/csd')).toBe(1));
    expect(falsa.llamadas.find((l) => l.ruta === '/facturacion/perfil-fiscal/csd')?.cuerpo).toEqual(
      {
        empresaId: A,
        certificado: 'MIIBAg==',
        llavePrivada: 'MIIFBv8=',
        contrasena: 'mi-contrasena-secreta',
      },
    );
    expect(await screen.findByText('30001000000500009999')).toBeInTheDocument();
    expect(screen.queryByTestId('alerta-csd')).toBeNull();
    expect(screen.getByLabelText('Contraseña de la llave')).toHaveValue('');
    expect(document.body.innerHTML).not.toContain('mi-contrasena-secreta');
  });

  it('un rechazo muestra el mensaje del servidor y TAMBIÉN borra la contraseña', async () => {
    api(usuario('admin_empresa'), undefined, {
      'POST /facturacion/perfil-fiscal/csd': () =>
        json(400, {
          statusCode: 400,
          message: ['La contraseña de la llave privada no es correcta.'],
          error: 'Bad Request',
        }),
    });
    montar();
    const tarjeta = await llenar('otra-contrasena');
    expect(await within(tarjeta).findByTestId('error-csd')).toHaveTextContent(
      'La contraseña de la llave privada no es correcta.',
    );
    expect(within(tarjeta).getByLabelText('Contraseña de la llave')).toHaveValue('');
    // El CSD que ya estaba sigue igual.
    expect(screen.getByTestId('alerta-csd')).toHaveTextContent('vence en 20 días');
  });

  it('sin archivos o sin contraseña no manda nada', async () => {
    const falsa = api();
    montar();
    const tarjeta = await region('Certificado de sello digital (CSD)');
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Reemplazar CSD' }));
    expect(within(tarjeta).getByTestId('error-csd')).toHaveTextContent(
      'Elige el .cer y el .key, y escribe la contraseña de la llave.',
    );
    expect(falsa.contar('POST', '/facturacion/perfil-fiscal/csd')).toBe(0);
  });
});

describe('roles', () => {
  it('el visor ve "No encontrada" y no se pide nada fiscal', async () => {
    const falsa = api(usuario('visor'));
    montar();
    expect(await screen.findByRole('heading', { name: 'No encontrada' })).toBeInTheDocument();
    expect(falsa.contar('GET', '/facturacion/perfil-fiscal')).toBe(0);
  });

  it('el administrador llega desde el menú (Administración → Facturación)', async () => {
    api();
    montar(`/?empresa=${A}`);
    const nav = await screen.findByRole('navigation', { name: 'Principal' });
    const enlace = await within(nav).findByRole('link', { name: 'Facturación' });
    expect(new URL(enlace.getAttribute('href')!, 'http://x').pathname).toBe('/facturacion');
  });
});

describe('portal de autofactura (F2-103)', () => {
  const SIN_PORTAL: SucursalPortal = {
    sucursalId: SUCURSAL_A1.id,
    sucursal: 'Sucursal Centro',
    sucursalActiva: true,
    portal: null,
  };
  const CON_PORTAL: SucursalPortal = {
    ...SIN_PORTAL,
    portal: {
      slug: 'demo-centro',
      color: '#0f766e',
      activo: true,
      tieneLogo: false,
      actualizadoAt: '2026-09-22T18:00:00.000Z',
    },
  };

  it('sin portal: sugiere el enlace por el nombre y lo crea con PUT', async () => {
    const user = userEvent.setup();
    const falsa = api(usuario('admin_empresa'), undefined, {
      'GET /facturacion/portales': () => json(200, [SIN_PORTAL]),
      [`PUT /facturacion/portales/${SUCURSAL_A1.id}`]: () => json(200, CON_PORTAL),
    });
    montar();
    const form = await screen.findByRole('form', { name: 'Portal de Sucursal Centro' });
    expect(form).toHaveTextContent('Sin portal todavía');
    expect(within(form).getByLabelText('Enlace')).toHaveValue('centro');
    await user.clear(within(form).getByLabelText('Enlace'));
    await user.type(within(form).getByLabelText('Enlace'), 'demo-centro');
    await user.click(within(form).getByRole('button', { name: 'Crear portal' }));
    const nuevo = await screen.findByRole('form', { name: 'Portal de Sucursal Centro' });
    await waitFor(() =>
      expect(within(nuevo).getByRole('link', { name: 'Abrir /f/demo-centro' })).toHaveAttribute(
        'href',
        '/f/demo-centro',
      ),
    );
    const put = falsa.llamadas.find((l) => l.metodo === 'PUT');
    expect(put?.cuerpo).toEqual({ slug: 'demo-centro', color: '#0f766e', activo: true });
    expect(
      falsa.llamadas.find((l) => l.ruta === '/facturacion/portales')?.query.get('empresaId'),
    ).toBe(A);
  });

  it('un enlace inválido se marca sin ir al api; el 409 del api se muestra tal cual', async () => {
    const user = userEvent.setup();
    const falsa = api(usuario('admin_empresa'), undefined, {
      'GET /facturacion/portales': () => json(200, [CON_PORTAL]),
      [`PUT /facturacion/portales/${SUCURSAL_A1.id}`]: () =>
        json(409, { statusCode: 409, message: 'Ese enlace ya lo usa otro portal.' }),
    });
    montar();
    const form = await screen.findByRole('form', { name: 'Portal de Sucursal Centro' });
    const enlace = within(form).getByLabelText('Enlace');
    await user.clear(enlace);
    await user.type(enlace, 'ab');
    await user.click(within(form).getByRole('button', { name: 'Guardar' }));
    expect(enlace).toHaveAttribute('aria-invalid', 'true');
    expect(enlace).toHaveAccessibleDescription(/De 3 a 40 caracteres/);
    expect(falsa.contar('PUT', `/facturacion/portales/${SUCURSAL_A1.id}`)).toBe(0);

    await user.type(enlace, 'c-ocupado');
    await user.click(within(form).getByRole('button', { name: 'Guardar' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'Ese enlace ya lo usa otro portal.',
    );
  });

  it('el logo: un archivo de más de 200 KB se rechaza sin subirlo', async () => {
    const user = userEvent.setup();
    const falsa = api(usuario('admin_empresa'), undefined, {
      'GET /facturacion/portales': () => json(200, [CON_PORTAL]),
    });
    montar();
    const form = await screen.findByRole('form', { name: 'Portal de Sucursal Centro' });
    expect(form).toHaveTextContent('Sin logo: el portal muestra las iniciales.');
    const grande = new File([new Uint8Array(200 * 1024 + 1)], 'logo.png', { type: 'image/png' });
    await user.upload(within(form).getByLabelText('Subir logo'), grande);
    expect(await within(form).findByRole('alert')).toHaveTextContent('El logo pesa más de 200 KB.');
    expect(falsa.contar('PUT', `/facturacion/portales/${SUCURSAL_A1.id}/logo`)).toBe(0);
  });
});
