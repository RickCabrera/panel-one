-- CreateEnum
CREATE TYPE "estado_envio_cfdi" AS ENUM ('enviando', 'enviado', 'fallido');

-- AlterTable (a mano, F2-105): RENAME y no DROP/ADD. Guardan la CLAVE en `PuertoArchivos`, no
-- una URL (la URL de descarga se firma al pedirla y vence).
ALTER TABLE "cfdis" RENAME COLUMN "xml_url" TO "xml_clave";
ALTER TABLE "cfdis" RENAME COLUMN "pdf_url" TO "pdf_clave";

-- CreateTable
CREATE TABLE "cfdi_envios" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "cfdi_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "estado" "estado_envio_cfdi" NOT NULL DEFAULT 'enviando',
    "intentos" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "correo_id" TEXT,
    "ultimo_intento_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cfdi_envios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cfdi_envios_empresa_id_estado_idx" ON "cfdi_envios"("empresa_id", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "cfdi_envios_cfdi_id_email_key" ON "cfdi_envios"("cfdi_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "cfdis_id_empresa_id_key" ON "cfdis"("id", "empresa_id");

-- AddForeignKey
ALTER TABLE "cfdi_envios" ADD CONSTRAINT "cfdi_envios_empresa_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cfdi_envios" ADD CONSTRAINT "cfdi_envios_cfdi_empresa_fkey" FOREIGN KEY ("cfdi_id", "empresa_id") REFERENCES "cfdis"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- A mano (F2-105): un envío nace con su primer intento.
ALTER TABLE "cfdi_envios" ADD CONSTRAINT "cfdi_envios_intentos_check" CHECK ("intentos" >= 1);
