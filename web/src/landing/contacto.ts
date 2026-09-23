/**
 * El formulario de contacto de la landing (F2-147): validación campo por campo en español y el
 * envío a `POST /api/publico/contacto` (mismo origen: Caddy pasa `/api` al api también en el
 * dominio de la landing, sin CORS; ver F1-002). Los límites son los de `ContactoDto`: el api
 * vuelve a validar y es quien manda.
 */

export interface DatosContacto {
  nombre: string;
  email: string;
  telefono: string;
  negocio: string;
  sucursales: string;
  mensaje: string;
  /** La trampa para bots: el formulario la esconde; una persona la deja vacía. */
  sitio: string;
}

export type Campo = Exclude<keyof DatosContacto, 'sitio'>;
export type Errores = Partial<Record<Campo, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validar(d: DatosContacto): Errores {
  const errores: Errores = {};
  const nombre = d.nombre.trim();
  if (nombre === '') errores.nombre = 'Escribe tu nombre.';
  else if (nombre.length > 120) errores.nombre = 'El nombre admite hasta 120 caracteres.';

  const email = d.email.trim();
  if (email === '') errores.email = 'Escribe tu email para poder responderte.';
  else if (!EMAIL.test(email) || email.length > 254) errores.email = 'Ese email no parece válido.';

  if (d.telefono.trim().length > 30) errores.telefono = 'El teléfono admite hasta 30 caracteres.';
  if (d.negocio.trim().length > 120) errores.negocio = 'El nombre admite hasta 120 caracteres.';

  const sucursales = d.sucursales.trim();
  if (sucursales !== '') {
    const n = Number(sucursales);
    if (!Number.isInteger(n) || n < 1 || n > 500) {
      errores.sucursales = 'Escribe un número de sucursales entre 1 y 500.';
    }
  }

  const mensaje = d.mensaje.trim();
  if (mensaje === '') errores.mensaje = 'Cuéntanos qué necesitas.';
  else if (mensaje.length > 2000) errores.mensaje = 'El mensaje admite hasta 2000 caracteres.';
  return errores;
}

/** El cuerpo exacto que espera `ContactoDto`: sin campos vacíos opcionales. */
export function cuerpo(d: DatosContacto): Record<string, string | number> {
  const salida: Record<string, string | number> = {
    nombre: d.nombre.trim(),
    email: d.email.trim(),
    mensaje: d.mensaje.trim(),
  };
  if (d.telefono.trim()) salida.telefono = d.telefono.trim();
  if (d.negocio.trim()) salida.negocio = d.negocio.trim();
  if (d.sucursales.trim()) salida.sucursales = Number(d.sucursales.trim());
  if (d.sitio) salida.sitio = d.sitio;
  return salida;
}

export type Resultado = { ok: true } | { ok: false; mensaje: string };

export async function enviar(d: DatosContacto, pedir: typeof fetch = fetch): Promise<Resultado> {
  let respuesta: Response;
  try {
    respuesta = await pedir('/api/publico/contacto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo(d)),
    });
  } catch {
    return {
      ok: false,
      mensaje: 'No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.',
    };
  }
  if (respuesta.status === 202) return { ok: true };
  if (respuesta.status === 429) {
    return {
      ok: false,
      mensaje:
        'Ya recibimos varios mensajes desde tu conexión. Espera un minuto y vuelve a intentar.',
    };
  }
  if (respuesta.status === 400) {
    return { ok: false, mensaje: 'Revisa los datos del formulario: alguno no es válido.' };
  }
  return {
    ok: false,
    mensaje: 'No pudimos recibir tu mensaje. Intenta de nuevo en unos minutos.',
  };
}
