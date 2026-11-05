import { iniciarAnimacion } from './animacion';
import { enviar, planDeTexto, validar, type Campo, type DatosContacto } from './contacto';

/**
 * El JS de la landing (F2-147, UI-03): el formulario de contacto, los botones "Quiero este plan"
 * y la demo animada del hero. Sin él, la página se lee completa (todo lo demás es HTML y CSS).
 * Los errores van junto a cada campo con `aria-describedby` y el resultado en una región
 * `aria-live`.
 */
const CAMPOS: Campo[] = ['nombre', 'email', 'telefono', 'negocio', 'sucursales', 'mensaje'];

function iniciar(): void {
  const form = document.querySelector<HTMLFormElement>('#formulario-contacto');
  const estado = document.querySelector<HTMLElement>('#contacto-estado');
  if (!form || !estado) return;
  const boton = form.querySelector<HTMLButtonElement>('button[type="submit"]');

  const leer = (): DatosContacto => {
    const valor = (n: string) =>
      (form.elements.namedItem(n) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? '';
    return {
      nombre: valor('nombre'),
      email: valor('email'),
      telefono: valor('telefono'),
      negocio: valor('negocio'),
      sucursales: valor('sucursales'),
      mensaje: valor('mensaje'),
      plan: valor('plan'),
      sitio: valor('sitio'),
    };
  };

  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    const datos = leer();
    const errores = validar(datos);
    let primero: HTMLElement | null = null;
    for (const campo of CAMPOS) {
      const control = form.elements.namedItem(campo) as HTMLElement | null;
      const aviso = document.getElementById(`error-${campo}`);
      const texto = errores[campo];
      if (aviso) aviso.textContent = texto ?? '';
      control?.setAttribute('aria-invalid', texto ? 'true' : 'false');
      if (texto && !primero) primero = control;
    }
    if (primero) {
      estado.textContent = 'Revisa los campos marcados.';
      estado.dataset.tipo = 'error';
      primero.focus();
      return;
    }
    if (boton) boton.disabled = true;
    estado.textContent = 'Enviando…';
    estado.dataset.tipo = '';
    void enviar(datos).then((r) => {
      if (boton) boton.disabled = false;
      if (r.ok) {
        form.reset();
        estado.textContent = 'Recibimos tu mensaje. Te contactamos pronto.';
        estado.dataset.tipo = 'ok';
      } else {
        estado.textContent = r.mensaje;
        estado.dataset.tipo = 'error';
      }
    });
  });
}

/**
 * "Quiero este plan" (UI-03): sin JS, `?plan=completo#contacto` recarga y baja al formulario; con
 * JS, preselecciona el plan sin recargar y enfoca el primer campo. Un `?plan=` en la URL al cargar
 * también lo preselecciona (sirve para compartir el enlace).
 */
function iniciarPlanes(): void {
  const selector = document.querySelector<HTMLSelectElement>('#formulario-contacto #plan');
  if (!selector) return;
  const elegir = (plan: string) => {
    if (plan) selector.value = plan;
  };
  elegir(planDeTexto(new URLSearchParams(window.location.search).get('plan')));

  for (const enlace of document.querySelectorAll<HTMLAnchorElement>('a[data-plan]')) {
    enlace.addEventListener('click', (evento) => {
      evento.preventDefault();
      elegir(planDeTexto(enlace.dataset.plan));
      const contacto = document.getElementById('contacto');
      contacto?.scrollIntoView({ block: 'start' });
      document.getElementById('nombre')?.focus({ preventScroll: true });
    });
  }
}

iniciar();
iniciarPlanes();
iniciarAnimacion();
