-- CreateEnum
CREATE TYPE "periodicidad_global" AS ENUM ('diaria', 'semanal', 'mensual');

-- AlterEnum
ALTER TYPE "origen_cfdi" ADD VALUE 'global';

-- AlterTable
ALTER TABLE "cfdis" ADD COLUMN     "global_anio" INTEGER,
ADD COLUMN     "global_desde" TIMESTAMPTZ(3),
ADD COLUMN     "global_hasta" TIMESTAMPTZ(3),
ADD COLUMN     "global_meses" CHAR(2),
ADD COLUMN     "global_periodicidad" CHAR(2);

-- AlterTable
ALTER TABLE "configuraciones_facturacion" ADD COLUMN     "global_automatica" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "global_automatica_desde" TIMESTAMPTZ(3),
ADD COLUMN     "global_periodicidad" "periodicidad_global" NOT NULL DEFAULT 'mensual';

-- CreateTable
CREATE TABLE "cfdi_global_codigos" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "cfdi_id" UUID NOT NULL,
    "codigo_id" UUID NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cfdi_global_codigos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cfdi_global_codigos_empresa_id_idx" ON "cfdi_global_codigos"("empresa_id");

-- CreateIndex
CREATE INDEX "cfdi_global_codigos_sucursal_id_idx" ON "cfdi_global_codigos"("sucursal_id");

-- CreateIndex
CREATE INDEX "cfdi_global_codigos_cfdi_id_idx" ON "cfdi_global_codigos"("cfdi_id");

-- CreateIndex
CREATE UNIQUE INDEX "cfdi_global_codigos_codigo_id_key" ON "cfdi_global_codigos"("codigo_id");

-- CreateIndex
CREATE UNIQUE INDEX "cfdi_global_codigos_codigo_sucursal_empresa_key" ON "cfdi_global_codigos"("codigo_id", "sucursal_id", "empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "cfdis_id_sucursal_id_empresa_id_key" ON "cfdis"("id", "sucursal_id", "empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "codigos_facturacion_id_sucursal_id_empresa_id_key" ON "codigos_facturacion"("id", "sucursal_id", "empresa_id");

-- AddForeignKey
ALTER TABLE "cfdi_global_codigos" ADD CONSTRAINT "cfdi_global_codigos_empresa_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cfdi_global_codigos" ADD CONSTRAINT "cfdi_global_codigos_cfdi_fkey" FOREIGN KEY ("cfdi_id", "sucursal_id", "empresa_id") REFERENCES "cfdis"("id", "sucursal_id", "empresa_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cfdi_global_codigos" ADD CONSTRAINT "cfdi_global_codigos_codigo_fkey" FOREIGN KEY ("codigo_id", "sucursal_id", "empresa_id") REFERENCES "codigos_facturacion"("id", "sucursal_id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- A mano (F2-108): lo que la base también cuida de una factura global. Los CHECK comparan
-- `origen::text`: el valor 'global' del enum se agrega en esta misma migración y Postgres no deja
-- usar un valor nuevo de enum dentro de la transacción que lo crea.
-- Un CFDI de ticket tiene cheque; uno manual o una global no tienen ni cheque ni código.
ALTER TABLE "cfdis" DROP CONSTRAINT "cfdis_origen_check";
ALTER TABLE "cfdis" ADD CONSTRAINT "cfdis_origen_check"
    CHECK (
        ("origen"::text = 'ticket' AND "cheque_id" IS NOT NULL)
        OR ("origen"::text IN ('manual', 'global') AND "cheque_id" IS NULL AND "codigo_id" IS NULL)
    );
-- La global y SÓLO la global lleva su InformacionGlobal completa (periodicidad 01/02/04, mes
-- 01..12, año y periodo con desde < hasta), y nunca es sustituto de nada.
ALTER TABLE "cfdis" ADD CONSTRAINT "cfdis_global_check"
    CHECK (
        (
            "origen"::text = 'global'
            AND "global_periodicidad" IN ('01', '02', '04')
            AND "global_meses" IN ('01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12')
            AND "global_anio" BETWEEN 2000 AND 2999
            AND "global_desde" IS NOT NULL
            AND "global_hasta" IS NOT NULL
            AND "global_desde" < "global_hasta"
            AND "sustituye_a_id" IS NULL
            AND "tipo_relacion" IS NULL
        )
        OR (
            "origen"::text <> 'global'
            AND "global_periodicidad" IS NULL
            AND "global_meses" IS NULL
            AND "global_anio" IS NULL
            AND "global_desde" IS NULL
            AND "global_hasta" IS NULL
        )
    );
-- El total de un ticket dentro de una global es positivo (sólo entran tickets facturables).
ALTER TABLE "cfdi_global_codigos" ADD CONSTRAINT "cfdi_global_codigos_total_check"
    CHECK ("total" > 0);
-- La emisión automática sabe desde cuándo está encendida (sólo emite periodos posteriores).
ALTER TABLE "configuraciones_facturacion" ADD CONSTRAINT "configuraciones_facturacion_global_automatica_check"
    CHECK ("global_automatica" = ("global_automatica_desde" IS NOT NULL));
