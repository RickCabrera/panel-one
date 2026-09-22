-- CreateEnum
CREATE TYPE "tipo_reporte" AS ENUM ('diario', 'semanal');

-- CreateEnum
CREATE TYPE "estado_envio_reporte" AS ENUM ('enviando', 'enviado', 'fallido', 'descartado');

-- CreateTable
CREATE TABLE "suscripciones_reporte" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "diario" BOOLEAN NOT NULL DEFAULT false,
    "semanal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suscripciones_reporte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "envios_reporte" (
    "id" UUID NOT NULL,
    "suscripcion_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "tipo" "tipo_reporte" NOT NULL,
    "periodo" TEXT NOT NULL,
    "estado" "estado_envio_reporte" NOT NULL,
    "intentos" INTEGER NOT NULL,
    "correo_id" TEXT,
    "error" TEXT,
    "creado_at" TIMESTAMPTZ(3) NOT NULL,
    "enviado_at" TIMESTAMPTZ(3),

    CONSTRAINT "envios_reporte_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suscripciones_reporte_empresa_id_idx" ON "suscripciones_reporte"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "suscripciones_reporte_usuario_id_empresa_id_key" ON "suscripciones_reporte"("usuario_id", "empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "suscripciones_reporte_id_empresa_id_key" ON "suscripciones_reporte"("id", "empresa_id");

-- CreateIndex
CREATE INDEX "envios_reporte_empresa_id_idx" ON "envios_reporte"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "envios_reporte_suscripcion_id_tipo_periodo_key" ON "envios_reporte"("suscripcion_id", "tipo", "periodo");

-- AddForeignKey
ALTER TABLE "suscripciones_reporte" ADD CONSTRAINT "suscripciones_reporte_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suscripciones_reporte" ADD CONSTRAINT "suscripciones_reporte_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envios_reporte" ADD CONSTRAINT "envios_reporte_suscripcion_empresa_fkey" FOREIGN KEY ("suscripcion_id", "empresa_id") REFERENCES "suscripciones_reporte"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECKs escritos a mano (F2-141): Prisma no los modela.
ALTER TABLE "envios_reporte" ADD CONSTRAINT "envios_reporte_intentos_chk" CHECK ("intentos" >= 1);
ALTER TABLE "envios_reporte" ADD CONSTRAINT "envios_reporte_periodo_chk" CHECK ("periodo" ~ '^\d{4}-\d{2}-\d{2}$');
-- Enviado ⇔ tiene su marca de envío.
ALTER TABLE "envios_reporte" ADD CONSTRAINT "envios_reporte_enviado_chk" CHECK (("estado" = 'enviado') = ("enviado_at" IS NOT NULL));
