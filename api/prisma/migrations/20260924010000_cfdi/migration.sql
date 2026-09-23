-- CreateEnum
CREATE TYPE "estado_emision_cfdi" AS ENUM ('timbrando', 'vigente', 'cancelado');

-- CreateTable
CREATE TABLE "cfdis" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "cheque_id" UUID NOT NULL,
    "codigo_id" UUID,
    "perfil_fiscal_id" UUID NOT NULL,
    "serie" TEXT NOT NULL,
    "folio" INTEGER NOT NULL,
    "uuid" TEXT,
    "id_pac" TEXT,
    "receptor" JSONB NOT NULL,
    "forma_pago" CHAR(2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "iva" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "estado" "estado_emision_cfdi" NOT NULL DEFAULT 'timbrando',
    "emitido_at" TIMESTAMPTZ(3),
    "xml_url" TEXT,
    "pdf_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cfdis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cfdis_empresa_id_emitido_at_idx" ON "cfdis"("empresa_id", "emitido_at");

-- CreateIndex
CREATE INDEX "cfdis_cheque_id_idx" ON "cfdis"("cheque_id");

-- CreateIndex
CREATE INDEX "cfdis_sucursal_id_idx" ON "cfdis"("sucursal_id");

-- CreateIndex
CREATE UNIQUE INDEX "cfdis_codigo_id_key" ON "cfdis"("codigo_id");

-- CreateIndex
CREATE UNIQUE INDEX "cfdis_codigo_id_empresa_id_key" ON "cfdis"("codigo_id", "empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "cfdis_uuid_key" ON "cfdis"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "cfdis_empresa_id_serie_folio_key" ON "cfdis"("empresa_id", "serie", "folio");

-- CreateIndex
CREATE UNIQUE INDEX "codigos_facturacion_id_empresa_id_key" ON "codigos_facturacion"("id", "empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "perfiles_fiscales_id_empresa_id_key" ON "perfiles_fiscales"("id", "empresa_id");

-- AddForeignKey
ALTER TABLE "cfdis" ADD CONSTRAINT "cfdis_empresa_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cfdis" ADD CONSTRAINT "cfdis_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cfdis" ADD CONSTRAINT "cfdis_cheque_empresa_fkey" FOREIGN KEY ("cheque_id", "empresa_id") REFERENCES "cheques"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cfdis" ADD CONSTRAINT "cfdis_codigo_empresa_fkey" FOREIGN KEY ("codigo_id", "empresa_id") REFERENCES "codigos_facturacion"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cfdis" ADD CONSTRAINT "cfdis_perfil_empresa_fkey" FOREIGN KEY ("perfil_fiscal_id", "empresa_id") REFERENCES "perfiles_fiscales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A mano (F2-104): lo que la base también cuida de un CFDI (`api/src/facturacion/cfdi.ts`).
-- Una reserva (`timbrando`) todavía no tiene folio fiscal; en cuanto deja de serlo, lo exige.
ALTER TABLE "cfdis" ADD CONSTRAINT "cfdis_timbre_check"
    CHECK (
        ("estado" = 'timbrando' AND "uuid" IS NULL AND "id_pac" IS NULL AND "emitido_at" IS NULL)
        OR ("estado" <> 'timbrando' AND "uuid" IS NOT NULL AND "id_pac" IS NOT NULL
            AND "emitido_at" IS NOT NULL)
    );
-- Importes: positivos y cuadrados al centavo (el subtotal y el IVA salen del total del cheque).
ALTER TABLE "cfdis" ADD CONSTRAINT "cfdis_importes_check"
    CHECK ("total" > 0 AND "subtotal" > 0 AND "iva" >= 0 AND "subtotal" + "iva" = "total");
ALTER TABLE "cfdis" ADD CONSTRAINT "cfdis_folio_check" CHECK ("folio" > 0);
ALTER TABLE "cfdis" ADD CONSTRAINT "cfdis_forma_pago_check" CHECK ("forma_pago" ~ '^[0-9]{2}$');
