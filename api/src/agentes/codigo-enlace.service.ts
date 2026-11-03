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
  claveIp,
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

/** Token de los límites de fallos del canje (los e2e los bajan para probarlos). */
export const LIMITES_ENLACE = Symbol('LIMITES_ENLACE');

export interface LimitesEnlace {
  /** Códigos equivocados por IP (IPv6: por /64) antes de bloquearla el resto de la ventana. */
  fallosPorIp: number;
  /**
   * Cortacircuito GLOBAL: códigos equivocados de TODAS las IPs juntas en la ventana. Pasado el
   * tope, el canje responde 429 a todos (también a un código bueno) hasta que la ventana pase.
   * Es lo que frena a una botnet que reparte los intentos entre miles de IPs. Un instalador
   * legítimo lo nota sólo en un ataque, y el mensaje le dice que espere.
   */
  fallosGlobales: number;
  ventanaMs: number;
}

export const LIMITES_ENLACE_POR_DEFECTO: LimitesEnlace = {
  fallosPorIp: 10,
  fallosGlobales: 100,
  ventanaMs: 60 * 60 * 1000,
};

/** Tope de IPs recordadas: con más, se tiran las ventanas ya vencidas. */
const MAX_IPS_RECORDADAS = 10_000;

export const MENSAJE_ENLACE_INVALIDO =
  'El código no sirve: está mal escrito, ya se usó o ya venció. Genera uno nuevo en el panel ' +
  '(Administración › Sucursales › Conectar sucursal).';

export const MENSAJE_IP_BLOQUEADA =
  'Demasiados códigos equivocados desde esta red. Espera una hora o llama a soporte.';

export const MENSAJE_CORTACIRCUITO =
  'El panel está recibiendo demasiados códigos equivocados y pausó la conexión de sucursales por ' +
  'seguridad. Intenta en un rato; si urge, llama a soporte.';

interface Ventana {
  cuenta: number;
  desde: number;
}

/**
 * Cuántos códigos EQUIVOCADOS llegan, por IP (IPv6 agrupada por /64, `claveIp`) y en total. El
 * throttler de la librería cuenta todo intento; éste sólo los que no sirvieron, que son los que
 * importan para adivinar. En memoria, por proceso, igual que el throttler.
 */
@Injectable()
export class LimiteFallosEnlace {
  private readonly logger = new Logger('CodigoEnlace');
  readonly #porIp = new Map<string, Ventana>();
  #global: Ventana | null = null;
  #avisado = false;

  constructor(
    private readonly reloj: Reloj,
    @Inject(LIMITES_ENLACE) private readonly limites: LimitesEnlace,
  ) {}

  /** `null` si puede intentar; si no, el motivo (el mensaje del 429). */
  bloqueo(ip: string): string | null {
    const global = this.#vigente(this.#global);
    if (global && global.cuenta >= this.limites.fallosGlobales) return MENSAJE_CORTACIRCUITO;
    const v = this.#vigente(this.#porIp.get(claveIp(ip)) ?? null);
    if (v && v.cuenta >= this.limites.fallosPorIp) return MENSAJE_IP_BLOQUEADA;
    return null;
  }

  registrarFallo(ip: string): void {
    const ahora = this.reloj.ahora();
    const clave = claveIp(ip);
    const v = this.#vigente(this.#porIp.get(clave) ?? null);
    if (v) v.cuenta += 1;
    else {
      if (this.#porIp.size >= MAX_IPS_RECORDADAS) this.#purgar();
      this.#porIp.set(clave, { cuenta: 1, desde: ahora });
    }

    const g = this.#vigente(this.#global);
    if (g) g.cuenta += 1;
    else {
      this.#global = { cuenta: 1, desde: ahora };
      this.#avisado = false;
    }
    const total = this.#global!.cuenta;
    if (total >= this.limites.fallosGlobales && !this.#avisado) {
      this.#avisado = true;
      // Una sola línea por ventana, en nivel ERROR, para el admin_global (logs / monitoreo). No
      // hay alerta en el panel: el centro de alertas es por empresa y sucursal, y esto no es de
      // ninguna. Sin códigos ni IPs completas.
      this.logger.error(
        JSON.stringify({
          accion: 'enlace.cortacircuito',
          fallos: total,
          ventanaMinutos: Math.round(this.limites.ventanaMs / 60_000),
          mensaje: 'Demasiados códigos de enlace equivocados: canje pausado para todos.',
        }),
      );
    }
  }

  #vigente(v: Ventana | null): Ventana | null {
    if (!v) return null;
    return this.reloj.ahora() - v.desde >= this.limites.ventanaMs ? null : v;
  }

  #purgar(): void {
    for (const [ip, v] of this.#porIp) {
      if (!this.#vigente(v)) this.#porIp.delete(ip);
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
   * cuenta como fallo). Con los fallos de la IP o los globales agotados (`LimitesEnlace`), 429
   * aunque el código sea bueno.
   */
  async canjear(texto: string, ip: string): Promise<EnlaceCanjeadoDto> {
    const bloqueo = this.fallos.bloqueo(ip);
    if (bloqueo) throw new HttpException(bloqueo, HttpStatus.TOO_MANY_REQUESTS);
    const codigo = normalizarCodigoEnlace(texto);
    if (!esCodigoEnlaceValido(codigo)) {
      throw new BadRequestException(
        'El código tiene 8 letras y números, como K7P4-42XQ (sin O, 0, I ni 1).',
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
