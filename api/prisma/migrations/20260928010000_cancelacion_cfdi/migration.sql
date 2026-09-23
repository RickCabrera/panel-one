-- CreateEnum
CREATE TYPE "estado_cancelacion_cfdi" AS ENUM ('solicitando', 'en_proceso', 'aceptada', 'rechazada');

-- CreateTable
CREATE TABLE "cfdi_cancelaciones" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "cfdi_id" UUID NOT NULL,
    "motivo" CHAR(2) NOT NULL,
    "uuid_sustitucion" TEXT,
    "estado" "estado_cancelacion_cfdi" NOT NULL DEFAULT 'solicitando',
    "solicitada_at" TIMESTAMPTZ(3) NOT NULL,
    "resuelta_at" TIMESTAMPTZ(3),
    "ultimo_error" TEXT,
    "tickets_global" JSONB,
    "aviso_enviado_at" TIMESTAMPTZ(3),
    "aviso_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cfdi_cancelaciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cfdi_cancelaciones_empresa_id_estado_idx" ON "cfdi_cancelaciones"("empresa_id", "estado");

-- CreateIndex
CREATE INDEX "cfdi_cancelaciones_cfdi_id_idx" ON "cfdi_cancelaciones"("cfdi_id");

-- AddForeignKey
ALTER TABLE "cfdi_cancelaciones" ADD CONSTRAINT "cfdi_cancelaciones_empresa_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cfdi_cancelaciones" ADD CONSTRAINT "cfdi_cancelaciones_cfdi_empresa_fkey" FOREIGN KEY ("cfdi_id", "empresa_id") REFERENCES "cfdis"("id", "empresa_id") ON DELETE CASCADE ON UPDATE CASCADE;



-- A mano (F2-109): lo que la base también cuida de una solicitud de cancelación.
-- El CANDADO: una sola solicitud ABIERTA por CFDI (doble clic = una llamada al PAC).
CREATE UNIQUE INDEX "cfdi_cancelaciones_abierta_key" ON "cfdi_cancelaciones"("cfdi_id")
    WHERE "estado" IN ('solicitando', 'en_proceso');
-- c_MotivoCancelacion del SAT, y el UUID del sustituto si y sólo si es motivo 01.
ALTER TABLE "cfdi_cancelaciones" ADD CONSTRAINT "cfdi_cancelaciones_motivo_check"
    CHECK ("motivo" IN ('01', '02', '03', '04'));
ALTER TABLE "cfdi_cancelaciones" ADD CONSTRAINT "cfdi_cancelaciones_sustitucion_check"
    CHECK (("motivo" = '01') = ("uuid_sustitucion" IS NOT NULL));
-- Resuelta ⇔ aceptada o rechazada.
ALTER TABLE "cfdi_cancelaciones" ADD CONSTRAINT "cfdi_cancelaciones_resuelta_check"
    CHECK (("estado" IN ('aceptada', 'rechazada')) = ("resuelta_at" IS NOT NULL));
