-- CreateEnum
CREATE TYPE "origen_cfdi" AS ENUM ('ticket', 'manual');

-- AlterTable
ALTER TABLE "cfdis" ADD COLUMN     "cancelado_at" TIMESTAMPTZ(3),
ADD COLUMN     "motivo_cancelacion" CHAR(2),
ADD COLUMN     "origen" "origen_cfdi" NOT NULL DEFAULT 'ticket',
ADD COLUMN     "solicitud_id" UUID,
ADD COLUMN     "sustituye_a_id" UUID,
ADD COLUMN     "tipo_relacion" CHAR(2),
ALTER COLUMN "cheque_id" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "cfdis_sustituye_a_id_key" ON "cfdis"("sustituye_a_id");

-- CreateIndex
CREATE UNIQUE INDEX "cfdis_sustituye_a_id_empresa_id_key" ON "cfdis"("sustituye_a_id", "empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "cfdis_empresa_id_solicitud_id_key" ON "cfdis"("empresa_id", "solicitud_id");

-- AddForeignKey
ALTER TABLE "cfdis" ADD CONSTRAINT "cfdis_sustituye_a_empresa_fkey" FOREIGN KEY ("sustituye_a_id", "empresa_id") REFERENCES "cfdis"("id", "empresa_id") ON DELETE NO ACTION ON UPDATE NO ACTION;



-- A mano (F2-107): lo que la base también cuida de una factura sin ticket y de una refacturación.
-- Un CFDI de ticket tiene cheque; uno manual no tiene ni cheque ni código.
ALTER TABLE "cfdis" ADD CONSTRAINT "cfdis_origen_check"
    CHECK (
        ("origen" = 'ticket' AND "cheque_id" IS NOT NULL)
        OR ("origen" = 'manual' AND "cheque_id" IS NULL AND "codigo_id" IS NULL)
    );
-- La idempotencia de la captura manual la garantiza la base: un manual que no es sustituto
-- nace con su llave de solicitud.
ALTER TABLE "cfdis" ADD CONSTRAINT "cfdis_solicitud_check"
    CHECK ("origen" <> 'manual' OR "sustituye_a_id" IS NOT NULL OR "solicitud_id" IS NOT NULL);
-- Sustitución: relación 04 si y sólo si sustituye a otro CFDI, y nunca a sí mismo.
ALTER TABLE "cfdis" ADD CONSTRAINT "cfdis_relacion_check"
    CHECK (
        ("sustituye_a_id" IS NULL) = ("tipo_relacion" IS NULL)
        AND ("tipo_relacion" IS NULL OR "tipo_relacion" = '04')
        AND ("sustituye_a_id" IS NULL OR "sustituye_a_id" <> "id")
    );
-- Motivo de cancelación: del catálogo c_MotivoCancelacion, y sólo en un CFDI cancelado.
ALTER TABLE "cfdis" ADD CONSTRAINT "cfdis_motivo_cancelacion_check"
    CHECK (
        "motivo_cancelacion" IS NULL
        OR ("motivo_cancelacion" IN ('01', '02', '03', '04') AND "estado" = 'cancelado')
    );
ALTER TABLE "cfdis" ADD CONSTRAINT "cfdis_cancelado_at_check"
    CHECK ("cancelado_at" IS NULL OR "estado" = 'cancelado');
