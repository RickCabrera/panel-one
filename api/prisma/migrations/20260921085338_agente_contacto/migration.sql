-- AlterTable
ALTER TABLE "agente_estado" ADD COLUMN     "tamano_cola" INTEGER;

-- CreateTable
CREATE TABLE "agente_contacto" (
    "sucursal_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "ultimo_contacto_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agente_contacto_pkey" PRIMARY KEY ("sucursal_id")
);

-- CreateIndex
CREATE INDEX "agente_contacto_empresa_id_idx" ON "agente_contacto"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "agente_contacto_sucursal_id_empresa_id_key" ON "agente_contacto"("sucursal_id", "empresa_id");

-- AddForeignKey
ALTER TABLE "agente_contacto" ADD CONSTRAINT "agente_contacto_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Escrito a mano (Prisma no modela CHECK): el tamaño de cola que reporta el
-- heartbeat nunca es negativo. El DTO ya lo valida; esto lo garantiza en base.
ALTER TABLE "agente_estado" ADD CONSTRAINT "agente_estado_tamano_cola_chk" CHECK ("tamano_cola" IS NULL OR "tamano_cola" >= 0);
