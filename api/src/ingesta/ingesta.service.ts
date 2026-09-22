import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';

import type { AgenteAutenticado } from '../auth/request-autenticado';
import { Reloj } from '../comun/reloj';
import type {
  DatosCheque,
  DatosEstado,
  DatosPago,
  DatosPartida,
  EscrituraSucursal,
} from '../scope/escritura-sucursal';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { chequeCanonico } from './canonico';
import {
  CabeceraEventoDto,
  DatosChequeDto,
  DatosHeartbeatDto,
  DatosSnapshotDto,
  type RechazoDto,
  type ResultadoIngestaDto,
} from './dto/ingesta.dto';
import { cantidad, derivarFormaPago, dinero, fechaUtc } from './normalizar';

type EventoNormalizado =
  | {
      tipo: 'cheque';
      folioSr: string;
      datos: DatosCheque;
      partidas: DatosPartida[];
      pagos: DatosPago[];
    }
  | { tipo: 'snapshot'; capturadoAt: Date; payload: Prisma.InputJsonValue }
  | { tipo: 'heartbeat'; estado: DatosEstado };

type Resultado<T> = { ok: true; valor: T } | { ok: false; motivo: string };

/** Un importe que al redondear ya no cabe en NUMERIC(12,2): el evento no se puede guardar nunca. */
class FueraDeRango extends Error {}

/**
 * Códigos de Prisma que son fallas TRANSITORIAS: reenviar más tarde puede
 * funcionar. Todo lo demás (desbordamiento, CHECK, FK, un bug nuestro) es
 * determinista y se rechaza con `reintentable: false`, para que el agente no
 * lo reenvíe en bucle.
 * - P1001/P1002/P1008/P1017: base inalcanzable, timeout, conexión cerrada.
 * - P2024: sin conexiones libres en el pool.
 * - P2028: la transacción interactiva expiró o se cerró.
 * - P2034: conflicto de escritura / deadlock.
 * - P2002: choque de unique. Pasa con dos lotes en vuelo creando el mismo
 *   cheque o snapshot: al reenviarlo, el upsert encuentra la fila y actualiza.
 */
const CODIGOS_TRANSITORIOS: ReadonlySet<string> = new Set([
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2002',
  'P2024',
  'P2028',
  'P2034',
]);

export function esTransitorio(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return CODIGOS_TRANSITORIOS.has(err.code);
  }
  return (
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError
  );
}

/**
 * La ingesta del agente (F1-031). Un lote se procesa en orden, UNA transacción
 * por evento: el que es inválido o falla se rechaza solo y los demás se
 * guardan. Todo va por `ScopedPrismaService.deSucursal(agente)`: la sucursal y
 * la empresa salen de la API key, nunca del payload.
 *
 * Idempotencia: reenviar un evento ya guardado deja la base EXACTAMENTE igual
 * (ni ids de partidas, ni `updated_at`): si lo que llega es idéntico a lo que
 * hay, no se escribe. Si cambió, el cheque se reemplaza por completo.
 *
 * Contacto (F1-061): todo lote cuyo sobre pasó la validación registra "el
 * agente nos habló ahora" (reloj del servidor) en `agente_contacto`, aunque
 * todos sus eventos salgan rechazados: el agente está vivo. Ese registro NO es
 * dato de la ingesta y queda fuera de la idempotencia A PROPÓSITO: un reenvío
 * lo mueve, porque el agente sí nos volvió a hablar. Los datos (cheques,
 * partidas, pagos, snapshots, `agente_estado`) siguen idénticos.
 */
@Injectable()
export class IngestaService {
  private readonly log = new Logger(IngestaService.name);

  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
  ) {}

  async procesarLote(
    agente: AgenteAutenticado,
    eventos: readonly unknown[],
  ): Promise<ResultadoIngestaDto> {
    const escritura = this.datos.deSucursal(agente);
    const procesados: string[] = [];
    const rechazados: RechazoDto[] = [];

    await this.registrarContacto(escritura, agente);
    for (const [indice, evento] of eventos.entries()) {
      const id = idDe(evento);
      const normalizado = await validarYNormalizar(evento);
      if (!normalizado.ok) {
        rechazados.push({ id, indice, motivo: normalizado.motivo, reintentable: false });
        continue;
      }
      try {
        await this.aplicar(escritura, normalizado.valor);
        // La cabecera validada ya exigió un id de 1..64 caracteres.
        procesados.push(id as string);
      } catch (err) {
        const reintentable = esTransitorio(err);
        this.log.error(
          `Evento ${indice} (${normalizado.valor.tipo}) de la sucursal ${agente.sucursalId} ` +
            `no se guardó (reintentable=${reintentable}): ${describir(err)}`,
        );
        rechazados.push({
          id,
          indice,
          reintentable,
          motivo: reintentable
            ? 'Falla transitoria al guardar el evento; reenviarlo más tarde.'
            : 'El evento no se pudo guardar y reenviarlo va a fallar igual.',
        });
      }
    }
    return { procesados, rechazados };
  }

  /**
   * Si falla, se loguea y el lote sigue: los datos importan más que la marca de
   * conexión, y el siguiente lote la vuelve a intentar.
   */
  private async registrarContacto(
    escritura: EscrituraSucursal,
    agente: AgenteAutenticado,
  ): Promise<void> {
    try {
      const ahora = new Date(this.reloj.ahora());
      await escritura.enTransaccion((ops) => ops.registrarContacto(ahora));
    } catch (err) {
      this.log.error(
        `No se registró el contacto del agente de la sucursal ${agente.sucursalId}: ${describir(err)}`,
      );
    }
  }

  private aplicar(escritura: EscrituraSucursal, evento: EventoNormalizado): Promise<void> {
    switch (evento.tipo) {
      case 'cheque':
        return escritura.enTransaccion(async (ops) => {
          const guardado = await ops.leerCheque(evento.folioSr);
          const entrante = { ...evento.datos, partidas: evento.partidas, pagos: evento.pagos };
          if (guardado && chequeCanonico(guardado) === chequeCanonico(entrante)) {
            return; // reenvío idéntico: no se toca nada
          }
          await ops.guardarCheque(evento.folioSr, evento.datos, evento.partidas, evento.pagos);
        });
      case 'snapshot':
        return escritura.enTransaccion(async (ops) => {
          await ops.guardarSnapshot(evento.capturadoAt, evento.payload);
          await ops.purgarSnapshots(new Date());
        });
      case 'heartbeat':
        return escritura.enTransaccion(async (ops) => {
          const actual = await ops.leerEstado();
          const nuevo: DatosEstado = {
            ...evento.estado,
            // Un heartbeat sin lectura no borra la última lectura conocida.
            ultimaLecturaAt: evento.estado.ultimaLecturaAt ?? actual?.ultimaLecturaAt ?? null,
          };
          if (actual) {
            const llegoTarde =
              actual.ultimaLecturaAt !== null &&
              nuevo.ultimaLecturaAt !== null &&
              nuevo.ultimaLecturaAt < actual.ultimaLecturaAt;
            if (llegoTarde || mismoEstado(actual, nuevo)) {
              return;
            }
          }
          await ops.guardarEstado(nuevo);
        });
    }
  }
}

function idDe(evento: unknown): string | null {
  if (evento !== null && typeof evento === 'object') {
    const id = (evento as { id?: unknown }).id;
    if (typeof id === 'string' && id.length > 0 && id.length <= 64) {
      return id;
    }
  }
  return null;
}

/** `a` es lo guardado: en la tabla `version_agente` admite nulo. */
function mismoEstado(
  a: { [K in keyof DatosEstado]: DatosEstado[K] | null },
  b: DatosEstado,
): boolean {
  return (
    a.versionAgente === b.versionAgente &&
    a.versionSr === b.versionSr &&
    a.ultimoError === b.ultimoError &&
    a.tamanoCola === b.tamanoCola &&
    a.latenciaQueryMs === b.latenciaQueryMs &&
    (a.ultimaLecturaAt?.getTime() ?? null) === (b.ultimaLecturaAt?.getTime() ?? null)
  );
}

function describir(err: unknown): string {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return `${err.code} ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// validación y normalización de un evento
// ---------------------------------------------------------------------------

async function validarComo<T extends object>(
  clase: ClassConstructor<T>,
  plano: unknown,
  prefijo: string,
): Promise<Resultado<T>> {
  const instancia = plainToInstance(clase, plano);
  const errores = await validate(instancia, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  });
  if (errores.length > 0) {
    return { ok: false, motivo: aplanar(errores, prefijo).join('; ') };
  }
  return { ok: true, valor: instancia };
}

/** `datos.partidas.0.total: total debe ser...`: la ruta completa de cada error. */
function aplanar(errores: ValidationError[], prefijo: string): string[] {
  return errores.flatMap((e) => {
    const ruta = prefijo ? `${prefijo}.${e.property}` : e.property;
    const propios = Object.values(e.constraints ?? {}).map((m) => `${ruta}: ${m}`);
    return [...propios, ...aplanar(e.children ?? [], ruta)];
  });
}

async function validarYNormalizar(evento: unknown): Promise<Resultado<EventoNormalizado>> {
  const cabecera = await validarComo(CabeceraEventoDto, evento, '');
  if (!cabecera.ok) {
    return cabecera;
  }
  const { tipo, datos } = cabecera.valor;
  try {
    switch (tipo) {
      case 'cheque': {
        const r = await validarComo(DatosChequeDto, datos, 'datos');
        return r.ok ? { ok: true, valor: normalizarCheque(r.valor) } : r;
      }
      case 'snapshot': {
        const r = await validarComo(DatosSnapshotDto, datos, 'datos');
        return r.ok ? { ok: true, valor: normalizarSnapshot(r.valor) } : r;
      }
      case 'heartbeat': {
        const r = await validarComo(DatosHeartbeatDto, datos, 'datos');
        return r.ok ? { ok: true, valor: normalizarHeartbeat(r.valor) } : r;
      }
    }
  } catch (err) {
    if (err instanceof FueraDeRango) {
      return { ok: false, motivo: err.message };
    }
    throw err;
  }
}

function importe(ruta: string, texto: string): Prisma.Decimal {
  const valor = dinero(texto);
  if (valor === null) {
    throw new FueraDeRango(`${ruta}: el importe ${texto} no cabe en NUMERIC(12,2) al redondear`);
  }
  return valor;
}

function normalizarCheque(d: DatosChequeDto): EventoNormalizado {
  return {
    tipo: 'cheque',
    folioSr: d.folioSr,
    datos: {
      folio: d.folio,
      abiertoAt: fechaUtc(d.abiertoAt),
      cerradoAt: d.cerradoAt ? fechaUtc(d.cerradoAt) : null,
      mesa: d.mesa ?? null,
      mesero: d.mesero ?? null,
      comensales: d.comensales ?? null,
      // Tal cual (el catálogo tampoco recorta `origenSrId`, y el cruce es exacto); sólo espacios
      // = sin cliente.
      clienteOrigenSrId: d.clienteOrigenSrId?.trim() ? d.clienteOrigenSrId : null,
      subtotal: importe('datos.subtotal', d.subtotal),
      impuestos: importe('datos.impuestos', d.impuestos),
      descuentos: importe('datos.descuentos', d.descuentos),
      propina: importe('datos.propina', d.propina),
      total: importe('datos.total', d.total),
      cancelado: d.cancelado,
    },
    partidas: d.partidas.map((p, i) => ({
      producto: p.producto,
      categoria: p.categoria ?? null,
      cantidad: cantidad(p.cantidad),
      precioUnit: importe(`datos.partidas.${i}.precioUnit`, p.precioUnit),
      total: importe(`datos.partidas.${i}.total`, p.total),
      modificadores: (p.modificadores ?? []).map((m, j) => ({
        nombre: m.nombre,
        precio: importe(`datos.partidas.${i}.modificadores.${j}.precio`, m.precio).toFixed(2),
      })),
    })),
    pagos: d.pagos.map((p, i) => ({
      forma: derivarFormaPago(p.formaRaw),
      formaRaw: p.formaRaw,
      monto: importe(`datos.pagos.${i}.monto`, p.monto),
    })),
  };
}

function normalizarSnapshot(d: DatosSnapshotDto): EventoNormalizado {
  return {
    tipo: 'snapshot',
    capturadoAt: fechaUtc(d.capturadoAt),
    payload: { mesas: d.mesas } as Prisma.InputJsonValue,
  };
}

function normalizarHeartbeat(d: DatosHeartbeatDto): EventoNormalizado {
  return {
    tipo: 'heartbeat',
    estado: {
      versionAgente: d.versionAgente,
      versionSr: d.versionSr ?? null,
      ultimaLecturaAt: d.ultimaLecturaAt ? fechaUtc(d.ultimaLecturaAt) : null,
      ultimoError: d.ultimoError ?? null,
      tamanoCola: d.tamanoCola ?? null,
      latenciaQueryMs: d.latenciaQueryMs ?? null,
    },
  };
}
