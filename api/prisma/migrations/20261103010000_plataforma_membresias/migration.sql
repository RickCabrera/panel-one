-- Plataforma: planes, membresías, pagos, bitácora y ajustes globales (panel de plataforma).

-- CreateEnum
CREATE TYPE "periodicidad_plan" AS ENUM ('mensual', 'anual');

-- CreateEnum
CREATE TYPE "estado_suscripcion" AS ENUM ('prueba', 'activa', 'suspendida', 'cancelada');

-- CreateEnum
CREATE TYPE "metodo_pago" AS ENUM ('transferencia', 'efectivo', 'tarjeta', 'otro');

-- AlterTable
ALTER TABLE "empresas" ADD COLUMN     "contacto_email" VARCHAR(254),
ADD COLUMN     "contacto_nombre" VARCHAR(120),
ADD COLUMN     "contacto_telefono" VARCHAR(30),
ADD COLUMN     "notas_plataforma" VARCHAR(2000),
ADD COLUMN     "rfc" VARCHAR(13);

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "ultimo_acceso_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "planes" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,
    "descripcion" VARCHAR(500),
    "precio_mensual" DECIMAL(12,2) NOT NULL,
    "periodicidad" "periodicidad_plan" NOT NULL DEFAULT 'mensual',
    "limite_sucursales" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "planes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suscripciones" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "estado" "estado_suscripcion" NOT NULL,
    "inicio" DATE NOT NULL,
    "vencimiento" DATE NOT NULL,
    "dias_gracia" INTEGER NOT NULL DEFAULT 5,
    "dia_corte" INTEGER NOT NULL,
    "notas" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suscripciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagos_suscripcion" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "suscripcion_id" UUID NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "moneda" CHAR(3) NOT NULL DEFAULT 'MXN',
    "fecha_pago" DATE NOT NULL,
    "metodo" "metodo_pago" NOT NULL,
    "referencia" VARCHAR(120),
    "periodo_desde" DATE NOT NULL,
    "periodo_hasta" DATE NOT NULL,
    "notas" VARCHAR(1000),
    "registrado_por_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anulado_at" TIMESTAMPTZ(3),
    "anulado_por_id" UUID,
    "motivo_anulacion" VARCHAR(500),

    CONSTRAINT "pagos_suscripcion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bitacora_plataforma" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "actor_email" VARCHAR(254) NOT NULL,
    "accion" VARCHAR(60) NOT NULL,
    "empresa_id" UUID,
    "recurso" VARCHAR(40),
    "recurso_id" UUID,
    "antes" JSONB,
    "despues" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bitacora_plataforma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion_plataforma" (
    "id" SMALLINT NOT NULL,
    "color_acento" VARCHAR(20),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configuracion_plataforma_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "planes_nombre_key" ON "planes"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "suscripciones_empresa_id_key" ON "suscripciones"("empresa_id");

-- CreateIndex
CREATE INDEX "suscripciones_plan_id_idx" ON "suscripciones"("plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "suscripciones_id_empresa_id_key" ON "suscripciones"("id", "empresa_id");

-- CreateIndex
CREATE INDEX "pagos_suscripcion_empresa_id_idx" ON "pagos_suscripcion"("empresa_id");

-- CreateIndex
CREATE INDEX "pagos_suscripcion_suscripcion_id_idx" ON "pagos_suscripcion"("suscripcion_id");

-- CreateIndex
CREATE INDEX "pagos_suscripcion_fecha_pago_idx" ON "pagos_suscripcion"("fecha_pago");

-- CreateIndex
CREATE INDEX "bitacora_plataforma_created_at_idx" ON "bitacora_plataforma"("created_at");

-- CreateIndex
CREATE INDEX "bitacora_plataforma_empresa_id_idx" ON "bitacora_plataforma"("empresa_id");

-- AddForeignKey
ALTER TABLE "suscripciones" ADD CONSTRAINT "suscripciones_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suscripciones" ADD CONSTRAINT "suscripciones_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "planes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos_suscripcion" ADD CONSTRAINT "pagos_suscripcion_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos_suscripcion" ADD CONSTRAINT "pagos_suscripcion_suscripcion_empresa_fkey" FOREIGN KEY ("suscripcion_id", "empresa_id") REFERENCES "suscripciones"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos_suscripcion" ADD CONSTRAINT "pagos_suscripcion_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos_suscripcion" ADD CONSTRAINT "pagos_suscripcion_anulado_por_id_fkey" FOREIGN KEY ("anulado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECKs escritos a mano (Prisma no los modela).
ALTER TABLE "planes" ADD CONSTRAINT "planes_precio_mensual_check" CHECK ("precio_mensual" >= 0);
ALTER TABLE "planes" ADD CONSTRAINT "planes_limite_sucursales_check"
    CHECK ("limite_sucursales" IS NULL OR "limite_sucursales" >= 1);
ALTER TABLE "suscripciones" ADD CONSTRAINT "suscripciones_dia_corte_check"
    CHECK ("dia_corte" BETWEEN 1 AND 28);
ALTER TABLE "suscripciones" ADD CONSTRAINT "suscripciones_dias_gracia_check"
    CHECK ("dias_gracia" BETWEEN 0 AND 60);
ALTER TABLE "pagos_suscripcion" ADD CONSTRAINT "pagos_suscripcion_monto_check" CHECK ("monto" > 0);
ALTER TABLE "pagos_suscripcion" ADD CONSTRAINT "pagos_suscripcion_periodo_check"
    CHECK ("periodo_hasta" > "periodo_desde");
ALTER TABLE "pagos_suscripcion" ADD CONSTRAINT "pagos_suscripcion_moneda_check"
    CHECK ("moneda" ~ '^[A-Z]{3}$');
ALTER TABLE "pagos_suscripcion" ADD CONSTRAINT "pagos_suscripcion_anulacion_check"
    CHECK (("anulado_at" IS NULL) = ("anulado_por_id" IS NULL)
       AND ("anulado_at" IS NULL) = ("motivo_anulacion" IS NULL));
ALTER TABLE "configuracion_plataforma" ADD CONSTRAINT "configuracion_plataforma_id_check" CHECK ("id" = 1);
ALTER TABLE "configuracion_plataforma" ADD CONSTRAINT "configuracion_plataforma_color_check"
    CHECK ("color_acento" IS NULL OR "color_acento" IN
      ('naranja', 'morado', 'azul_electrico', 'verde_azulado', 'ambar_dorado', 'magenta', 'rojo'));

-- La única fila de ajustes: sin color propio, la interfaz usa el del build.
INSERT INTO "configuracion_plataforma" ("id") VALUES (1);

-- Las empresas que ya existen NO se bloquean al migrar: todas quedan `activa` en un plan
-- "Plan inicial" de $0.00 sin límite de sucursales (no inventa ingresos en el MRR ni corta a
-- nadie), con día de corte = el día de hoy en CDMX (tope 28) y el vencimiento un mes después.
-- `activa` y no `prueba`: ya operan con el sistema; una prueba sugeriría que se acaba sola.
-- Quien administre la plataforma les asigna su plan real desde el panel.
INSERT INTO "planes" ("id", "nombre", "descripcion", "precio_mensual", "periodicidad",
                      "limite_sucursales", "activo", "updated_at")
SELECT gen_random_uuid(), 'Plan inicial',
       'Asignado por la migración a los clientes que ya existían. Cámbialo por su plan real.',
       0.00, 'mensual', NULL, true, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "empresas");

WITH hoy AS (
  SELECT (now() AT TIME ZONE 'America/Mexico_City')::date AS d
)
INSERT INTO "suscripciones" ("id", "empresa_id", "plan_id", "estado", "inicio", "vencimiento",
                             "dias_gracia", "dia_corte", "notas", "updated_at")
SELECT gen_random_uuid(), e."id", p."id", 'activa',
       (e."created_at" AT TIME ZONE 'America/Mexico_City')::date,
       make_date(
         EXTRACT(YEAR FROM (hoy.d + INTERVAL '1 month'))::int,
         EXTRACT(MONTH FROM (hoy.d + INTERVAL '1 month'))::int,
         LEAST(EXTRACT(DAY FROM hoy.d)::int, 28)
       ),
       5, LEAST(EXTRACT(DAY FROM hoy.d)::int, 28),
       'Creada por la migración de membresías.', CURRENT_TIMESTAMP
FROM "empresas" e
CROSS JOIN hoy
JOIN "planes" p ON p."nombre" = 'Plan inicial';

