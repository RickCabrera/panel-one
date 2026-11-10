import type { FormaPago, OrigenFormaPago } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';

import { RegistroFormaPagoDto, type RechazoRegistroDto } from './dto/catalogos.dto';

/**
 * La parte PURA del catálogo de formas de pago que manda el agente (PAG-01): validar cada
 * registro de `dbo.formasdepago`, traducir su `tipo` a nuestro ENUM y decidir qué hacer con
 * cada texto frente a lo que ya hay en `formas_pago_catalogo` de la empresa. Sin base de datos:
 * la escritura vive en `scope/escritura-formas-pago.ts`.
 *
 * El catálogo es POR EMPRESA y su llave es el texto exacto (`forma_raw`), igual que desde
 * F1-032: los agregados lo aplican AL LEER, así que llenarlo reclasifica el histórico sin
 * reingerir nada (docs/esquema-sr.md §4).
 */

/**
 * `formasdepago.tipo` de SR → nuestro ENUM (docs/esquema-sr.md §4, validado en F1-090: son las
 * columnas `efectivo`/`tarjeta`/`vales`/`otros` de la cuenta).
 *
 * - 1 efectivo → `efectivo` (también DOLARES: SR lo cuenta como efectivo).
 * - 2 tarjeta → `tarjeta`.
 * - 3 vales y 4 otros → `otro`. Nuestro ENUM no tiene vales ni crédito: un vale de despensa no es
 *   efectivo en caja ni un cargo a tarjeta, y un crédito (CREDITO, TOKENCASH, MARC…) es una
 *   cuenta por cobrar, no dinero cobrado. Meterlos en `efectivo` o `tarjeta` inflaría lo que el
 *   cajero tiene que entregar en el «Declarado vs cobrado» de Turnos, y en el CFDI daría una
 *   `c_FormaPago` falsa (`otro` no se factura en línea, §2).
 *
 * `transferencia` NUNCA se asigna sola: SR no tiene un `tipo` para transferencias. Si un cliente
 * cobra por transferencia, ese texto se clasifica a mano (fila `manual`).
 */
export function formaDeTipoSr(tipo: number | null): FormaPago | null {
  switch (tipo) {
    case 1:
      return 'efectivo';
    case 2:
      return 'tarjeta';
    case 3:
    case 4:
      return 'otro';
    default:
      return null;
  }
}

/** Un registro válido de la página, ya leído. */
export interface FormaPagoSr {
  indice: number;
  origenSrId: string;
  nombre: string;
  tipo: number | null;
}

export type ValidacionFormas =
  | { ok: true; validos: FormaPagoSr[]; rechazos: RechazoRegistroDto[] }
  /** Un `tipo` que no es entero 1–4 ni nulo: 400 para la página entera. */
  | { ok: false; motivo: string };

function motivos(errores: ValidationError[], prefijo: string): string[] {
  return errores.flatMap((e) => {
    const ruta = `${prefijo}.${e.property}`;
    return [
      ...Object.values(e.constraints ?? {}).map((m) => `${ruta}: ${m}`),
      ...motivos(e.children ?? [], ruta),
    ];
  });
}

/**
 * Valida cada registro con `RegistroFormaPagoDto`. Un `tipo` inválido (no entero, fuera de 1–4)
 * NO se rechaza solo: hace inválida la página entera (400), porque el agente nunca lo manda y un
 * tipo inventado clasificaría mal dinero. Cualquier otro error (nombre vacío, campo de más) se
 * rechaza solo, como en los demás catálogos.
 */
export async function validarFormasPago(registros: unknown[]): Promise<ValidacionFormas> {
  const validos: FormaPagoSr[] = [];
  const rechazos: RechazoRegistroDto[] = [];
  for (const [indice, plano] of registros.entries()) {
    const instancia = plainToInstance(RegistroFormaPagoDto, plano);
    const errores = await validate(instancia, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });
    const deTipo = errores.filter((e) => e.property === 'tipo');
    if (deTipo.length > 0) {
      return { ok: false, motivo: motivos(deTipo, `registros.${indice}`).join('; ') };
    }
    if (errores.length > 0) {
      const origen = (plano as { origenSrId?: unknown }).origenSrId;
      rechazos.push({
        indice,
        origenSrId:
          typeof origen === 'string' && origen.length >= 1 && origen.length <= 64 ? origen : null,
        motivo: motivos(errores, `registros.${indice}`).join('; '),
        reintentable: false,
      });
      continue;
    }
    validos.push({
      indice,
      origenSrId: instancia.origenSrId,
      nombre: instancia.nombre,
      tipo: instancia.tipo ?? null,
    });
  }
  return { ok: true, validos, rechazos };
}

/** Lo que ya hay en `formas_pago_catalogo` de la empresa para un texto. */
export interface FilaFormaPago {
  id: string;
  formaRaw: string;
  forma: FormaPago;
  origen: OrigenFormaPago;
  tipoSr: number | null;
  sucursalOrigenId: string | null;
}

/** Un texto que no se clasificó porque choca; va al log del API (el texto de SR no es dato personal). */
export interface ConflictoFormaPago {
  formaRaw: string;
  motivo: 'mismo_pos' | 'otra_sucursal';
  /** La forma que ya tiene la fila (nulo si no hay fila). */
  actual: FormaPago | null;
  /** Las formas que pidió este POS. */
  pedidas: FormaPago[];
}

export interface PlanFormasPago {
  crear: Array<{ formaRaw: string; forma: FormaPago; tipoSr: number }>;
  actualizar: Array<{ id: string; forma: FormaPago; tipoSr: number }>;
  sinCambios: number;
  manuales: number;
  sinTipo: number;
  conflictos: ConflictoFormaPago[];
}

/**
 * Decide qué hacer con cada TEXTO de la página (la llave del catálogo es `forma_raw`, no el
 * `idformadepago`). Reglas (PAG-01):
 *
 * 1. Sin `tipo` → no se clasifica: sigue contando como `otro` y saliendo en `sinCatalogo` para que
 *    se vea. Si ya tiene fila, se queda como está.
 * 2. Fila `manual` → NUNCA se toca, diga lo que diga el POS.
 * 3. El mismo POS trae el texto dos veces con tipos que dan formas DISTINTAS → conflicto: no se
 *    elige al azar, se deja como está.
 * 4. Sin fila → se crea `pos`, con la sucursal de este agente como origen.
 * 5. Fila `pos` con la misma forma → sin cambios (sólo se actualiza `tipo_sr` si la puso ESTA
 *    sucursal y cambió, p. ej. de vales a otros: misma forma, nada que reclasificar).
 * 6. Fila `pos` con otra forma: si la dio de alta ESTA sucursal, su POS cambió la clasificación y
 *    se actualiza; si la dio de alta OTRA sucursal de la empresa, es conflicto: se deja como está
 *    y se registra (el catálogo es por empresa; para resolverlo, una persona la vuelve `manual`).
 *
 * Idempotente: aplicar el plan y volver a planear la misma página da un plan sin escrituras.
 */
export function planearFormasPago(
  validos: readonly FormaPagoSr[],
  existentes: readonly FilaFormaPago[],
  sucursalId: string,
): PlanFormasPago {
  const plan: PlanFormasPago = {
    crear: [],
    actualizar: [],
    sinCambios: 0,
    manuales: 0,
    sinTipo: 0,
    conflictos: [],
  };
  const porTexto = new Map(existentes.map((f) => [f.formaRaw, f]));

  // Agrupa por texto, en el orden en que llegan.
  const grupos = new Map<string, FormaPagoSr[]>();
  for (const r of validos) {
    grupos.set(r.nombre, [...(grupos.get(r.nombre) ?? []), r]);
  }

  for (const [formaRaw, registros] of grupos) {
    const fila = porTexto.get(formaRaw) ?? null;
    const conTipo = registros.filter((r) => r.tipo !== null);
    if (conTipo.length === 0) {
      plan.sinTipo++;
      continue;
    }
    if (fila?.origen === 'manual') {
      plan.manuales++;
      plan.sinCambios++;
      continue;
    }
    const formas = [...new Set(conTipo.map((r) => formaDeTipoSr(r.tipo)!))];
    if (formas.length > 1) {
      plan.conflictos.push({
        formaRaw,
        motivo: 'mismo_pos',
        actual: fila?.forma ?? null,
        pedidas: formas,
      });
      continue;
    }
    const forma = formas[0];
    // Con varios tipos que dan la misma forma (vales y otros), se guarda el menor: determinista.
    const tipoSr = Math.min(...conTipo.map((r) => r.tipo!));
    if (fila === null) {
      plan.crear.push({ formaRaw, forma, tipoSr });
      continue;
    }
    const deEstaSucursal = fila.sucursalOrigenId === sucursalId;
    if (fila.forma === forma) {
      if (deEstaSucursal && fila.tipoSr !== tipoSr) {
        plan.actualizar.push({ id: fila.id, forma, tipoSr });
      } else {
        plan.sinCambios++;
      }
      continue;
    }
    if (deEstaSucursal) {
      plan.actualizar.push({ id: fila.id, forma, tipoSr });
      continue;
    }
    plan.conflictos.push({
      formaRaw,
      motivo: 'otra_sucursal',
      actual: fila.forma,
      pedidas: [forma],
    });
  }
  return plan;
}
