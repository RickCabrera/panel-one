import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QueryClient } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AltaGuiada, AltaGuiadaHecha, Arranque, Rol } from '../api/tipos';
import { Proveedores, Rutas } from '../App';
import { terminarSesion } from '../auth/sesion';
import { crearQueryClient } from '../consultas/queryClient';
import { EMPRESA_A, EMPRESA_B, instalarApiFalsa, json, sesion, usuario } from '../test/apiFalsa';

// Asistente de alta guiada (F2-147) contra una API falsa. Las reglas (transacción, 409, roles,
// scope) las prueba el e2e del api; aquí: el flujo completo, que la UI manda lo que dice el
// contrato, que las keys no se quedan en ninguna caché, y el CRONÓMETRO del AC.

const NUEVA = 'eeeeeeee-0000-4000-8000-00000000000e';
const PASSWORD_ADMIN = 'contrasena-sintetica-F2-147';

/**
 * El cronómetro del AC ("el asistente deja una empresa nueva lista para instalar agente en
 * < 10 min de captura"). NO es una medición con una persona (ésa es F1-091): es un modelo de
 * captura humana CONSERVADOR aplicado a las interacciones que el test HIZO DE VERDAD. Cada
 * tecleo, clic y selección pasa por estos envoltorios de `userEvent`; ninguno se cuenta a mano.
 */
const SEG_POR_CAMPO = 5; // ubicar el campo y pensar qué va
const SEG_POR_CARACTER = 0.4; // ~30 palabras por minuto, lento a propósito
const SEG_POR_CLIC = 2;
const SEG_POR_SELECCION = 6; // abrir un desplegable y buscar la opción
const SEG_LECTURA_POR_PANTALLA = 30; // leer cada paso del asistente antes de actuar
const TOPE_SEGUNDOS = 10 * 60;

function crearCronometro() {
  const user = userEvent.setup();
  const campos = new Set<Element>();
  const cuenta = { caracteres: 0, clics: 0, selecciones: 0, pantallas: 1 };
  return {
    user,
    cuenta,
    campos,
    async teclear(el: HTMLElement, texto: string) {
      campos.add(el);
      cuenta.caracteres += texto.length;
      await user.clear(el);
      await user.type(el, texto);
    },
    async clic(el: HTMLElement, { cambiaPantalla = false } = {}) {
      cuenta.clics += 1;
      if (cambiaPantalla) cuenta.pantallas += 1;
      await user.click(el);
    },
    async elegir(el: HTMLElement, valor: string) {
      cuenta.selecciones += 1;
      await user.selectOptions(el, valor);
    },
    segundos() {
      return (
        campos.size * SEG_POR_CAMPO +
        cuenta.caracteres * SEG_POR_CARACTER +
        cuenta.clics * SEG_POR_CLIC +
        cuenta.selecciones * SEG_POR_SELECCION +
        cuenta.pantallas * SEG_LECTURA_POR_PANTALLA
      );
    },
  };
}

function arranqueNueva(completo = false): Arranque {
  return {
    empresaId: NUEVA,
    completo,
    descargaAgente: 'https://descargas.monitor.test/agente.zip',
    pasos: [
      {
        clave: 'sucursales',
        titulo: 'Dar de alta las sucursales',
        hecho: true,
        detalle: '3 sucursales activas.',
        pendientes: [],
      },
      {
        clave: 'llaves',
        titulo: 'Generar la API key de cada sucursal',
        hecho: true,
        detalle: 'Todas las sucursales tienen su key.',
        pendientes: [],
      },
      {
        clave: 'agente',
        titulo: 'Instalar el agente en cada sucursal',
        hecho: false,
        detalle: 'El agente todavía no se reporta en 3 de 3 sucursales.',
        pendientes: [
          { sucursalId: 's1', nombre: 'Centro' },
          { sucursalId: 's2', nombre: 'Norte' },
          { sucursalId: 's3', nombre: 'Playa' },
        ],
      },
      {
        clave: 'ventas',
        titulo: 'Recibir la primera venta',
        hecho: false,
        detalle: 'Todavía no llega ninguna cuenta en 3 de 3 sucursales.',
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

function respuestaAlta(cuerpo: AltaGuiada): AltaGuiadaHecha {
  return {
    empresa: { id: NUEVA, nombre: cuerpo.nombre, activo: true },
    sucursales: cuerpo.sucursales.map((s, i) => ({
      id: `s${i + 1}`,
      empresaId: NUEVA,
      nombre: s.nombre,
      zonaHoraria: s.zonaHoraria,
      activo: true,
      apiKey: `msr_key-sintetica-${i + 1}-F2-147`,
    })),
    administrador: cuerpo.administrador
      ? {
          id: 'u-nuevo',
          email: cuerpo.administrador.email.toLowerCase(),
          nombre: cuerpo.administrador.nombre,
          rol: 'admin_empresa',
          empresaId: NUEVA,
          activo: true,
        }
      : null,
  };
}

function instalar(rol: Rol = 'admin_global', alta?: (c: AltaGuiada) => Response) {
  const yo = usuario(rol);
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(yo)),
    'GET /empresas': () => json(200, rol === 'admin_global' ? [EMPRESA_A, EMPRESA_B] : [EMPRESA_A]),
    'GET /sucursales': () => json(200, []),
    'POST /empresas/alta-guiada': (l) =>
      alta ? alta(l.cuerpo as AltaGuiada) : json(201, respuestaAlta(l.cuerpo as AltaGuiada)),
    [`GET /empresas/${NUEVA}/arranque`]: () => json(200, arranqueNueva()),
  });
}

function montar(ruta: string): QueryClient {
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
  return queryClient;
}

afterEach(() => {
  cleanup();
  terminarSesion('cerrada');
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('Alta guiada de empresa (F2-147)', () => {
  it('flujo completo: empresa + 3 sucursales + admin → keys, guía y lista de arranque, en < 10 min de captura', async () => {
    const api = instalar();
    const queryClient = montar('/admin/alta');
    const c = crearCronometro();
    const inicio = performance.now();

    // 1. Empresa
    await c.teclear(await screen.findByLabelText(/Nombre de la empresa/), 'Grupo Tacos del Norte');
    await c.clic(screen.getByRole('button', { name: 'Siguiente' }), { cambiaPantalla: true });

    // 2. Sucursales: tres, una en otra zona.
    await c.teclear(screen.getByLabelText('Sucursal 1'), 'Centro');
    await c.clic(screen.getByRole('button', { name: 'Agregar otra sucursal' }));
    await c.teclear(screen.getByLabelText('Sucursal 2'), 'Norte');
    await c.elegir(screen.getByLabelText('Zona horaria de la sucursal 2'), 'America/Monterrey');
    await c.clic(screen.getByRole('button', { name: 'Agregar otra sucursal' }));
    await c.teclear(screen.getByLabelText('Sucursal 3'), 'Playa');
    await c.elegir(screen.getByLabelText('Zona horaria de la sucursal 3'), 'America/Cancun');
    await c.clic(screen.getByRole('button', { name: 'Siguiente' }), { cambiaPantalla: true });

    // 3. Administrador, con la contraseña inicial propuesta reemplazada por una conocida.
    await c.teclear(screen.getByLabelText('Nombre del administrador'), 'Laura Pérez');
    await c.teclear(screen.getByLabelText('Email del administrador'), 'laura@tacosnorte.test');
    await c.teclear(screen.getByLabelText('Contraseña inicial'), PASSWORD_ADMIN);
    await c.clic(screen.getByRole('button', { name: 'Siguiente' }), { cambiaPantalla: true });

    // 4. Revisar y crear
    expect(screen.getByText('Grupo Tacos del Norte')).toBeInTheDocument();
    await c.clic(screen.getByRole('button', { name: 'Crear empresa y generar keys' }), {
      cambiaPantalla: true,
    });

    // 5. Listo: lo que se mandó es exactamente el contrato.
    expect(await screen.findByText(/quedó dada de alta con 3 sucursales/)).toBeInTheDocument();
    const [llamada] = api.llamadas.filter((l) => l.ruta === '/empresas/alta-guiada');
    expect(llamada.cuerpo).toEqual({
      nombre: 'Grupo Tacos del Norte',
      sucursales: [
        { nombre: 'Centro', zonaHoraria: 'America/Mexico_City' },
        { nombre: 'Norte', zonaHoraria: 'America/Monterrey' },
        { nombre: 'Playa', zonaHoraria: 'America/Cancun' },
      ],
      administrador: {
        nombre: 'Laura Pérez',
        email: 'laura@tacosnorte.test',
        password: PASSWORD_ADMIN,
      },
    });

    // Las tres keys, cada una con su botón de copiar (y se copian de verdad).
    for (const [i, nombre] of ['Centro', 'Norte', 'Playa'].entries()) {
      expect(screen.getByLabelText(`API key de ${nombre}`)).toHaveValue(
        `msr_key-sintetica-${i + 1}-F2-147`,
      );
      await c.clic(screen.getByRole('button', { name: `Copiar la API key de ${nombre}` }));
      expect(await navigator.clipboard.readText()).toBe(`msr_key-sintetica-${i + 1}-F2-147`);
    }
    await c.clic(screen.getByRole('button', { name: 'Copiar la contraseña inicial' }));

    // Guía, descarga y lista de arranque de la empresa nueva.
    expect(screen.getByRole('link', { name: 'Abrir la guía de instalación' })).toHaveAttribute(
      'href',
      '/ayuda/agente',
    );
    const lista = await screen.findByRole('region', { name: 'Lista de arranque' });
    expect(within(lista).getByText('3 de 5 pasos')).toBeInTheDocument();
    expect(within(lista).getByText('Falta en: Centro, Norte, Playa')).toBeInTheDocument();
    expect(
      within(lista).getByRole('link', { name: 'Descargar el instalador del agente' }),
    ).toHaveAttribute('href', 'https://descargas.monitor.test/agente.zip');

    // Las keys no se quedan en ninguna caché ni en el almacenamiento del navegador.
    const cache = JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
    );
    const mutaciones = JSON.stringify(
      queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.state),
    );
    for (const guardado of [
      cache,
      mutaciones,
      JSON.stringify({ ...window.localStorage }),
      JSON.stringify({ ...window.sessionStorage }),
    ]) {
      expect(guardado).not.toContain('msr_key-sintetica');
      expect(guardado).not.toContain(PASSWORD_ADMIN);
    }

    // Terminar exige confirmar que se copiaron.
    const terminar = screen.getByRole('button', { name: 'Terminar e ir al panel de la empresa' });
    expect(terminar).toBeDisabled();
    await c.clic(screen.getByLabelText(/Ya copié las API keys y la contraseña/));
    await c.clic(terminar, { cambiaPantalla: true });
    expect(await screen.findByRole('heading', { name: 'Panel de ventas' })).toBeInTheDocument();

    // El cronómetro.
    const estimado = c.segundos();
    const real = (performance.now() - inicio) / 1000;
    console.info(
      `[F2-147 cronómetro] campos=${c.campos.size} caracteres=${c.cuenta.caracteres} ` +
        `clics=${c.cuenta.clics} selecciones=${c.cuenta.selecciones} pantallas=${c.cuenta.pantallas} ` +
        `→ captura estimada ${Math.round(estimado)} s (tope ${TOPE_SEGUNDOS} s); flujo automático ${real.toFixed(1)} s`,
    );
    expect(c.campos.size).toBe(7);
    expect(estimado).toBeLessThan(TOPE_SEGUNDOS);
    expect(real).toBeLessThan(TOPE_SEGUNDOS);
  });

  it('valida cada paso en español antes de avanzar', async () => {
    instalar();
    montar('/admin/alta');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Siguiente' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe el nombre de la empresa.');
    await user.type(screen.getByLabelText(/Nombre de la empresa/), 'Grupo');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));

    await user.type(screen.getByLabelText('Sucursal 1'), 'Centro');
    await user.click(screen.getByRole('button', { name: 'Agregar otra sucursal' }));
    await user.type(screen.getByLabelText('Sucursal 2'), '  centro ');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByRole('alert')).toHaveTextContent('La sucursal "centro" está repetida.');
    await user.click(screen.getByRole('button', { name: 'Quitar la sucursal 2' }));
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));

    await user.type(screen.getByLabelText('Nombre del administrador'), 'Laura');
    await user.type(screen.getByLabelText('Email del administrador'), 'no-es-email');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe un email válido');
    await user.clear(screen.getByLabelText('Email del administrador'));
    await user.type(screen.getByLabelText('Email del administrador'), 'laura@x.test');
    await user.clear(screen.getByLabelText('Contraseña inicial'));
    await user.type(screen.getByLabelText('Contraseña inicial'), 'corta');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByRole('alert')).toHaveTextContent('al menos 12 caracteres');

    // Sin administrador también se puede.
    await user.click(screen.getByLabelText('Crear ahora al administrador de la empresa'));
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText('Sin administrador por ahora')).toBeInTheDocument();
  });

  it('la contraseña inicial propuesta es aleatoria, de 16, y se puede regenerar', async () => {
    instalar();
    montar('/admin/alta');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Nombre de la empresa/), 'Grupo');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await user.type(screen.getByLabelText('Sucursal 1'), 'Centro');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    const campo = screen.getByLabelText('Contraseña inicial');
    const primera = (campo as HTMLInputElement).value;
    expect(primera).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{16}$/);
    await user.click(screen.getByRole('button', { name: 'Generar otra' }));
    expect((campo as HTMLInputElement).value).not.toBe(primera);
  });

  it('un error del api (email duplicado) se muestra y deja volver a intentar', async () => {
    instalar('admin_global', () =>
      json(409, { statusCode: 409, message: 'Ese email ya está en uso' }),
    );
    montar('/admin/alta');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Nombre de la empresa/), 'Grupo');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await user.type(screen.getByLabelText('Sucursal 1'), 'Centro');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await user.type(screen.getByLabelText('Nombre del administrador'), 'Laura');
    await user.type(screen.getByLabelText('Email del administrador'), 'repetido@x.test');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await user.click(screen.getByRole('button', { name: 'Crear empresa y generar keys' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ese email ya está en uso');
    expect(screen.getByRole('button', { name: 'Crear empresa y generar keys' })).toBeEnabled();
    expect(screen.queryByText(/quedó dada de alta/)).not.toBeInTheDocument();
  });

  it('sólo admin_global: para admin_empresa la ruta no existe y no se ofrece el botón', async () => {
    instalar('admin_empresa');
    montar(`/admin/alta?empresa=${EMPRESA_A.id}`);
    expect(await screen.findByText(/no existe/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Nombre de la empresa/)).not.toBeInTheDocument();
  });

  it('Administración › Empresas ofrece el alta guiada', async () => {
    instalar();
    montar(`/admin?empresa=${EMPRESA_A.id}&tab=empresas`);
    expect(await screen.findByRole('link', { name: 'Alta guiada de empresa' })).toHaveAttribute(
      'href',
      '/admin/alta',
    );
  });
});
