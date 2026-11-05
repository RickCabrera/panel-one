import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UsuarioActual } from '../api/tipos';
import { AuthContexto, type ContextoAuth, type EstadoAuth } from '../auth/contexto';
import { oyentesDelSistema, temaDelSistema } from '../test/matchMedia';
import { ACENTO_POR_DEFECTO } from './acento';
import { useTema } from './contexto';
import { InterruptorEstilo } from './InterruptorEstilo';
import { InterruptorTema } from './InterruptorTema';
import { PALETAS } from './paleta';
import { ProveedorTema } from './ProveedorTema';
import {
  aplicarTema,
  CLAVE_ESTILO_ULTIMO,
  CLAVE_ULTIMO,
  claveEstilo,
  clavePreferencia,
  guardarEstilo,
  guardarPreferencia,
  iniciarTema,
  leerEstilo,
  leerPreferencia,
  resolverTema,
  zonaOscura,
} from './tema';

// UI-06: sin elegir nada, el estilo es «Noche»; la paleta que se aplica es la suya.
const PALETA = PALETAS.noche;

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

describe('estilo guardado (UI-06)', () => {
  it('sin nada guardado es «Noche»', () => {
    expect(leerEstilo()).toBe('noche');
    expect(leerEstilo('u1')).toBe('noche');
  });

  it('el del usuario gana; sin el suyo, el último de este navegador', () => {
    guardarEstilo('clasico', 'u1');
    expect(window.localStorage.getItem(claveEstilo('u1'))).toBe('clasico');
    expect(window.localStorage.getItem(CLAVE_ESTILO_ULTIMO)).toBe('clasico');
    guardarEstilo('noche', 'u2');
    expect(leerEstilo('u1')).toBe('clasico');
    expect(leerEstilo('u2')).toBe('noche');
    expect(leerEstilo('u3')).toBe('noche');
  });

  it('basura en el storage se ignora', () => {
    window.localStorage.setItem(CLAVE_ESTILO_ULTIMO, 'morado');
    window.localStorage.setItem(claveEstilo('u1'), 'oscuro');
    expect(leerEstilo('u1')).toBe('noche');
  });

  it('un storage que truena no rompe nada', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => guardarEstilo('clasico', 'u1')).not.toThrow();
    expect(leerEstilo('u1')).toBe('noche');
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

  // UI-06: el estilo va en `data-estilo` (de él cuelgan el vidrio y el resplandor de index.css).
  it('sin estilo pone «Noche»; con «Clásico» pone la paleta de la v3, tal cual', () => {
    aplicarTema('claro', ACENTO_POR_DEFECTO);
    expect(raiz.dataset.estilo).toBe('noche');
    expect(raiz.style.getPropertyValue('--lateral')).toBe(PALETAS.noche.claro.lateral);
    aplicarTema('oscuro', ACENTO_POR_DEFECTO, raiz, 'clasico');
    expect(raiz.dataset.estilo).toBe('clasico');
    for (const [token, valor] of Object.entries(PALETAS.clasico.oscuro)) {
      expect(raiz.style.getPropertyValue(`--${token}`)).toBe(valor);
    }
  });

  it('el theme-color de la barra del navegador sigue al lateral del estilo', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
    try {
      aplicarTema('claro', ACENTO_POR_DEFECTO, raiz, 'noche');
      expect(meta.content).toBe(PALETAS.noche.claro.lateral);
      aplicarTema('claro', ACENTO_POR_DEFECTO, raiz, 'clasico');
      expect(meta.content).toBe(PALETAS.clasico.claro.lateral);
    } finally {
      meta.remove();
    }
  });

  it('la zona oscura: en «Noche» claro trae la paleta oscura; en oscuro o en «Clásico», nada', () => {
    const zona = zonaOscura('claro', ACENTO_POR_DEFECTO, 'noche');
    expect(zona?.['--fondo']).toBe(PALETAS.noche.oscuro.fondo);
    expect(zona?.['--tinta']).toBe(PALETAS.noche.oscuro.tinta);
    expect(zona?.['--acento-texto']).toBeDefined();
    expect(zona?.colorScheme).toBe('dark');
    expect(zonaOscura('oscuro', ACENTO_POR_DEFECTO, 'noche')).toBeUndefined();
    expect(zonaOscura('claro', ACENTO_POR_DEFECTO, 'clasico')).toBeUndefined();
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

  it('el arranque aplica también el último estilo, sin esperar al primer render', () => {
    window.localStorage.setItem(CLAVE_ESTILO_ULTIMO, 'clasico');
    window.localStorage.setItem(CLAVE_ULTIMO, 'claro');
    iniciarTema(ACENTO_POR_DEFECTO);
    expect(raiz.dataset.estilo).toBe('clasico');
    expect(raiz.style.getPropertyValue('--fondo')).toBe(PALETAS.clasico.claro.fondo);
    window.localStorage.removeItem(CLAVE_ESTILO_ULTIMO);
    iniciarTema(ACENTO_POR_DEFECTO);
    expect(raiz.dataset.estilo).toBe('noche');
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
  const { tema, preferencia, estilo } = useTema();
  return (
    <>
      <p data-testid="tema">{`${preferencia}:${tema}`}</p>
      <p data-testid="estilo">{estilo}</p>
    </>
  );
}

function montar(estado: EstadoAuth = { estado: 'anonimo', motivo: 'inicio' }) {
  const arbol = (e: EstadoAuth) => (
    <AuthContexto.Provider value={authCon(e)}>
      <ProveedorTema>
        <InterruptorTema />
        <InterruptorEstilo />
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

describe('selector de estilo (UI-06)', () => {
  const estiloMostrado = () => screen.getByTestId('estilo').textContent;

  it('arranca en «Noche» y lo marca como elegido', () => {
    montar();
    expect(estiloMostrado()).toBe('noche');
    expect(screen.getByRole('button', { name: 'Estilo Noche' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Estilo Clásico' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(raiz.dataset.estilo).toBe('noche');
  });

  it('elegir «Clásico» lo aplica al momento y lo guarda para el usuario y el navegador', async () => {
    montar(conId('u1'));
    const clasico = screen.getByRole('button', { name: 'Estilo Clásico' });
    await userEvent.setup().click(clasico);
    expect(clasico).toHaveAttribute('aria-pressed', 'true');
    expect(estiloMostrado()).toBe('clasico');
    expect(raiz.dataset.estilo).toBe('clasico');
    expect(raiz.style.getPropertyValue('--lateral')).toBe(PALETAS.clasico.claro.lateral);
    expect(window.localStorage.getItem(claveEstilo('u1'))).toBe('clasico');
    expect(window.localStorage.getItem(CLAVE_ESTILO_ULTIMO)).toBe('clasico');
  });

  it('el estilo y el tema son independientes', async () => {
    montar(conId('u1'));
    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('button', { name: 'Estilo Clásico' }));
    await usuario.click(screen.getByRole('button', { name: 'Tema oscuro' }));
    expect(mostrado()).toBe('oscuro:oscuro');
    expect(estiloMostrado()).toBe('clasico');
    expect(raiz.style.getPropertyValue('--fondo')).toBe(PALETAS.clasico.oscuro.fondo);
    await usuario.click(screen.getByRole('button', { name: 'Estilo Noche' }));
    expect(raiz.style.getPropertyValue('--fondo')).toBe(PALETAS.noche.oscuro.fondo);
    expect(mostrado()).toBe('oscuro:oscuro');
  });

  it('persiste: al volver a montar (recargar) se queda el elegido', async () => {
    const { unmount } = montar(conId('u1'));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Estilo Clásico' }));
    unmount();
    montar(conId('u1'));
    expect(estiloMostrado()).toBe('clasico');
    expect(raiz.dataset.estilo).toBe('clasico');
  });

  it('al cambiar de usuario carga el estilo del que entra', () => {
    window.localStorage.setItem(claveEstilo('u1'), 'clasico');
    window.localStorage.setItem(claveEstilo('u2'), 'noche');
    const { cambiarAuth } = montar(conId('u1'));
    expect(estiloMostrado()).toBe('clasico');
    cambiarAuth(conId('u2'));
    expect(estiloMostrado()).toBe('noche');
    expect(raiz.dataset.estilo).toBe('noche');
  });
});
