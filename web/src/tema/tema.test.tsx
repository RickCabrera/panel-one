import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UsuarioActual } from '../api/tipos';
import { AuthContexto, type ContextoAuth, type EstadoAuth } from '../auth/contexto';
import { oyentesDelSistema, temaDelSistema } from '../test/matchMedia';
import { ACENTO_POR_DEFECTO } from './acento';
import { useTema } from './contexto';
import { InterruptorTema } from './InterruptorTema';
import { PALETA } from './paleta';
import { ProveedorTema } from './ProveedorTema';
import {
  aplicarTema,
  CLAVE_ULTIMO,
  clavePreferencia,
  guardarPreferencia,
  iniciarTema,
  leerPreferencia,
  resolverTema,
} from './tema';

const raiz = document.documentElement;

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('preferencia guardada', () => {
  it('sin nada guardado es "sistema"', () => {
    expect(leerPreferencia()).toBe('sistema');
    expect(leerPreferencia('u1')).toBe('sistema');
  });

  it('la del usuario gana; sin la suya, la última de este navegador', () => {
    guardarPreferencia('oscuro', 'u1');
    expect(window.localStorage.getItem(clavePreferencia('u1'))).toBe('oscuro');
    expect(window.localStorage.getItem(CLAVE_ULTIMO)).toBe('oscuro');
    guardarPreferencia('claro', 'u2');
    expect(leerPreferencia('u1')).toBe('oscuro');
    expect(leerPreferencia('u2')).toBe('claro');
    expect(leerPreferencia('u3')).toBe('claro');
    expect(leerPreferencia()).toBe('claro');
  });

  it('basura en el storage se ignora', () => {
    window.localStorage.setItem(CLAVE_ULTIMO, 'morado');
    window.localStorage.setItem(clavePreferencia('u1'), '{"x":1}');
    expect(leerPreferencia('u1')).toBe('sistema');
  });

  it('un storage que truena no rompe nada', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => guardarPreferencia('oscuro', 'u1')).not.toThrow();
    expect(leerPreferencia('u1')).toBe('sistema');
  });
});

describe('resolver y aplicar', () => {
  it.each([
    ['claro', false, 'claro'],
    ['claro', true, 'claro'],
    ['oscuro', false, 'oscuro'],
    ['sistema', false, 'claro'],
    ['sistema', true, 'oscuro'],
  ] as const)('%s con el sistema oscuro=%s se ve %s', (pref, oscuro, esperado) => {
    expect(resolverTema(pref, oscuro)).toBe(esperado);
  });

  it('pone cada token como variable en la raíz, más data-tema y color-scheme', () => {
    aplicarTema('oscuro', ACENTO_POR_DEFECTO);
    expect(raiz.dataset.tema).toBe('oscuro');
    expect(raiz.style.getPropertyValue('color-scheme')).toBe('dark');
    for (const [token, valor] of Object.entries(PALETA.oscuro)) {
      expect(raiz.style.getPropertyValue(`--${token}`)).toBe(valor);
    }
    expect(raiz.style.getPropertyValue('--acento')).toBe(ACENTO_POR_DEFECTO);
    expect(raiz.style.getPropertyValue('--acento-texto')).not.toBe('');
    aplicarTema('claro', ACENTO_POR_DEFECTO);
    expect(raiz.style.getPropertyValue('--fondo')).toBe(PALETA.claro.fondo);
    expect(raiz.style.getPropertyValue('color-scheme')).toBe('light');
  });

  it('usa el CSSOM, nunca el atributo style a mano (CSP style-src self)', () => {
    const setAttribute = vi.spyOn(raiz, 'setAttribute');
    aplicarTema('oscuro', ACENTO_POR_DEFECTO);
    expect(setAttribute).not.toHaveBeenCalledWith('style', expect.anything());
  });

  it('el arranque (main.tsx, antes del primer render) aplica la última preferencia', () => {
    window.localStorage.setItem(CLAVE_ULTIMO, 'oscuro');
    expect(iniciarTema(ACENTO_POR_DEFECTO)).toBe('oscuro');
    expect(raiz.dataset.tema).toBe('oscuro');
    expect(raiz.style.getPropertyValue('--fondo')).toBe(PALETA.oscuro.fondo);
  });

  it('el arranque sin preferencia sigue al sistema', () => {
    temaDelSistema(true);
    expect(iniciarTema(ACENTO_POR_DEFECTO)).toBe('oscuro');
  });

  it('sin matchMedia (navegador viejo) arranca en claro sin tronar', () => {
    // Simula un navegador que no lo trae; test-setup lo reinstala en el siguiente.
    Object.defineProperty(window, 'matchMedia', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    expect(iniciarTema(ACENTO_POR_DEFECTO)).toBe('claro');
  });
});

function authCon(estado: EstadoAuth): ContextoAuth {
  return { auth: estado, iniciarSesion: async () => {}, cerrarSesion: async () => {} };
}

const conId = (id: string): EstadoAuth => ({
  estado: 'autenticado',
  usuario: { id } as UsuarioActual,
});

function Mostrar() {
  const { tema, preferencia } = useTema();
  return <p data-testid="tema">{`${preferencia}:${tema}`}</p>;
}

function montar(estado: EstadoAuth = { estado: 'anonimo', motivo: 'inicio' }) {
  const arbol = (e: EstadoAuth) => (
    <AuthContexto.Provider value={authCon(e)}>
      <ProveedorTema>
        <InterruptorTema />
        <Mostrar />
      </ProveedorTema>
    </AuthContexto.Provider>
  );
  const r = render(arbol(estado));
  return { ...r, cambiarAuth: (e: EstadoAuth) => r.rerender(arbol(e)) };
}

const mostrado = () => screen.getByTestId('tema').textContent;

describe('ProveedorTema', () => {
  // AC3: con "sistema", cambiar el tema del sistema operativo se ve SIN recargar.
  it('con "sistema", el cambio del sistema operativo se refleja al momento', () => {
    montar();
    expect(mostrado()).toBe('sistema:claro');
    expect(raiz.dataset.tema).toBe('claro');

    act(() => temaDelSistema(true));
    expect(mostrado()).toBe('sistema:oscuro');
    expect(raiz.dataset.tema).toBe('oscuro');
    expect(raiz.style.getPropertyValue('--fondo')).toBe(PALETA.oscuro.fondo);

    act(() => temaDelSistema(false));
    expect(raiz.dataset.tema).toBe('claro');
  });

  it('con una elección fija, el sistema operativo no la mueve', async () => {
    montar();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tema claro' }));
    act(() => temaDelSistema(true));
    expect(mostrado()).toBe('claro:claro');
    expect(raiz.dataset.tema).toBe('claro');
  });

  it('deja de escuchar al sistema al desmontarse', () => {
    const { unmount } = montar();
    expect(oyentesDelSistema()).toBe(1);
    unmount();
    expect(oyentesDelSistema()).toBe(0);
  });

  it('el interruptor marca la opción activa y guarda la elección del usuario', async () => {
    montar(conId('u1'));
    const oscuro = screen.getByRole('button', { name: 'Tema oscuro' });
    expect(screen.getByRole('button', { name: 'Tema del sistema' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.setup().click(oscuro);
    expect(oscuro).toHaveAttribute('aria-pressed', 'true');
    expect(raiz.dataset.tema).toBe('oscuro');
    expect(window.localStorage.getItem(clavePreferencia('u1'))).toBe('oscuro');
  });

  it('al cambiar de usuario carga la preferencia del que entra', () => {
    window.localStorage.setItem(clavePreferencia('u1'), 'oscuro');
    window.localStorage.setItem(clavePreferencia('u2'), 'claro');
    const { cambiarAuth } = montar(conId('u1'));
    expect(mostrado()).toBe('oscuro:oscuro');
    cambiarAuth(conId('u2'));
    expect(mostrado()).toBe('claro:claro');
    expect(raiz.dataset.tema).toBe('claro');
  });
});
