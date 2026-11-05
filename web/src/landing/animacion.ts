/**
 * La demo del hero de la landing (UI-03): el ojo de la marca vigila la caja. Cada pocos segundos
 * "entra una venta": un ticket cae a la lista, el contador de la venta del día sube y el ojo da un
 * respingo. La pupila sigue al puntero (o mira el ticket nuevo en pantallas táctiles) y de vez en
 * cuando parpadea. Todo es ilustración con datos inventados.
 *
 * Sin librerías: clases de CSS para los movimientos y `element.style` (CSSOM, permitido por la
 * CSP) para la pupila. Con `prefers-reduced-motion: reduce` no se mueve nada: queda la foto fija
 * del HTML. Se pausa con la pestaña oculta o con el hero fuera de pantalla.
 */

interface Venta {
  mesa: string;
  mesero: string;
  importe: number;
}

/** Ventas de demostración (nombres y montos inventados). */
export const VENTAS: readonly Venta[] = [
  { mesa: 'Mesa 12', mesero: 'Lupita', importe: 1180 },
  { mesa: 'Mesa 3', mesero: 'Toño', importe: 452.5 },
  { mesa: 'Para llevar', mesero: 'Caja', importe: 236 },
  { mesa: 'Terraza 4', mesero: 'Memo', importe: 978 },
  { mesa: 'Mesa 9', mesero: 'Lupita', importe: 640 },
  { mesa: 'Barra 2', mesero: 'Memo', importe: 185.5 },
  { mesa: 'Mesa 15', mesero: 'Toño', importe: 1325 },
  { mesa: 'Domicilio', mesero: 'Caja', importe: 389 },
];

const pesos = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

/** Formato del contador: `$48,215.50`. Los centavos van en enteros para no acumular error. */
export function formatoPesos(centavos: number): string {
  return pesos.format(centavos / 100);
}

/** Lee `$48,215.50` (o `48215.5`) como centavos enteros. */
export function centavosDe(texto: string): number {
  const limpio = texto.replace(/[^\d.]/g, '');
  const n = Number(limpio);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Hacia dónde se asoma la pupila: desplazamiento acotado a `alcance` en la dirección dada. */
export function asomo(dx: number, dy: number, alcance: number): { x: number; y: number } {
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { x: 0, y: 0 };
  const f = Math.min(1, d / 260) * alcance;
  return { x: (dx / d) * f, y: (dy / d) * f };
}

const MAX_TICKETS = 4;
const CADA_MS = 2800;
const ALCANCE = 22; // en unidades del viewBox del ojo

export function iniciarAnimacion(raiz: Document = document): void {
  const ojo = raiz.querySelector<SVGSVGElement>('.demo .ojo');
  const pupila = raiz.querySelector<SVGGElement>('.demo .pupila-mueve');
  const lista = raiz.getElementById('demo-lista');
  const venta = raiz.getElementById('demo-venta');
  const tickets = raiz.getElementById('demo-tickets');
  const hero = raiz.getElementById('inicio');
  if (!ojo || !pupila || !lista || !venta || !tickets || !hero) return;
  const vista = raiz.defaultView;
  if (!vista || vista.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== false) return;

  let centavos = centavosDe(venta.textContent ?? '');
  let cuenta = Number(tickets.textContent) || 0;
  let siguiente = 0;
  let visible = true;
  let usaPuntero = false;
  let cuadro = 0;

  const mirar = (x: number, y: number) => {
    const r = ojo.getBoundingClientRect();
    // El centro de la pupila está a ~63 % del ancho y ~48 % del alto del viewBox recortado.
    const p = asomo(x - (r.left + r.width * 0.62), y - (r.top + r.height * 0.48), ALCANCE);
    pupila.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
  };

  vista.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse') return;
      usaPuntero = true;
      mirar(e.clientX, e.clientY);
    },
    { passive: true },
  );

  const reiniciarClase = (el: Element, clase: string) => {
    el.classList.remove(clase);
    // Forzar reflow para que la misma animación vuelva a correr.
    void (el as HTMLElement | SVGElement).getBoundingClientRect();
    el.classList.add(clase);
  };

  const subirContador = (desde: number, hasta: number) => {
    vista.cancelAnimationFrame(cuadro);
    const inicio = vista.performance.now();
    const paso = (ahora: number) => {
      const t = Math.min(1, (ahora - inicio) / 900);
      const suave = 1 - (1 - t) ** 3;
      venta.textContent = formatoPesos(Math.round(desde + (hasta - desde) * suave));
      if (t < 1) cuadro = vista.requestAnimationFrame(paso);
    };
    cuadro = vista.requestAnimationFrame(paso);
  };

  const nuevaVenta = () => {
    const v = VENTAS[siguiente % VENTAS.length];
    siguiente += 1;
    const li = raiz.createElement('li');
    li.className = 'ticket cae';
    for (const [clase, texto] of [
      ['t-mesa', v.mesa],
      ['t-mesero', v.mesero],
      ['t-importe', formatoPesos(Math.round(v.importe * 100))],
    ] as const) {
      const s = raiz.createElement('span');
      s.className = clase;
      s.textContent = texto;
      li.append(s);
    }
    lista.prepend(li);
    while (lista.children.length > MAX_TICKETS) lista.lastElementChild?.remove();

    const antes = centavos;
    centavos += Math.round(v.importe * 100);
    cuenta += 1;
    tickets.textContent = String(cuenta);
    subirContador(antes, centavos);
    reiniciarClase(ojo, 'late');
    if (!usaPuntero) {
      // Sin ratón, la pupila voltea a ver el ticket que acaba de caer y luego regresa.
      const r = li.getBoundingClientRect();
      mirar(r.left + r.width / 2, r.top);
      vista.setTimeout(() => {
        if (!usaPuntero) pupila.style.transform = '';
      }, 1400);
    }
  };

  const parpadear = () => {
    if (visible && !raiz.hidden) reiniciarClase(ojo, 'parpadea');
    vista.setTimeout(parpadear, 3500 + Math.random() * 3500);
  };
  vista.setTimeout(parpadear, 2500);

  vista.setInterval(() => {
    if (visible && !raiz.hidden) nuevaVenta();
  }, CADA_MS);

  if (typeof vista.IntersectionObserver === 'function') {
    new vista.IntersectionObserver((entradas) => {
      visible = entradas.some((e) => e.isIntersecting);
    }).observe(hero);
  }
}
