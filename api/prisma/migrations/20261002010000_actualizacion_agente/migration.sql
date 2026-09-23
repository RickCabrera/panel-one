-- CreateEnum
CREATE TYPE "resultado_actualizacion" AS ENUM ('aplicada', 'fallida');

-- CreateEnum
CREATE TYPE "motivo_falla_actualizacion" AS ENUM ('hash_invalido', 'descarga', 'detener', 'reemplazo', 'arranque', 'version_distinta');

-- AlterEnum
ALTER TYPE "tipo_alerta" ADD VALUE 'actualizacion_fallida';

-- AlterTable
ALTER TABLE "sucursales" ADD COLUMN     "actualizacion_automatica" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "agente_actualizacion" (
    "sucursal_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "resultado" "resultado_actualizacion" NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "motivo" "motivo_falla_actualizacion",
    "detalle" VARCHAR(500),
    "primera_falla_at" TIMESTAMPTZ(3),
    "reportada_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agente_actualizacion_pkey" PRIMARY KEY ("sucursal_id")
);

-- CreateTable
CREATE TABLE "versiones_agente" (
    "id" UUID NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "tamano_bytes" INTEGER NOT NULL,
    "clave_archivo" TEXT NOT NULL,
    "notas" VARCHAR(500),
    "publicada_at" TIMESTAMPTZ(3) NOT NULL,
    "publicada_por" UUID,
    "retirada_at" TIMESTAMPTZ(3),

    CONSTRAINT "versiones_agente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agente_actualizacion_empresa_id_idx" ON "agente_actualizacion"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "agente_actualizacion_sucursal_id_empresa_id_key" ON "agente_actualizacion"("sucursal_id", "empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "versiones_agente_version_key" ON "versiones_agente"("version");

-- CreateIndex
CREATE INDEX "versiones_agente_publicada_at_idx" ON "versiones_agente"("publicada_at");

-- AddForeignKey
ALTER TABLE "agente_actualizacion" ADD CONSTRAINT "agente_actualizacion_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- F2-143: CHECKs escritos a mano (Prisma no los modela).
ALTER TABLE "versiones_agente" ADD CONSTRAINT "versiones_agente_version_check"
    CHECK ("version" ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$');
ALTER TABLE "versiones_agente" ADD CONSTRAINT "versiones_agente_sha256_check"
    CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "versiones_agente" ADD CONSTRAINT "versiones_agente_tamano_check"
    CHECK ("tamano_bytes" > 0);
ALTER TABLE "agente_actualizacion" ADD CONSTRAINT "agente_actualizacion_version_check"
    CHECK ("version" ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$');
-- `motivo` y `primera_falla_at` existen sólo con `fallida`, y con `fallida` los dos existen.
ALTER TABLE "agente_actualizacion" ADD CONSTRAINT "agente_actualizacion_falla_check"
    CHECK (
        ("resultado" = 'fallida' AND "motivo" IS NOT NULL AND "primera_falla_at" IS NOT NULL)
        OR ("resultado" = 'aplicada' AND "motivo" IS NULL AND "primera_falla_at" IS NULL)
    );
