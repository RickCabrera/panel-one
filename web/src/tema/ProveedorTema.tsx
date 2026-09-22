import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useAuth } from '../auth/contexto';
import { ACENTO_DESPLIEGUE, derivarAcento } from './acento';
import { TemaContexto, type ContextoTema } from './contexto';
import { PALETA } from './paleta';
import {
  aplicarTema,
  escucharSistema,
  guardarPreferencia,
  leerPreferencia,
  resolverTema,
  sistemaOscuro,
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

  const [oscuro, setOscuro] = useState(sistemaOscuro);
  // Con "sistema", cambiar el tema del sistema operativo se ve sin recargar.
  useEffect(() => escucharSistema(setOscuro), []);

  const tema = resolverTema(preferencia, oscuro);
  useEffect(() => aplicarTema(tema, acento), [tema, acento]);

  const elegir = useCallback(
    (nueva: PreferenciaTema) => {
      guardarPreferencia(nueva, usuarioId);
      setElegida({ de: usuarioId, preferencia: nueva });
    },
    [usuarioId],
  );

  const valor = useMemo<ContextoTema>(
    () => ({
      preferencia,
      tema,
      elegir,
      colores: { ...PALETA[tema], ...derivarAcento(acento, tema) },
    }),
    [preferencia, tema, elegir, acento],
  );

  return <TemaContexto.Provider value={valor}>{children}</TemaContexto.Provider>;
}
