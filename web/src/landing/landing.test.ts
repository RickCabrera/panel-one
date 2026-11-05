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

  it('las capturas son ilustraciones marcadas: el dibujo se oculta y el pie lo dice', () => {
    montar();
    const capturas = document.querySelectorAll('figure.captura');
    expect(capturas.length).toBeGreaterThanOrEqual(2);
    for (const c of capturas) {
      // UI-03: las capturas son HTML/CSS (no SVG); los datos inventados no se leen en voz alta.
      expect(c.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
      expect(c.querySelector('figcaption')?.textContent).toBe(
        'Ilustración con datos de demostración.',
      );
    }
  });

  it('los planes no inventan cifras: son tres y dicen "Cotiza"', () => {
    montar();
    const precios = [...document.querySelectorAll('#planes .precio')].map((p) => p.textContent);
    expect(precios).toEqual(['Cotiza', 'Cotiza', 'Cotiza']);
    expect(document.querySelector('#planes')!.textContent).not.toMatch(/\$\s?\d/);
  });

  it('"Quiero este plan" preselecciona el plan en el formulario y lleva al contacto', async () => {
    vi.stubGlobal('fetch', vi.fn());
    montar();
    Element.prototype.scrollIntoView = vi.fn();
    await cargarModulo();
    const botones = document.querySelectorAll<HTMLAnchorElement>('#planes a[data-plan]');
    expect([...botones].map((b) => b.dataset.plan)).toEqual(['Esencial', 'Completo', 'Cadena']);
    // Sin JS el enlace igual funciona: baja al formulario con el plan en la URL.
    expect(botones[1].getAttribute('href')).toBe('?plan=completo#contacto');

    botones[1].click();
    expect((document.getElementById('plan') as HTMLSelectElement).value).toBe('Completo');
    expect(document.activeElement).toBe(document.getElementById('nombre'));
  });

  it('el plan elegido viaja al inicio del mensaje (el api no tiene campo de plan)', async () => {
    const fetchFalso = vi.fn(async () => new Response('{"recibido":true}', { status: 202 }));
    vi.stubGlobal('fetch', fetchFalso);
    montar();
    Element.prototype.scrollIntoView = vi.fn();
    await cargarModulo();
    document.querySelector<HTMLAnchorElement>('#planes a[data-plan="Cadena"]')!.click();
    (document.getElementById('nombre') as HTMLInputElement).value = 'Ana';
    (document.getElementById('email') as HTMLInputElement).value = 'ana@ejemplo.test';
    (document.getElementById('mensaje') as HTMLTextAreaElement).value = 'Tengo 8 sucursales';
    document
      .querySelector<HTMLButtonElement>('#formulario-contacto button[type="submit"]')!
      .click();

    await vi.waitFor(() => expect(fetchFalso).toHaveBeenCalled());
    const [, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    const enviado = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(enviado.mensaje).toBe('Plan de interés: Cadena.\n\nTengo 8 sucursales');
    expect(enviado).not.toHaveProperty('plan');
  });
});
