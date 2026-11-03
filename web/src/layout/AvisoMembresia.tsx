import { useUsuario } from '../auth/contexto';
import { useMembresiaPropia } from '../paginas/plataforma/consultas';
import { fechaDia } from '../paginas/plataforma/formato';

/**
 * Membresías: con la suscripción VENCIDA (vencimiento + gracia ya pasó) la empresa sigue
 * entrando, pero el panel lo avisa arriba, a todos sus usuarios. Nada se corta solo: suspender
 * lo hace la plataforma a mano. Si `/cuenta/membresia` falla, no hay aviso (no inventa).
 */
export function AvisoMembresia() {
  const usuario = useUsuario();
  const membresia = useMembresiaPropia(usuario.empresaId !== null);
  const m = membresia.data;
  if (!m || m.estado !== 'vencida') return null;
  return (
    <div
      role="status"
      data-testid="aviso-membresia"
      className="print:hidden border-b border-aviso-borde bg-aviso-fondo px-4 py-2 text-sm text-aviso"
    >
      <strong>Pago pendiente.</strong> Tu membresía venció el {fechaDia(m.vencimiento)}. Para seguir
      usando el sistema sin interrupciones, contacta a soporte para registrar tu pago.
    </div>
  );
}
