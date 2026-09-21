-- AlterTable
ALTER TABLE "agente_estado" ADD COLUMN     "latencia_query_ms" INTEGER;

-- Escrito a mano (Prisma no modela CHECK): la latencia de la consulta a SR que
-- reporta el heartbeat (F1-025) nunca es negativa. El DTO ya lo valida; esto lo
-- garantiza en base.
ALTER TABLE "agente_estado" ADD CONSTRAINT "agente_estado_latencia_query_ms_chk" CHECK ("latencia_query_ms" IS NULL OR "latencia_query_ms" >= 0);
