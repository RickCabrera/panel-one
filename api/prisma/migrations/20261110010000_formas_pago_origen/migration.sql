-- PAG-01: el catálogo de formas de pago se llena solo desde `formasdepago.tipo` de SR.
-- `origen` = quién decidió la fila (`pos` = la sincronización, `manual` = una persona).
-- Las filas que ya existen (altas directas en la base) quedan `manual`: la sincronización
-- nunca las pisa.

-- CreateEnum
CREATE TYPE "origen_forma_pago" AS ENUM ('pos', 'manual');

-- AlterTable
ALTER TABLE "formas_pago_catalogo" ADD COLUMN     "origen" "origen_forma_pago" NOT NULL DEFAULT 'manual',
ADD COLUMN     "sucursal_origen_id" UUID,
ADD COLUMN     "tipo_sr" SMALLINT;

-- AddForeignKey
ALTER TABLE "formas_pago_catalogo" ADD CONSTRAINT "formas_pago_catalogo_sucursal_origen_id_fkey" FOREIGN KEY ("sucursal_origen_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
