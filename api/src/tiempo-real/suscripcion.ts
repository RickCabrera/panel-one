import { plainToInstance } from 'class-transformer';
import { IsOptional, IsUUID, validate } from 'class-validator';

/** El mensaje `suscribir` del socket: el mismo alcance que `GET /mesas/abiertas`. */
export class SuscribirDto {
  @IsUUID()
  empresaId!: string;

  @IsOptional()
  @IsUUID()
  sucursalId?: string;
}

/** La respuesta (ack) de `suscribir`. "No encontrado" es el 404: mismo texto para todo. */
export type RespuestaSuscripcion =
  { ok: true } | { ok: false; error: 'Parámetros inválidos' | 'No encontrado' | 'Reemplazada' };

/**
 * Valida el cuerpo de `suscribir` como lo haría el `ValidationPipe` global de HTTP (que no
 * aplica a los sockets): sólo esas dos llaves, UUIDs. Devuelve null si no pasa.
 */
export async function leerSuscripcion(cuerpo: unknown): Promise<SuscribirDto | null> {
  if (cuerpo === null || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return null;
  const dto = plainToInstance(SuscribirDto, cuerpo);
  const errores = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  });
  return errores.length === 0 ? dto : null;
}

/** La sala de socket.io de un alcance. Con sucursal, sólo esa; sin ella, toda la empresa. */
export function salaDe(empresaId: string, sucursalId?: string): string {
  return sucursalId === undefined ? `empresa:${empresaId}` : `sucursal:${sucursalId}`;
}
