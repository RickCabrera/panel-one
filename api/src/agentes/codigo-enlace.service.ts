import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { Reloj } from '../comun/reloj';
import type { EmpresaScope } from '../scope/empresa-scope';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { generarApiKey, hashApiKey } from './api-key';
import {
  esCodigoEnlaceValido,
  formatearCodigoEnlace,
  generarCodigoEnlace,
  hashCodigoEnlace,
  normalizarCodigoEnlace,
  VIGENCIA_ENLACE_MS,
} from './codigo-enlace';
import type { CodigoEnlaceEmitidoDto, EnlaceCanjeadoDto } from './dto/enlace.dto';

/** Token de la URL pública de la API (`API_URL_PUBLICA`, opcional). */
export const URL_PUBLICA_API = Symbol('URL_PUBLICA_API');

/** Fallos de canje por IP antes de bloquearla, y por cuánto. */
export const FALLOS_ENLACE_POR_IP = 10;
export const VENTANA_FALLOS_ENLACE_MS = 60 * 60 * 1000;
/** Tope de IPs recordadas: con más, se tiran las ventanas ya vencidas. */
const MAX_IPS_RECORDADAS = 10_000;

export const MENSAJE_ENLACE_INVALIDO =
  'El código no sirve: está mal escrito, ya se usó o ya venció. Genera uno nuevo en el panel ' +
  '(Administración › Sucursales › Conectar sucursal).';

/**
 * Cuántos códigos EQUIVOCADOS ha mandado cada IP en la última hora. El throttler de la librería
 * cuenta todo intento; éste sólo los que no sirvieron, que son los que importan para adivinar.
 * En memoria, por proceso, igual que el throttler.
 */
@Injectable()
export class LimiteFallosEnlace {
  readonly #fallos = new Map<string, { cuenta: number; desde: number }>();

  constructor(private readonly reloj: Reloj) {}

  bloqueada(ip: string): boolean {
    const v = this.#vigente(ip);
    return v !== null && v.cuenta >= FALLOS_ENLACE_POR_IP;
  }

  registrarFallo(ip: string): void {
    const v = this.#vigente(ip);
    if (v) {
      v.cuenta += 1;
      return;
    }
    if (this.#fallos.size >= MAX_IPS_RECORDADAS) this.#purgar();
    this.#fallos.set(ip, { cuenta: 1, desde: this.reloj.ahora() });
  }

  #vigente(ip: string): { cuenta: number; desde: number } | null {
    const v = this.#fallos.get(ip);
    if (!v) return null;
    if (this.reloj.ahora() - v.desde >= VENTANA_FALLOS_ENLACE_MS) {
      this.#fallos.delete(ip);
      return null;
    }
    return v;
  }

  #purgar(): void {
    const ahora = this.reloj.ahora();
    for (const [ip, v] of this.#fallos) {
      if (ahora - v.desde >= VENTANA_FALLOS_ENLACE_MS) this.#fallos.delete(ip);
    }
  }
}

/**
 * El instalador de un clic: el admin genera un código corto en Sucursales y el instalador lo
 * cambia por la API key de esa sucursal. La key nunca se copia a mano.
 */
@Injectable()
export class CodigoEnlaceService {
  private readonly logger = new Logger('CodigoEnlace');

  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
    private readonly fallos: LimiteFallosEnlace,
    @Inject(URL_PUBLICA_API) private readonly urlPublica: string | null,
  ) {}

  /** Emite el código de una sucursal del alcance (fuera de él, 404). Borra el pendiente anterior. */
  async emitir(
    scope: EmpresaScope,
    sucursalId: string,
    creadoPor: string,
  ): Promise<CodigoEnlaceEmitidoDto & { empresaId: string }> {
    const ahora = new Date(this.reloj.ahora());
    const emitido = await this.datos.enlaces(scope).emitir({
      sucursalId,
      creadoPor,
      ahora,
      expiraAt: new Date(ahora.getTime() + VIGENCIA_ENLACE_MS),
      generar: () => {
        const codigo = generarCodigoEnlace();
        return { codigo, hash: hashCodigoEnlace(codigo) };
      },
    });
    return {
      sucursalId: emitido.sucursalId,
      empresaId: emitido.empresaId,
      codigo: formatearCodigoEnlace(emitido.codigo),
      expiraAt: emitido.expiraAt.toISOString(),
      vigenciaSegundos: VIGENCIA_ENLACE_MS / 1000,
    };
  }

  /**
   * Cambia el código por una key NUEVA de su sucursal (la anterior deja de servir). Cualquier
   * motivo de rechazo da el MISMO 404; un código mal formado, 400 (no se busca en la base ni
   * cuenta como fallo). Con `FALLOS_ENLACE_POR_IP` fallos en la hora, 429 aunque el código sea
   * bueno.
   */
  async canjear(texto: string, ip: string): Promise<EnlaceCanjeadoDto> {
    if (this.fallos.bloqueada(ip)) {
      throw new HttpException(
        'Demasiados códigos equivocados desde esta red. Espera una hora o llama a soporte.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const codigo = normalizarCodigoEnlace(texto);
    if (!esCodigoEnlaceValido(codigo)) {
      throw new BadRequestException(
        'El código tiene 6 letras y números, como K7P-42X (sin O, 0, I ni 1).',
      );
    }

    const apiKey = generarApiKey();
    const canjeado = await this.datos
      .canjeEnlace()
      .canjear(hashCodigoEnlace(codigo), hashApiKey(apiKey), new Date(this.reloj.ahora()));
    if (!canjeado) {
      this.fallos.registrarFallo(ip);
      throw new NotFoundException(MENSAJE_ENLACE_INVALIDO);
    }

    // Auditoría (sin código ni key): la key de la sucursal se rotó por un canje.
    this.logger.log(
      JSON.stringify({
        accion: 'sucursal.enlace_canjeado',
        recurso: 'sucursal',
        recursoId: canjeado.sucursalId,
        empresaId: canjeado.empresaId,
      }),
    );
    return {
      sucursalId: canjeado.sucursalId,
      sucursal: canjeado.sucursalNombre,
      apiKey,
      apiUrl: this.urlPublica,
    };
  }
}
