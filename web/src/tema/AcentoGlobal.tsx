import { useEffect, type ReactNode } from 'react';

import { useSistema } from '../sistema/sistema';
import { acentoEfectivo, esColorAcento, guardarAcentoVisto, leerAcentoGuardado } from './acento';
import { ProveedorTema } from './ProveedorTema';

/**
 * Membresías: el tema con el color de interfaz GLOBAL de la plataforma, leído de `GET /sistema`
 * (público, antes del login). Mientras no contesta, el último que vio este navegador; si nunca
 * vio uno (o la API no lo manda), el del build. Cambiarlo en Plataforma › Ajustes se ve aquí en
 * cuanto se relee `/sistema`; las pestañas abiertas en otros equipos lo toman al recargar.
 */
export function TemaConAcentoGlobal({ children }: { children: ReactNode }) {
  const { data, isSuccess } = useSistema();
  const clave = isSuccess ? (esColorAcento(data.colorAcento) ? data.colorAcento : null) : undefined;

  useEffect(() => {
    if (clave !== undefined) guardarAcentoVisto(clave);
  }, [clave]);

  const acento = acentoEfectivo(clave === undefined ? leerAcentoGuardado() : clave);
  return <ProveedorTema acento={acento}>{children}</ProveedorTema>;
}
