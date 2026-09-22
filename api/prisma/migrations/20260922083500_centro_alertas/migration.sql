-- CreateEnum
CREATE TYPE "tipo_alerta" AS ENUM ('sucursal_sin_reporte', 'mesa_abierta', 'cuenta_sin_imprimir', 'caida_venta');

-- CreateEnum
CREATE TYPE "severidad_alerta" AS ENUM ('critica', 'advertencia');

-- CreateEnum
CREATE TYPE "motivo_cierre_alerta" AS ENUM ('condicion', 'regla_apagada', 'sucursal_inactiva', 'empresa_inactiva');

-- CreateTable
CREATE TABLE "alertas" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "tipo" "tipo_alerta" NOT NULL,
    "severidad" "severidad_alerta" NOT NULL,
    "llave" TEXT NOT NULL,
    "llave_abierta" TEXT,
    "umbral" INTEGER NOT NULL,
    "detalle" JSONB NOT NULL,
    "abierta_at" TIMESTAMPTZ(3) NOT NULL,
    "cerrada_at" TIMESTAMPTZ(3),
    "motivo_cierre" "motivo_cierre_alerta",

    CONSTRAINT "alertas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reglas_alerta" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "tipo" "tipo_alerta" NOT NULL,
    "activa" BOOLEAN NOT NULL,
    "umbral" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reglas_alerta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alertas_empresa_id_cerrada_at_idx" ON "alertas"("empresa_id", "cerrada_at");

-- CreateIndex
CREATE INDEX "alertas_empresa_id_abierta_at_idx" ON "alertas"("empresa_id", "abierta_at");

-- CreateIndex
CREATE UNIQUE INDEX "alertas_abierta_unica" ON "alertas"("sucursal_id", "tipo", "llave_abierta");

-- CreateIndex
CREATE UNIQUE INDEX "reglas_alerta_empresa_id_tipo_key" ON "reglas_alerta"("empresa_id", "tipo");

-- AddForeignKey
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reglas_alerta" ADD CONSTRAINT "reglas_alerta_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A MANO (F2-224): CHECKs que Prisma no modela.
-- Abierta <=> llave_abierta presente e igual a llave <=> sin motivo de cierre.
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_abierta_chk" CHECK (
  ("cerrada_at" IS NULL) = ("llave_abierta" IS NOT NULL)
  AND ("llave_abierta" IS NULL OR "llave_abierta" = "llave")
  AND ("cerrada_at" IS NULL) = ("motivo_cierre" IS NULL)
  AND ("cerrada_at" IS NULL OR "cerrada_at" >= "abierta_at")
);
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_umbral_chk" CHECK ("umbral" > 0);
ALTER TABLE "reglas_alerta" ADD CONSTRAINT "reglas_alerta_umbral_chk" CHECK ("umbral" > 0);
