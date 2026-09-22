-- CreateEnum
CREATE TYPE "canal_negocio" AS ENUM ('comedor', 'mostrador', 'domicilio', 'plataformas');

-- AlterTable
ALTER TABLE "cheques" ADD COLUMN     "area_origen_sr_id" TEXT;

-- CreateTable
CREATE TABLE "areas_canal" (
    "area_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "canal" "canal_negocio" NOT NULL,
    "actualizado_por" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "areas_canal_pkey" PRIMARY KEY ("area_id")
);

-- CreateIndex
CREATE INDEX "areas_canal_empresa_id_idx" ON "areas_canal"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "areas_canal_area_id_empresa_id_key" ON "areas_canal"("area_id", "empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "areas_catalogo_id_empresa_id_key" ON "areas_catalogo"("id", "empresa_id");

-- AddForeignKey
ALTER TABLE "areas_canal" ADD CONSTRAINT "areas_canal_area_empresa_fkey" FOREIGN KEY ("area_id", "empresa_id") REFERENCES "areas_catalogo"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECK escrito a mano (F2-233): Prisma no lo modela. Mismo largo que `origen_sr_id` de los
-- catálogos espejo (F2-230); nulo = la cuenta no trae área, nunca texto vacío.
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_area_origen_sr_id_chk" CHECK ("area_origen_sr_id" IS NULL OR length("area_origen_sr_id") BETWEEN 1 AND 64);
