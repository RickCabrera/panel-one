import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Reloj } from '../../comun/reloj';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  Adjunto,
  Destinatario,
  OpcionesCorreo,
  PlantillaCorreo,
  PuertoCorreo,
} from './puerto';

/**
 * La bandeja de `correos_enviados`: el cliente crudo, reducido a esa tabla. Es el
 * único punto por donde el módulo de adaptadores llega a Prisma, y existe para que
 * `PrismaService` se importe SÓLO en este archivo (allowlist de eslint).
 */
export type BandejaCorreoFalso = Pick<PrismaService, 'correoEnviado'>;
export const BANDEJA_CORREO_FALSO = Symbol('BANDEJA_CORREO_FALSO');
export const PROVEEDOR_BANDEJA_CORREO_FALSO = {
  provide: BANDEJA_CORREO_FALSO,
  useExisting: PrismaService,
};

/** Equivalente de `/tmp/correos/` que también existe en Windows. */
export const DIRECTORIO_CORREO_FALSO = join(tmpdir(), 'correos');

export interface MetadatoAdjunto {
  nombre: string;
  tipo: string;
  bytes: number;
  sha256: string;
}

/** Nombre de archivo seguro para el disco: sin rutas ni caracteres raros. */
function nombreSeguro(nombre: string, indice: number): string {
  const limpio = nombre.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return `${indice}-${limpio || 'adjunto'}`;
}

/**
 * Correo FALSO (F2-202): no sale nada a la red. Cada `enviar()` deja
 * `<directorio>/<id>/correo.json` (destinatario, plantilla completa y metadatos de
 * adjuntos) con los adjuntos al lado, y una fila en `correos_enviados`, para que los
 * tests y el modo demo vean qué se habría mandado.
 *
 * Usa el cliente crudo de Prisma (está en la allowlist de `eslint.config.mjs`): sólo
 * hace INSERT en su propia bandeja, sin lecturas ni datos de negocio.
 */
export class CorreoFalso implements PuertoCorreo {
  constructor(
    private readonly prisma: BandejaCorreoFalso,
    private readonly reloj: Pick<Reloj, 'ahora'>,
    private readonly directorio: string = DIRECTORIO_CORREO_FALSO,
  ) {}

  async enviar(
    destinatario: Destinatario,
    plantilla: PlantillaCorreo,
    adjuntos: Adjunto[],
    opciones: OpcionesCorreo = {},
  ): Promise<{ id: string }> {
    const id = randomUUID();
    const enviadoAt = new Date(this.reloj.ahora());
    const metadatos: MetadatoAdjunto[] = adjuntos.map((a) => ({
      nombre: a.nombre,
      tipo: a.tipo,
      bytes: a.contenido.length,
      sha256: createHash('sha256').update(a.contenido).digest('hex'),
    }));

    const carpeta = join(this.directorio, id);
    await mkdir(carpeta, { recursive: true });
    await Promise.all(
      adjuntos.map((a, i) => writeFile(join(carpeta, nombreSeguro(a.nombre, i)), a.contenido)),
    );
    await writeFile(
      join(carpeta, 'correo.json'),
      JSON.stringify(
        {
          id,
          enviadoAt: enviadoAt.toISOString(),
          empresaId: opciones.empresaId ?? null,
          destinatario,
          plantilla,
          adjuntos: metadatos,
        },
        null,
        2,
      ),
      'utf8',
    );

    await this.prisma.correoEnviado.create({
      data: {
        id,
        empresaId: opciones.empresaId ?? null,
        destinatario: destinatario.email,
        plantilla: plantilla.nombre,
        asunto: plantilla.asunto,
        adjuntos: metadatos as unknown as object[],
        enviadoAt,
      },
    });
    return { id };
  }
}
