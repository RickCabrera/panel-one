import { enviar, validar, type Campo, type DatosContacto } from './contacto';

/**
 * El único JS de la landing (F2-147): el formulario de contacto. Sin él, la página se lee
 * completa (todo lo demás es HTML y CSS). Los errores van junto a cada campo con
 * `aria-describedby` y el resultado en una región `aria-live`.
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

iniciar();
