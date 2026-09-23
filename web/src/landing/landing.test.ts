import landingHtml from '../../landing/index.html?raw';
import { afterEach, describe, expect, it, vi } from 'vitest';

// La landing (F2-147) montada en jsdom con su HTML REAL y su módulo: el formulario valida,
// marca cada campo, y envía. Así el HTML y `main.ts` no se pueden desalinear (un `name` cambiado
// en el HTML rompería el envío en silencio).

function montar() {
  const cuerpo = landingHtml.slice(
    landingHtml.indexOf('<body>') + 6,
    landingHtml.indexOf('</body>'),
  );
  document.body.innerHTML = cuerpo;
}

async function cargarModulo() {
  vi.resetModules();
  await import('./main');
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('Landing: formulario de contacto', () => {
  it('sin datos: marca cada campo obligatorio, enfoca el primero y no envía', async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);
    montar();
    await cargarModulo();
    document
      .querySelector<HTMLButtonElement>('#formulario-contacto button[type="submit"]')!
      .click();

    expect(document.getElementById('error-nombre')!.textContent).toBe('Escribe tu nombre.');
    expect(document.getElementById('error-email')!.textContent).toMatch(/Escribe tu email/);
    expect(document.getElementById('error-mensaje')!.textContent).toBe('Cuéntanos qué necesitas.');
    expect(document.getElementById('nombre')!.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('telefono')!.getAttribute('aria-invalid')).toBe('false');
    expect(document.activeElement).toBe(document.getElementById('nombre'));
    expect(document.getElementById('contacto-estado')!.textContent).toBe(
      'Revisa los campos marcados.',
    );
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('con datos: envía el cuerpo del contrato y confirma', async () => {
    const fetchFalso = vi.fn(async () => new Response('{"recibido":true}', { status: 202 }));
    vi.stubGlobal('fetch', fetchFalso);
    montar();
    await cargarModulo();
    const poner = (id: string, valor: string) => {
      (document.getElementById(id) as HTMLInputElement).value = valor;
    };
    poner('nombre', 'Ana');
    poner('email', 'ana@ejemplo.test');
    poner('sucursales', '2');
    poner('mensaje', 'Hola');
    document
      .querySelector<HTMLButtonElement>('#formulario-contacto button[type="submit"]')!
      .click();

    await vi.waitFor(() =>
      expect(document.getElementById('contacto-estado')!.textContent).toBe(
        'Recibimos tu mensaje. Te contactamos pronto.',
      ),
    );
    const [ruta, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(ruta).toBe('/api/publico/contacto');
    expect(JSON.parse(String(init.body))).toEqual({
      nombre: 'Ana',
      email: 'ana@ejemplo.test',
      sucursales: 2,
      mensaje: 'Hola',
    });
    // El formulario se limpia tras el envío.
    expect((document.getElementById('nombre') as HTMLInputElement).value).toBe('');
  });

  it('la trampa para bots está fuera del orden de tabulación y oculta a lectores de pantalla', () => {
    montar();
    const trampa = document.getElementById('sitio')!;
    expect(trampa.getAttribute('tabindex')).toBe('-1');
    expect(trampa.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('las capturas son ilustraciones con título y lo dicen', () => {
    montar();
    const capturas = document.querySelectorAll('figure.captura');
    expect(capturas.length).toBeGreaterThanOrEqual(2);
    for (const c of capturas) {
      expect(c.querySelector('svg[role="img"] title')?.textContent).toMatch(/^Ilustración/);
      expect(c.querySelector('figcaption')?.textContent).toBe(
        'Ilustración con datos de demostración.',
      );
    }
  });

  it('los precios no inventan cifras: dicen que están por confirmar', () => {
    montar();
    const precios = [...document.querySelectorAll('#precios .precio')].map((p) => p.textContent);
    expect(precios).toHaveLength(3);
    for (const p of precios) expect(p).toBe('Precio por confirmar');
    expect(document.querySelector('#precios')!.textContent).not.toMatch(/\$\s?\d/);
  });
});
