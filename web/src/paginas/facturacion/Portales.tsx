import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ChangeEvent, type FormEvent } from 'react';

import { ErrorApi, pedir } from '../../api/cliente';
import type { SucursalPortal } from '../../api/tipos';
import { ACENTO_POR_DEFECTO } from '../../tema/paleta';
import { Esqueleto, SegunEstado, Tarjeta, Vacio } from '../inicio/Tarjeta';
import { aBase64, errorSlug, MAX_BYTES_LOGO, sugerirSlug } from './reglas';

/**
 * Facturación → Portal de autofactura (F2-103): el enlace público `/f/:slug` de cada sucursal,
 * su color y su logo. Sólo admins (la vista entera de Facturación ya lo es). El QR que lleve el
 * ticket a este enlace es F2-102.
 */

const CONTROL =
  'min-w-0 rounded-md border border-linea-fuerte bg-superficie px-2 py-1 text-sm focus:border-acento-borde focus:outline-none disabled:opacity-50';
const PRIMARIO =
  'rounded-md bg-acento px-3 py-1 text-sm font-medium text-sobre-acento disabled:opacity-50';
const SECUNDARIO =
  'rounded-md border border-linea-fuerte px-3 py-1 text-sm text-tinta-medio disabled:opacity-50';

const llave = (empresaId: string) => ['facturacion', 'portales', empresaId] as const;
const mensajeDe = (e: unknown) => (e instanceof ErrorApi ? e.message : 'Error inesperado.');

export function PortalesAutofactura({ empresaId }: { empresaId: string }) {
  const consulta = useQuery({
    queryKey: llave(empresaId),
    queryFn: ({ signal }) =>
      pedir<SucursalPortal[]>('/facturacion/portales', { query: { empresaId }, signal }),
  });
  return (
    <Tarjeta titulo="Portal de autofactura">
      <p className="mb-3 text-sm text-tinta-tenue">
        El enlace donde tus clientes facturan su ticket desde el celular, con el color y el logo de
        cada sucursal. Hoy el portal deja consultar el código del ticket; la emisión de la factura
        se habilita más adelante.
      </p>
      <SegunEstado consulta={consulta} esqueleto={<Esqueleto lineas={3} />}>
        {(sucursales) =>
          sucursales.length === 0 ? (
            <Vacio>Esta empresa no tiene sucursales: da de alta una en Administración.</Vacio>
          ) : (
            <ul className="divide-y divide-linea">
              {sucursales.map((s) => (
                <li key={s.sucursalId} className="py-3">
                  <FilaPortal
                    empresaId={empresaId}
                    sucursal={s}
                    // Otra versión guardada: el formulario arranca de lo guardado.
                    key={s.portal?.actualizadoAt ?? 'nuevo'}
                  />
                </li>
              ))}
            </ul>
          )
        }
      </SegunEstado>
    </Tarjeta>
  );
}

function FilaPortal({ empresaId, sucursal: s }: { empresaId: string; sucursal: SucursalPortal }) {
  const queryClient = useQueryClient();
  const base = useId();
  const [slug, setSlug] = useState(s.portal?.slug ?? sugerirSlug(s.sucursal));
  const [color, setColor] = useState(s.portal?.color ?? ACENTO_POR_DEFECTO);
  const [activo, setActivo] = useState(s.portal?.activo ?? true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intentado, setIntentado] = useState(false);
  const errSlug = errorSlug(slug);
  const errColor = /^#[0-9a-fA-F]{6}$/.test(color) ? null : 'Elige un color.';

  const refrescar = (fila: SucursalPortal) =>
    queryClient.setQueryData<SucursalPortal[]>(llave(empresaId), (actual) =>
      actual?.map((x) => (x.sucursalId === fila.sucursalId ? fila : x)),
    );

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setIntentado(true);
    setError(null);
    if (errSlug || errColor) return;
    setEnviando(true);
    try {
      refrescar(
        await pedir<SucursalPortal>(`/facturacion/portales/${s.sucursalId}`, {
          method: 'PUT',
          body: { slug, color, activo },
        }),
      );
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setEnviando(false);
    }
  }

  async function subirLogo(e: ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    setError(null);
    if (archivo.size > MAX_BYTES_LOGO) {
      setError('El logo pesa más de 200 KB.');
      return;
    }
    setEnviando(true);
    try {
      refrescar(
        await pedir<SucursalPortal>(`/facturacion/portales/${s.sucursalId}/logo`, {
          method: 'PUT',
          body: { contenidoBase64: aBase64(await archivo.arrayBuffer()) },
        }),
      );
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setEnviando(false);
    }
  }

  async function quitarLogo() {
    setError(null);
    setEnviando(true);
    try {
      refrescar(
        await pedir<SucursalPortal>(`/facturacion/portales/${s.sucursalId}/logo`, {
          method: 'DELETE',
        }),
      );
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form
      onSubmit={guardar}
      noValidate
      aria-label={`Portal de ${s.sucursal}`}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{s.sucursal}</h3>
        {s.portal ? (
          s.portal.activo && s.sucursalActiva ? (
            <a
              href={`/f/${s.portal.slug}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-acento-texto underline"
            >
              Abrir /f/{s.portal.slug}
            </a>
          ) : (
            <span className="text-sm text-tinta-tenue">
              {s.sucursalActiva ? 'Portal apagado' : 'Sucursal dada de baja: el portal no se ve'}
            </span>
          )
        ) : (
          <span className="text-sm text-tinta-tenue">Sin portal todavía</span>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={`${base}-slug`}>Enlace</label>
          <div className="flex items-center gap-1">
            <span className="text-tinta-tenue">/f/</span>
            <input
              id={`${base}-slug`}
              className={CONTROL}
              value={slug}
              onChange={(e) => setSlug(e.target.value.trim().toLowerCase())}
              maxLength={40}
              aria-invalid={intentado && errSlug ? true : undefined}
              aria-describedby={intentado && errSlug ? `${base}-slug-error` : undefined}
            />
          </div>
          {intentado && errSlug && (
            <span id={`${base}-slug-error`} className="text-xs text-peligro">
              {errSlug}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={`${base}-color`}>Color</label>
          <input
            id={`${base}-color`}
            type="color"
            className="h-8 w-14 rounded-md border border-linea-fuerte bg-superficie"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            aria-invalid={intentado && errColor ? true : undefined}
            aria-describedby={intentado && errColor ? `${base}-color-error` : undefined}
          />
          {intentado && errColor && (
            <span id={`${base}-color-error`} className="text-xs text-peligro">
              {errColor}
            </span>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
          Portal encendido
        </label>
        <button type="submit" className={PRIMARIO} disabled={enviando}>
          {s.portal ? 'Guardar' : 'Crear portal'}
        </button>
      </div>
      {s.portal && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-tinta-tenue">
            {s.portal.tieneLogo ? 'Con logo.' : 'Sin logo: el portal muestra las iniciales.'}
          </span>
          <label className={`${SECUNDARIO} cursor-pointer`}>
            {s.portal.tieneLogo ? 'Cambiar logo' : 'Subir logo'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => void subirLogo(e)}
              disabled={enviando}
            />
          </label>
          {s.portal.tieneLogo && (
            <button
              type="button"
              className={SECUNDARIO}
              onClick={() => void quitarLogo()}
              disabled={enviando}
            >
              Quitar logo
            </button>
          )}
          <span className="text-xs text-tinta-tenue">PNG, JPEG o WebP, hasta 200 KB.</span>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
    </form>
  );
}
