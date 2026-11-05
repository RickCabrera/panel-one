import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Proveedores, Rutas } from '../App';
import { terminarSesion } from '../auth/sesion';
import { crearQueryClient } from '../consultas/queryClient';
import { instalarApiFalsa, noAutorizado } from '../test/apiFalsa';

// LAND-01: el logo del login lleva a la landing, que Caddy sirve aparte en /landing/ (no es una
// ruta de la SPA). Por eso es un <a href> normal: un <Link> del router se quedaría dentro de la
// SPA y su fallback mostraría «No encontrada» en vez de la landing.

afterEach(() => {
  cleanup();
  terminarSesion('cerrada');
  vi.unstubAllGlobals();
});

describe('login: el logo enlaza a la landing', () => {
  it('es un enlace normal a /landing con su aria-label, y sigue siendo el <h1> de la marca', async () => {
    instalarApiFalsa({ 'POST /auth/refresh': () => noAutorizado() });
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Proveedores queryClient={crearQueryClient()}>
          <Rutas />
        </Proveedores>
      </MemoryRouter>,
    );

    const enlace = await screen.findByRole('link', { name: 'Ir a la página de Yo Controlo' });
    expect(enlace.tagName).toBe('A');
    expect(enlace).toHaveAttribute('href', '/landing');
    // Foco visible y cursor de enlace.
    expect(enlace).toHaveClass('cursor-pointer');
    expect(enlace.className).toMatch(/focus-visible:outline-2/);
    // El logo sigue siendo el encabezado de la página, dentro del enlace.
    const titulo = screen.getByRole('heading', { level: 1, name: 'Yo Controlo' });
    expect(enlace).toContainElement(titulo);
  });
});
