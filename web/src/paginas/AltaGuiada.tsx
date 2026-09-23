import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';

import type { AltaGuiada as DatosAlta, AltaGuiadaHecha } from '../api/tipos';
import { PARAM_EMPRESA } from '../filtros/alcance';
import { api } from './admin/consultas';
import { CLASE_BOTON, CLASE_INPUT, CLASE_PRIMARIO } from './admin/estilos';
import { ZONA_POR_DEFECTO, zonasDisponibles } from './admin/zonas';
import { ChecklistArranque } from './onboarding/ChecklistArranque';
import { generarPassword } from './onboarding/password';
import { Vista } from './Vista';

/** Igual que el api (`PASSWORD_MIN` y `SUCURSALES_MAX_ALTA`): la validación final es la suya. */
const PASSWORD_MIN = 12;
const SUCURSALES_MAX = 20;
const NOMBRE_MAX = 120;

const PASOS = ['Empresa', 'Sucursales', 'Administrador', 'Revisar', 'Listo'] as const;

interface FilaSucursal {
  clave: number;
  nombre: string;
  zonaHoraria: string;
}

function normalizar(nombre: string): string {
  return nombre.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-MX');
}

function Campo({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 text-sm">
      <span className="text-tinta-suave">{etiqueta}</span>
      {children}
    </label>
  );
}

function Copiar({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const [estado, setEstado] = useState<'copiada' | 'fallo' | null>(null);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setEstado('copiada');
    } catch {
      setEstado('fallo');
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className={CLASE_BOTON}
        aria-label={etiqueta}
        onClick={() => void copiar()}
      >
        Copiar
      </button>
      {estado === 'copiada' && <span role="status">Copiada</span>}
      {estado === 'fallo' && (
        <span role="alert" className="text-peligro">
          Selecciónala y cópiala a mano
        </span>
      )}
    </span>
  );
}

/**
 * Alta guiada de una empresa (F2-147), sólo admin_global: datos, sucursales, primer
 * administrador, y al final las API keys de cada sucursal, la guía del agente y la lista de
 * arranque. Todo se crea en UNA llamada al api (una transacción): no quedan empresas a medias.
 *
 * Las keys y la contraseña viven sólo en el estado de este componente: nada de `useMutation`
 * (TanStack guarda las respuestas en su caché), nada de localStorage, y el service worker de la
 * PWA nunca toca `/api/` (F2-146).
 */
export function AltaGuiada() {
  const idBase = useId();
  const navigate = useNavigate();
  const cliente = useQueryClient();
  const [paso, setPaso] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [enCurso, setEnCurso] = useState(false);

  const [nombre, setNombre] = useState('');
  const [siguiente, setSiguiente] = useState(2);
  const [sucursales, setSucursales] = useState<FilaSucursal[]>([
    { clave: 1, nombre: '', zonaHoraria: ZONA_POR_DEFECTO },
  ]);
  const [conAdmin, setConAdmin] = useState(true);
  const [admin, setAdmin] = useState({ nombre: '', email: '', password: generarPassword() });
  const [hecha, setHecha] = useState<AltaGuiadaHecha | null>(null);
  const [copiadas, setCopiadas] = useState(false);

  // Con las keys en pantalla y sin confirmar que se copiaron, cerrar la pestaña avisa.
  useEffect(() => {
    if (!hecha || copiadas) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [hecha, copiadas]);

  function validar(p: number): string | null {
    if (p === 0) {
      if (nombre.trim() === '') return 'Escribe el nombre de la empresa.';
      if (nombre.trim().length > NOMBRE_MAX)
        return `El nombre admite hasta ${NOMBRE_MAX} caracteres.`;
    }
    if (p === 1) {
      if (sucursales.length === 0) return 'Agrega al menos una sucursal.';
      if (sucursales.some((s) => s.nombre.trim() === '')) return 'Cada sucursal necesita nombre.';
      const vistos = new Set<string>();
      for (const s of sucursales) {
        const clave = normalizar(s.nombre);
        if (vistos.has(clave)) return `La sucursal "${s.nombre.trim()}" está repetida.`;
        vistos.add(clave);
      }
    }
    if (p === 2 && conAdmin) {
      if (admin.nombre.trim() === '') return 'Escribe el nombre del administrador.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admin.email.trim())) {
        return 'Escribe un email válido para el administrador.';
      }
      if (admin.password.length < PASSWORD_MIN) {
        return `La contraseña necesita al menos ${PASSWORD_MIN} caracteres.`;
      }
    }
    return null;
  }

  function avanzar(e: FormEvent) {
    e.preventDefault();
    const problema = validar(paso);
    setError(problema);
    if (!problema) setPaso((p) => p + 1);
  }

  async function crear() {
    setError(null);
    setEnCurso(true);
    const datos: DatosAlta = {
      nombre: nombre.trim(),
      sucursales: sucursales.map((s) => ({ nombre: s.nombre.trim(), zonaHoraria: s.zonaHoraria })),
      ...(conAdmin
        ? {
            administrador: {
              nombre: admin.nombre.trim(),
              email: admin.email.trim(),
              password: admin.password,
            },
          }
        : {}),
    };
    try {
      const resultado = await api.altaGuiada(datos);
      setHecha(resultado);
      setPaso(4);
      await Promise.all(
        ['empresas', 'sucursales'].map((c) => cliente.invalidateQueries({ queryKey: [c] })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la empresa.');
    } finally {
      setEnCurso(false);
    }
  }

  function terminar() {
    if (!hecha) return;
    navigate({ pathname: '/', search: `?${PARAM_EMPRESA}=${hecha.empresa.id}` });
  }

  const zonas = zonasDisponibles();
  const idError = `${idBase}-error`;

  let contenido: ReactNode;
  if (paso === 0) {
    contenido = (
      <Campo etiqueta="Nombre de la empresa (como la conoce el cliente)">
        <input
          className={CLASE_INPUT}
          value={nombre}
          maxLength={NOMBRE_MAX}
          autoFocus
          onChange={(e) => setNombre(e.target.value)}
        />
      </Campo>
    );
  } else if (paso === 1) {
    contenido = (
      <div className="space-y-3">
        <p className="text-sm text-tinta-tenue">
          Una fila por restaurante. La zona horaria es la que corta el "hoy" de cada sucursal.
        </p>
        {sucursales.map((s, i) => (
          <fieldset
            key={s.clave}
            className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          >
            <legend className="sr-only">Sucursal {i + 1}</legend>
            <Campo etiqueta={`Sucursal ${i + 1}`}>
              <input
                className={CLASE_INPUT}
                value={s.nombre}
                maxLength={NOMBRE_MAX}
                onChange={(e) =>
                  setSucursales((lista) =>
                    lista.map((x) => (x.clave === s.clave ? { ...x, nombre: e.target.value } : x)),
                  )
                }
              />
            </Campo>
            <Campo etiqueta={`Zona horaria de la sucursal ${i + 1}`}>
              <select
                className={CLASE_INPUT}
                value={s.zonaHoraria}
                onChange={(e) =>
                  setSucursales((lista) =>
                    lista.map((x) =>
                      x.clave === s.clave ? { ...x, zonaHoraria: e.target.value } : x,
                    ),
                  )
                }
              >
                {zonas.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </Campo>
            <button
              type="button"
              className={CLASE_BOTON}
              disabled={sucursales.length === 1}
              aria-label={`Quitar la sucursal ${i + 1}`}
              onClick={() => setSucursales((lista) => lista.filter((x) => x.clave !== s.clave))}
            >
              Quitar
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className={CLASE_BOTON}
          disabled={sucursales.length >= SUCURSALES_MAX}
          onClick={() => {
            setSucursales((lista) => [
              ...lista,
              {
                clave: siguiente,
                nombre: '',
                zonaHoraria: lista.at(-1)?.zonaHoraria ?? ZONA_POR_DEFECTO,
              },
            ]);
            setSiguiente((n) => n + 1);
          }}
        >
          Agregar otra sucursal
        </button>
        {sucursales.length >= SUCURSALES_MAX && (
          <p className="text-sm text-tinta-tenue">
            Hasta {SUCURSALES_MAX} por alta; las demás se agregan después en Sucursales.
          </p>
        )}
      </div>
    );
  } else if (paso === 2) {
    contenido = (
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={conAdmin}
            onChange={(e) => setConAdmin(e.target.checked)}
          />
          Crear ahora al administrador de la empresa
        </label>
        {conAdmin ? (
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo etiqueta="Nombre del administrador">
              <input
                className={CLASE_INPUT}
                value={admin.nombre}
                maxLength={NOMBRE_MAX}
                onChange={(e) => setAdmin((a) => ({ ...a, nombre: e.target.value }))}
              />
            </Campo>
            <Campo etiqueta="Email del administrador">
              <input
                className={CLASE_INPUT}
                type="email"
                value={admin.email}
                onChange={(e) => setAdmin((a) => ({ ...a, email: e.target.value }))}
              />
            </Campo>
            <Campo etiqueta="Contraseña inicial">
              <input
                className={`${CLASE_INPUT} font-mono`}
                value={admin.password}
                onChange={(e) => setAdmin((a) => ({ ...a, password: e.target.value }))}
              />
            </Campo>
            <div className="flex items-end">
              <button
                type="button"
                className={CLASE_BOTON}
                onClick={() => setAdmin((a) => ({ ...a, password: generarPassword() }))}
              >
                Generar otra
              </button>
            </div>
            <p className="text-sm text-tinta-tenue sm:col-span-2">
              Dásela en persona. Puede cambiarla en Mi cuenta en cuanto entre.
            </p>
          </div>
        ) : (
          <p className="text-sm text-tinta-tenue">
            Sin administrador, sólo tú podrás administrar la empresa hasta que lo crees en Usuarios.
            La lista de arranque lo seguirá marcando como pendiente.
          </p>
        )}
      </div>
    );
  } else if (paso === 3) {
    contenido = (
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-tinta-suave">Empresa</dt>
        <dd className="break-words font-medium">{nombre.trim()}</dd>
        <dt className="text-tinta-suave">Sucursales</dt>
        <dd>
          <ul>
            {sucursales.map((s) => (
              <li key={s.clave} className="break-words">
                {s.nombre.trim()} · <span className="text-tinta-tenue">{s.zonaHoraria}</span>
              </li>
            ))}
          </ul>
        </dd>
        <dt className="text-tinta-suave">Administrador</dt>
        <dd className="break-words">
          {conAdmin
            ? `${admin.nombre.trim()} · ${admin.email.trim()}`
            : 'Sin administrador por ahora'}
        </dd>
        <dd className="text-tinta-tenue sm:col-span-2">
          Al crear se genera la API key de cada sucursal. Se muestran una sola vez, en el siguiente
          paso.
        </dd>
      </dl>
    );
  } else if (hecha) {
    contenido = (
      <div className="space-y-5">
        <p role="status" className="text-sm font-medium">
          {hecha.empresa.nombre} quedó dada de alta con {hecha.sucursales.length}{' '}
          {hecha.sucursales.length === 1 ? 'sucursal' : 'sucursales'}.
        </p>
        <section aria-label="API keys" className="space-y-2">
          <h2 className="text-base font-semibold">API key de cada sucursal</h2>
          <p className="text-sm font-medium text-aviso">
            Cópialas ahora: no se vuelven a mostrar. Si una se pierde, se genera otra en Sucursales.
            No las mandes por WhatsApp ni por correo.
          </p>
          <ul className="space-y-2">
            {hecha.sucursales.map((s) => (
              <li
                key={s.id}
                className="grid min-w-0 grid-cols-1 gap-1 sm:grid-cols-[10rem_1fr_auto] sm:items-center"
              >
                <span className="break-words text-sm font-medium">{s.nombre}</span>
                <input
                  readOnly
                  aria-label={`API key de ${s.nombre}`}
                  value={s.apiKey}
                  onFocus={(e) => e.currentTarget.select()}
                  className={`${CLASE_INPUT} font-mono`}
                />
                <Copiar texto={s.apiKey} etiqueta={`Copiar la API key de ${s.nombre}`} />
              </li>
            ))}
          </ul>
        </section>
        {hecha.administrador && (
          <section aria-label="Acceso del administrador" className="space-y-1 text-sm">
            <h2 className="text-base font-semibold">Acceso del administrador</h2>
            <p>
              {hecha.administrador.email} · contraseña inicial{' '}
              <code className="break-all">{admin.password}</code>{' '}
              <Copiar texto={admin.password} etiqueta="Copiar la contraseña inicial" />
            </p>
          </section>
        )}
        <section aria-label="Instalar el agente" className="space-y-1 text-sm">
          <h2 className="text-base font-semibold">Siguiente: instalar el agente</h2>
          <p>
            En la PC del SQL Server de cada sucursal, con su API key.{' '}
            <Link className="text-acento-texto underline" to="/ayuda/agente" target="_blank">
              Abrir la guía de instalación
            </Link>
          </p>
        </section>
        <ChecklistArranque empresaId={hecha.empresa.id} />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={copiadas}
              onChange={(e) => setCopiadas(e.target.checked)}
            />
            Ya copié las API keys{hecha.administrador ? ' y la contraseña' : ''}
          </label>
          <button type="button" className={CLASE_PRIMARIO} disabled={!copiadas} onClick={terminar}>
            Terminar e ir al panel de la empresa
          </button>
        </div>
      </div>
    );
  }

  return (
    <Vista titulo="Alta guiada de empresa">
      <ol aria-label="Pasos del alta" className="mb-5 flex flex-wrap gap-2 text-sm">
        {PASOS.map((p, i) => (
          <li
            key={p}
            aria-current={i === paso ? 'step' : undefined}
            className={`rounded-full px-3 py-1 ${
              i === paso
                ? 'bg-acento text-sobre-acento'
                : i < paso
                  ? 'bg-realce text-tinta-medio'
                  : 'text-tinta-tenue'
            }`}
          >
            {i + 1}. {p}
          </li>
        ))}
      </ol>
      <form
        onSubmit={paso < 3 ? avanzar : (e) => e.preventDefault()}
        className="max-w-3xl space-y-4 rounded-lg border border-linea bg-superficie p-4"
        aria-describedby={error ? idError : undefined}
        noValidate
      >
        {contenido}
        {error && (
          <p id={idError} role="alert" className="text-sm text-peligro">
            {error}
          </p>
        )}
        {paso < 4 && (
          <div className="flex flex-wrap justify-between gap-2">
            {paso === 0 ? (
              <Link className={CLASE_BOTON} to={{ pathname: '/admin', search: '?tab=empresas' }}>
                Cancelar
              </Link>
            ) : (
              <button
                type="button"
                className={CLASE_BOTON}
                disabled={enCurso}
                onClick={() => {
                  setError(null);
                  setPaso((p) => p - 1);
                }}
              >
                Atrás
              </button>
            )}
            {paso < 3 ? (
              <button type="submit" className={CLASE_PRIMARIO}>
                Siguiente
              </button>
            ) : (
              <button
                type="button"
                className={CLASE_PRIMARIO}
                disabled={enCurso}
                onClick={() => void crear()}
              >
                {enCurso ? 'Creando…' : 'Crear empresa y generar keys'}
              </button>
            )}
          </div>
        )}
      </form>
    </Vista>
  );
}
