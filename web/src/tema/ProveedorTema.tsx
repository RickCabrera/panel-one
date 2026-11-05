import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useAuth } from '../auth/contexto';
import { ACENTO_DESPLIEGUE } from './acento';
import { TemaContexto, type ContextoTema } from './contexto';
import type { Estilo } from './paleta';
import {
  aplicarTema,
  coloresDe,
  escucharSistema,
  guardarEstilo,
  guardarPreferencia,
  leerEstilo,
  leerPreferencia,
  resolverTema,
  sistemaOscuro,
  zonaOscura,
  type PreferenciaTema,
} from './tema';

/**
 * Tema de la app (F2-211). Va DENTRO de `AuthProvider`: al entrar alguien se carga su
 * preferencia; al salir se queda la última de este navegador (el login la respeta).
 */
export function ProveedorTema({
  children,
  acento = ACENTO_DESPLIEGUE,
}: {
  children: ReactNode;
  acento?: string;
}) {
  const { auth } = useAuth();
  const usuarioId = auth.estado === 'autenticado' ? auth.usuario.id : undefined;
  // La preferencia se guarda POR usuario: cambia de dueño cuando cambia la sesión.
  const [elegida, setElegida] = useState<{ de: string | undefined; preferencia: PreferenciaTema }>(
    () => ({ de: usuarioId, preferencia: leerPreferencia(usuarioId) }),
  );
  const preferencia = elegida.de === usuarioId ? elegida.preferencia : leerPreferencia(usuarioId);
  if (elegida.de !== usuarioId) setElegida({ de: usuarioId, preferencia });

  // UI-06: el estilo de la marca sigue la misma regla (por usuario, y el último del navegador).
  const [estiloElegido, setEstiloElegido] = useState<{ de: string | undefined; estilo: Estilo }>(
    () => ({ de: usuarioId, estilo: leerEstilo(usuarioId) }),
  );
  const estilo = estiloElegido.de === usuarioId ? estiloElegido.estilo : leerEstilo(usuarioId);
  if (estiloElegido.de !== usuarioId) setEstiloElegido({ de: usuarioId, estilo });

  const [oscuro, setOscuro] = useState(sistemaOscuro);
  // Con "sistema", cambiar el tema del sistema operativo se ve sin recargar.
  useEffect(() => escucharSistema(setOscuro), []);

  const tema = resolverTema(preferencia, oscuro);
  useEffect(
    () => aplicarTema(tema, acento, document.documentElement, estilo),
    [tema, acento, estilo],
  );

  const elegir = useCallback(
    (nueva: PreferenciaTema) => {
      guardarPreferencia(nueva, usuarioId);
      setElegida({ de: usuarioId, preferencia: nueva });
    },
    [usuarioId],
  );

  const elegirEstilo = useCallback(
    (nuevo: Estilo) => {
      guardarEstilo(nuevo, usuarioId);
      setEstiloElegido({ de: usuarioId, estilo: nuevo });
    },
    [usuarioId],
  );

  const valor = useMemo<ContextoTema>(
    () => ({
      preferencia,
      tema,
      elegir,
      estilo,
      elegirEstilo,
      colores: coloresDe(tema, acento, estilo),
      zonaOscura: zonaOscura(tema, acento, estilo),
    }),
    [preferencia, tema, elegir, estilo, elegirEstilo, acento],
  );

  return <TemaContexto.Provider value={valor}>{children}</TemaContexto.Provider>;
}
