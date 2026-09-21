-- CreateEnum
CREATE TYPE "forma_pago" AS ENUM ('efectivo', 'tarjeta', 'transferencia', 'otro');

-- CreateTable
CREATE TABLE "cheques" (
    "id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "folio" TEXT NOT NULL,
    "folio_sr" TEXT NOT NULL,
    "abierto_at" TIMESTAMPTZ(3) NOT NULL,
    "cerrado_at" TIMESTAMPTZ(3),
    "mesa" TEXT,
    "mesero" TEXT,
    "comensales" INTEGER,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "impuestos" DECIMAL(12,2) NOT NULL,
    "descuentos" DECIMAL(12,2) NOT NULL,
    "propina" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "cancelado" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cheques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cheque_partidas" (
    "id" UUID NOT NULL,
    "cheque_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "orden" INTEGER NOT NULL,
    "producto" TEXT NOT NULL,
    "categoria" TEXT,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "precio_unit" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "modificadores" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "cheque_partidas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cheque_pagos" (
    "id" UUID NOT NULL,
    "cheque_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "forma" "forma_pago" NOT NULL,
    "forma_raw" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "cheque_pagos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mesa_snapshots" (
    "id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "capturado_at" TIMESTAMPTZ(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "recibido_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mesa_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cheques_empresa_id_cerrado_at_idx" ON "cheques"("empresa_id", "cerrado_at");

-- CreateIndex
CREATE UNIQUE INDEX "cheques_sucursal_id_folio_sr_key" ON "cheques"("sucursal_id", "folio_sr");

-- CreateIndex
CREATE UNIQUE INDEX "cheques_id_empresa_id_key" ON "cheques"("id", "empresa_id");

-- CreateIndex
CREATE INDEX "cheque_partidas_empresa_id_idx" ON "cheque_partidas"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "cheque_partidas_cheque_id_orden_key" ON "cheque_partidas"("cheque_id", "orden");

-- CreateIndex
CREATE INDEX "cheque_pagos_cheque_id_idx" ON "cheque_pagos"("cheque_id");

-- CreateIndex
CREATE INDEX "cheque_pagos_empresa_id_idx" ON "cheque_pagos"("empresa_id");

-- CreateIndex
CREATE INDEX "mesa_snapshots_empresa_id_idx" ON "mesa_snapshots"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "mesa_snapshots_sucursal_id_capturado_at_key" ON "mesa_snapshots"("sucursal_id", "capturado_at");

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheque_partidas" ADD CONSTRAINT "cheque_partidas_cheque_empresa_fkey" FOREIGN KEY ("cheque_id", "empresa_id") REFERENCES "cheques"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheque_pagos" ADD CONSTRAINT "cheque_pagos_cheque_empresa_fkey" FOREIGN KEY ("cheque_id", "empresa_id") REFERENCES "cheques"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mesa_snapshots" ADD CONSTRAINT "mesa_snapshots_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;
