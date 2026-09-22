-- AlterTable
ALTER TABLE "cheques" ADD COLUMN     "cliente_origen_sr_id" TEXT;

-- CreateIndex
CREATE INDEX "cheques_sucursal_id_cliente_origen_sr_id_idx" ON "cheques"("sucursal_id", "cliente_origen_sr_id");

-- CHECK escrito a mano (F2-232): Prisma no lo modela. Mismo largo que `origen_sr_id` de los
-- catálogos espejo (F2-230); nulo = la cuenta no trae cliente, nunca texto vacío.
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_cliente_origen_sr_id_chk" CHECK ("cliente_origen_sr_id" IS NULL OR length("cliente_origen_sr_id") BETWEEN 1 AND 64);
