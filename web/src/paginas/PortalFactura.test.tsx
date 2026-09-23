import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  CatalogosSat,
  ConsultaCodigoPortal,
  FacturaPortal,
  PortalPublico,
} from '../api/tipos';
import { Proveedores, Rutas } from '../App';
import { terminarSesion } from '../auth/sesion';
import { crearQueryClient } from '../consultas/queryClient';
import { instalarApiFalsa, json, noAutorizado, type Manejador } from '../test/apiFalsa';

// F2-103 en el web, contra el router y la app reales: el portal PÚBLICO de autofactura
// `/f/:slug`. Sin sesión (el refresh da 401). Lo que se prueba: la marca de la sucursal, el
// código precargado con `?c=`, los estados que no se facturan (sin datos del ticket y sin
// prometer lo que no pasó), que con la emisión apagada NO se piden datos fiscales, y con ella
// encendida (lo que F2-104 devolverá) el flujo de tres pasos con errores campo por campo del
// cliente y del api, el 409, el 503 y la pantalla de éxito del contrato.
//
// OJO: la respuesta 201 de éxito es INVENTADA aquí (el contrato de `FacturaPortalDto`). En
// F2-103 ningún camino real del api la produce: la emisión es F2-104.

const SLUG = 'demo-centro';

function portal(p: Partial<PortalPublico> = {}): PortalPublico {
  return {
    slug: SLUG,
    sucursal: 'Sucursal Centro',
    color: '#0f766e',
    logoUrl: `/facturacion/portal/${SLUG}/logo`,
    emisionDisponible: true,
    ...p,
  };
}

const PENDIENTE: ConsultaCodigoPortal = {
  codigo: '7JQRECP3U',
  estado: 'pendiente',
  mensaje: 'El ticket se puede facturar.',
  ticket: {
    sucursal: 'Sucursal Centro',
    fecha: '2026-09-15T20:00:00.000Z',
    zonaHoraria: 'America/Mexico_City',
    total: '315.50',
    expiraAt: '2026-10-01T06:00:00.000Z',
    desglose: { subtotal: '271.98', impuestos: '43.52' },
  },
};

const CATALOGOS: CatalogosSat = {
  regimenesFiscales: [
    { clave: '601', descripcion: 'General de Ley Personas Morales', fisica: false, moral: true },
    { clave: '612', descripcion: 'Actividades Empresariales', fisica: true, moral: false },
  ],
  usosCfdi: [
    {
      clave: 'G03',
      descripcion: 'Gastos en general',
      fisica: true,
      moral: true,
      regimenes: ['601', '612'],
    },
    {
      clave: 'D01',
      descripcion: 'Honorarios médicos',
      fisica: true,
      moral: false,
      regimenes: ['612'],
    },
  ],
};

const FACTURA: FacturaPortal = {
  uuid: '5FB2822E-396D-4725-8521-CDC4BDD20CCF',
  serieFolio: 'A-1024',
  total: '315.50',
  email: 'facturas@ejemplo.test',
  descargas: { xml: null, pdf: null },
};

function api(extra: Record<string, Manejador> = {}, p: Partial<PortalPublico> = {}) {
  return instalarApiFalsa({
    'POST /auth/refresh': () => noAutorizado(),
    [`GET /facturacion/portal/${SLUG}`]: () => json(200, portal(p)),
    'GET /facturacion/catalogos-sat': () => json(200, CATALOGOS),
    [`GET /facturacion/portal/${SLUG}/codigo/7JQRECP3U`]: () => json(200, PENDIENTE),
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

async function llenarDatos(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('RFC'), 'eku9003173c9');
  await user.type(screen.getByLabelText('Nombre o razón social'), 'ESCUELA KEMPER URGATE');
  await user.selectOptions(screen.getByLabelText('Régimen fiscal'), '601');
  await user.type(screen.getByLabelText('Código postal de tu domicilio fiscal'), '42501');
  await user.selectOptions(screen.getByLabelText('Uso de la factura'), 'G03');
  await user.type(screen.getByLabelText('Correo electrónico'), 'facturas@ejemplo.test');
}

describe('Portal de autofactura (público)', () => {
  it('abre SIN sesión con la marca de la sucursal, y con ?c= consulta el código solo', async () => {
    const falsa = api();
    montar(`/f/${SLUG}?c=7jqrecp3u`);
    const cabecera = await screen.findByRole('banner');
    expect(cabecera).toHaveTextContent('Sucursal Centro');
    expect(cabecera).toHaveStyle({ backgroundColor: '#0f766e' });
    expect(within(cabecera).getByRole('img', { name: 'Logo de Sucursal Centro' })).toHaveAttribute(
      'src',
      `/api/facturacion/portal/${SLUG}/logo`,
    );
    const consumo = await screen.findByRole('group', { name: 'Tu consumo' });
    expect(consumo).toHaveTextContent('Subtotal$271.98');
    expect(consumo).toHaveTextContent('Impuestos$43.52');
    expect(consumo).toHaveTextContent('Total$315.50');
    expect(consumo).toHaveTextContent('15 de septiembre de 2026');
    expect(consumo).toHaveTextContent('Puedes facturarlo hasta el 30 de septiembre de 2026.');
    expect(screen.getByLabelText('Código de facturación')).toHaveValue('7jqrecp3u');
    // Una sola consulta, ya normalizada, y ninguna con Authorization.
    expect(falsa.contar('GET', `/facturacion/portal/${SLUG}/codigo/7JQRECP3U`)).toBe(1);
    expect(falsa.llamadas.every((l) => l.autorizacion === null)).toBe(true);
    expect(screen.queryByRole('button', { name: /Entrar|Iniciar sesión/ })).toBeNull();
    expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute(
      'content',
      'no-referrer',
    );
  });

  it('sin logo: iniciales; sin desglose que cuadre: sólo el total', async () => {
    api(
      {
        [`GET /facturacion/portal/${SLUG}/codigo/7JQRECP3U`]: () =>
          json(200, { ...PENDIENTE, ticket: { ...PENDIENTE.ticket!, desglose: null } }),
      },
      { logoUrl: null },
    );
    montar(`/f/${SLUG}?c=7JQRECP3U`);
    const cabecera = await screen.findByRole('banner');
    expect(within(cabecera).queryByRole('img')).toBeNull();
    expect(cabecera).toHaveTextContent('C');
    const consumo = await screen.findByRole('group', { name: 'Tu consumo' });
    expect(consumo).not.toHaveTextContent('Subtotal');
    expect(consumo).toHaveTextContent('Total$315.50');
  });

  it('un enlace que no existe lo dice, sin reintentos', async () => {
    const falsa = api({
      [`GET /facturacion/portal/no-existe`]: () =>
        json(404, { statusCode: 404, message: 'Portal de facturación no encontrado.' }),
    });
    montar('/f/no-existe');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Este enlace de facturación no existe o ya no está activo',
    );
    expect(falsa.contar('GET', '/facturacion/portal/no-existe')).toBe(1);
  });

  it('código mal escrito: se dice en el campo sin ir al api; uno que no existe: 404 claro', async () => {
    const user = userEvent.setup();
    const falsa = api({
      [`GET /facturacion/portal/${SLUG}/codigo/ZZZZZZZZZ`]: () =>
        json(404, { statusCode: 404, message: 'Código de facturación no encontrado.' }),
    });
    montar(`/f/${SLUG}`);
    const campo = await screen.findByLabelText('Código de facturación');
    await user.type(campo, '7JQRECP3O');
    await user.click(screen.getByRole('button', { name: 'Buscar mi ticket' }));
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(campo).toHaveAccessibleDescription(/9 caracteres/);
    expect(falsa.llamadas.some((l) => l.ruta.includes('/codigo/'))).toBe(false);

    await user.clear(campo);
    await user.type(campo, 'zzzz zzzzz');
    await user.click(screen.getByRole('button', { name: 'Buscar mi ticket' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No encontramos ese código en este restaurante',
    );
  });

  it.each([
    ['facturado', 'Este ticket ya fue facturado.', 'pídela en el restaurante'],
    ['expirado', 'El plazo para facturar este ticket ya venció.', 'ya no puede emitir'],
    ['en_global', 'Este ticket ya se incluyó en la factura global', 'factura global'],
    ['cancelado', 'La cuenta de este ticket fue cancelada', 'revisen tu ticket'],
  ] as const)(
    '%s: dice el estado y qué hacer, sin datos del ticket',
    async (estado, mensaje, pista) => {
      api({
        [`GET /facturacion/portal/${SLUG}/codigo/7JQRECP3U`]: () =>
          json(200, { codigo: '7JQRECP3U', estado, mensaje, ticket: null }),
      });
      montar(`/f/${SLUG}?c=7JQRECP3U`);
      const aviso = await screen.findByText(mensaje, { exact: false });
      const caja = aviso.closest('[role="status"]')!;
      expect(caja).toHaveTextContent(pista);
      // Ni total, ni fecha, ni botón para seguir; y un facturado NO afirma que se envió un correo.
      expect(screen.queryByRole('group', { name: 'Tu consumo' })).toBeNull();
      expect(screen.queryByText(/\$/)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Continuar con mis datos' })).toBeNull();
      expect(caja).not.toHaveTextContent(/te (la )?enviamos|se envió/i);
    },
  );

  it('con la emisión APAGADA (hoy): deja ver el ticket pero NO pide datos fiscales', async () => {
    const falsa = api({}, { emisionDisponible: false });
    montar(`/f/${SLUG}?c=7JQRECP3U`);
    expect(await screen.findByRole('group', { name: 'Tu consumo' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Este restaurante todavía no emite facturas en línea',
    );
    expect(screen.queryByRole('button', { name: 'Continuar con mis datos' })).toBeNull();
    // Ni siquiera se piden los catálogos.
    expect(falsa.contar('GET', '/facturacion/catalogos-sat')).toBe(0);
  });

  it('flujo completo (emisión encendida): código → datos → confirmar → éxito del contrato', async () => {
    const user = userEvent.setup();
    const falsa = api({
      [`POST /facturacion/portal/${SLUG}/facturas`]: () => json(201, FACTURA),
    });
    montar(`/f/${SLUG}?c=7JQRECP3U`);
    await user.click(await screen.findByRole('button', { name: 'Continuar con mis datos' }));
    expect(screen.getByRole('heading', { name: 'Tus datos fiscales' })).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText('Régimen fiscal')).toBeEnabled());
    // Con un RFC de empresa sólo se ofrecen regímenes de persona moral.
    await user.type(screen.getByLabelText('RFC'), 'EKU9003173C9');
    expect(
      within(screen.getByLabelText('Régimen fiscal'))
        .getAllByRole('option')
        .map((o) => o.getAttribute('value')),
    ).toEqual(['', '601']);
    await user.clear(screen.getByLabelText('RFC'));
    await llenarDatos(user);
    await user.click(screen.getByRole('button', { name: 'Revisar mis datos' }));

    expect(screen.getByRole('heading', { name: 'Confirma tu factura' })).toBeVisible();
    expect(screen.getByLabelText('Tus datos')).toHaveTextContent('RFCEKU9003173C9');
    expect(screen.getByLabelText('Tus datos')).toHaveTextContent(
      '601 · General de Ley Personas Morales',
    );
    await user.click(screen.getByRole('button', { name: 'Emitir mi factura' }));

    expect(
      await screen.findByRole('heading', { name: '¡Listo! Tu factura se emitió' }),
    ).toBeVisible();
    expect(screen.getByText(FACTURA.uuid)).toBeVisible();
    expect(screen.getByText('A-1024')).toBeVisible();
    expect(screen.getByText(/Te enviaremos el PDF y el XML a facturas@ejemplo.test/)).toBeVisible();
    const post = falsa.llamadas.find((l) => l.metodo === 'POST' && l.ruta.endsWith('/facturas'));
    expect(post?.cuerpo).toEqual({
      codigo: '7JQRECP3U',
      receptor: {
        rfc: 'EKU9003173C9',
        razonSocial: 'ESCUELA KEMPER URGATE',
        regimenFiscal: '601',
        cp: '42501',
        usoCfdi: 'G03',
        email: 'facturas@ejemplo.test',
      },
    });
    expect(post?.autorizacion).toBeNull();
  });

  it('errores de captura: todos a la vez, en español, campo por campo, sin ir al api', async () => {
    const user = userEvent.setup();
    const falsa = api();
    montar(`/f/${SLUG}?c=7JQRECP3U`);
    await user.click(await screen.findByRole('button', { name: 'Continuar con mis datos' }));
    await waitFor(() => expect(screen.getByLabelText('Régimen fiscal')).toBeEnabled());
    await user.type(screen.getByLabelText('RFC'), 'XAXX010101000');
    await user.type(screen.getByLabelText('Código postal de tu domicilio fiscal'), '123');
    await user.type(screen.getByLabelText('Correo electrónico'), 'no-es-correo');
    await user.click(screen.getByRole('button', { name: 'Revisar mis datos' }));

    const rfc = screen.getByLabelText('RFC');
    expect(rfc).toHaveAttribute('aria-invalid', 'true');
    expect(rfc).toHaveAccessibleDescription(/público en general/);
    expect(rfc).toHaveFocus();
    expect(screen.getByLabelText('Nombre o razón social')).toHaveAccessibleDescription(
      /Escribe tu nombre o razón social/,
    );
    expect(screen.getByLabelText('Régimen fiscal')).toHaveAccessibleDescription(
      /Elige tu régimen fiscal/,
    );
    expect(
      screen.getByLabelText('Código postal de tu domicilio fiscal'),
    ).toHaveAccessibleDescription(/5 dígitos/);
    expect(screen.getByLabelText('Uso de la factura')).toHaveAccessibleDescription(/Elige el uso/);
    expect(screen.getByLabelText('Correo electrónico')).toHaveAccessibleDescription(
      /forma correcta/,
    );
    expect(screen.getByRole('heading', { name: 'Tus datos fiscales' })).toBeVisible();
    expect(falsa.contar('POST', `/facturacion/portal/${SLUG}/facturas`)).toBe(0);
  });

  it('un 400 del api con `campos` regresa al paso 2 con el error en su campo', async () => {
    const user = userEvent.setup();
    api({
      [`POST /facturacion/portal/${SLUG}/facturas`]: () =>
        json(400, {
          statusCode: 400,
          error: 'Bad Request',
          message: ['El CP no coincide con el del SAT.'],
          campos: { cp: 'El CP no coincide con el del SAT.' },
        }),
    });
    montar(`/f/${SLUG}?c=7JQRECP3U`);
    await user.click(await screen.findByRole('button', { name: 'Continuar con mis datos' }));
    await waitFor(() => expect(screen.getByLabelText('Régimen fiscal')).toBeEnabled());
    await llenarDatos(user);
    await user.click(screen.getByRole('button', { name: 'Revisar mis datos' }));
    await user.click(screen.getByRole('button', { name: 'Emitir mi factura' }));

    const cp = await screen.findByLabelText('Código postal de tu domicilio fiscal');
    expect(cp).toHaveAttribute('aria-invalid', 'true');
    expect(cp).toHaveAccessibleDescription(/El CP no coincide con el del SAT/);
    // Lo capturado se conserva.
    expect(screen.getByLabelText('RFC')).toHaveValue('eku9003173c9'.toUpperCase());
  });

  it('un 409 (se facturó mientras tanto) vuelve al paso 1 con el estado', async () => {
    const user = userEvent.setup();
    api({
      [`POST /facturacion/portal/${SLUG}/facturas`]: () =>
        json(409, {
          statusCode: 409,
          error: 'Conflict',
          message: 'Este ticket ya fue facturado.',
          estado: 'facturado',
        }),
    });
    montar(`/f/${SLUG}?c=7JQRECP3U`);
    await user.click(await screen.findByRole('button', { name: 'Continuar con mis datos' }));
    await waitFor(() => expect(screen.getByLabelText('Régimen fiscal')).toBeEnabled());
    await llenarDatos(user);
    await user.click(screen.getByRole('button', { name: 'Revisar mis datos' }));
    await user.click(screen.getByRole('button', { name: 'Emitir mi factura' }));
    expect(await screen.findByText('Este ticket ya fue facturado.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Factura tu consumo' })).toBeVisible();
  });

  it('un 503 (emisión no disponible) muestra el mensaje del api y deja reintentar', async () => {
    const user = userEvent.setup();
    const mensaje =
      'Este restaurante todavía no emite facturas en línea. Tus datos no se guardaron: intenta más tarde o pide tu factura en el restaurante.';
    api({
      [`POST /facturacion/portal/${SLUG}/facturas`]: () =>
        json(503, { statusCode: 503, message: mensaje }),
    });
    montar(`/f/${SLUG}?c=7JQRECP3U`);
    await user.click(await screen.findByRole('button', { name: 'Continuar con mis datos' }));
    await waitFor(() => expect(screen.getByLabelText('Régimen fiscal')).toBeEnabled());
    await llenarDatos(user);
    await user.click(screen.getByRole('button', { name: 'Revisar mis datos' }));
    await user.click(screen.getByRole('button', { name: 'Emitir mi factura' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(mensaje);
    expect(screen.getByRole('button', { name: 'Emitir mi factura' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: /Listo/ })).toBeNull();
  });
});
