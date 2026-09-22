-- CreateEnum
CREATE TYPE "tipo_poliza_inventario" AS ENUM ('inicial', 'compra', 'consumo', 'merma', 'traspaso_salida', 'traspaso_entrada', 'ajuste', 'otro');

-- CreateTable
CREATE TABLE "polizas_inventario" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "origen_sr_id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "tipo" "tipo_poliza_inventario" NOT NULL,
    "tipo_sr" TEXT,
    "almacen_origen_sr_id" TEXT NOT NULL,
    "fecha" TIMESTAMPTZ(3) NOT NULL,
    "referencia" TEXT,
    "cancelada" BOOLEAN NOT NULL,
    "partidas" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "leida_at" TIMESTAMPTZ(3) NOT NULL,
    "recibida_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "polizas_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos_inventario" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "poliza_id" UUID NOT NULL,
    "renglon" INTEGER NOT NULL,
    "almacen_origen_sr_id" TEXT NOT NULL,
    "insumo_origen_sr_id" TEXT NOT NULL,
    "fecha" TIMESTAMPTZ(3) NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "costo_unitario" DECIMAL(12,2) NOT NULL,
    "importe" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "movimientos_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "polizas_inventario_empresa_id_idx" ON "polizas_inventario"("empresa_id");

-- CreateIndex
CREATE INDEX "polizas_inventario_sucursal_id_fecha_idx" ON "polizas_inventario"("sucursal_id", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "polizas_inventario_sucursal_origen_key" ON "polizas_inventario"("sucursal_id", "origen_sr_id");

-- CreateIndex
CREATE UNIQUE INDEX "polizas_inventario_id_sucursal_empresa_key" ON "polizas_inventario"("id", "sucursal_id", "empresa_id");

-- CreateIndex
CREATE INDEX "movimientos_inventario_empresa_id_idx" ON "movimientos_inventario"("empresa_id");

-- CreateIndex
CREATE INDEX "movimientos_inventario_kardex_idx" ON "movimientos_inventario"("sucursal_id", "almacen_origen_sr_id", "insumo_origen_sr_id", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "movimientos_inventario_poliza_renglon_key" ON "movimientos_inventario"("poliza_id", "renglon");

-- AddForeignKey
ALTER TABLE "polizas_inventario" ADD CONSTRAINT "polizas_inventario_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_poliza_fkey" FOREIGN KEY ("poliza_id", "sucursal_id", "empresa_id") REFERENCES "polizas_inventario"("id", "sucursal_id", "empresa_id") ON DELETE CASCADE ON UPDATE CASCADE;




-- CHECKs escritos a mano (F2-122): Prisma no los modela.
ALTER TABLE "polizas_inventario" ADD CONSTRAINT "polizas_inventario_origen_sr_id_chk" CHECK (length("origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "polizas_inventario" ADD CONSTRAINT "polizas_inventario_folio_chk" CHECK (length("folio") BETWEEN 1 AND 64);
ALTER TABLE "polizas_inventario" ADD CONSTRAINT "polizas_inventario_tipo_sr_chk" CHECK ("tipo_sr" IS NULL OR length("tipo_sr") BETWEEN 1 AND 64);
ALTER TABLE "polizas_inventario" ADD CONSTRAINT "polizas_inventario_almacen_origen_sr_id_chk" CHECK (length("almacen_origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "polizas_inventario" ADD CONSTRAINT "polizas_inventario_referencia_chk" CHECK ("referencia" IS NULL OR length("referencia") BETWEEN 1 AND 120);
ALTER TABLE "polizas_inventario" ADD CONSTRAINT "polizas_inventario_partidas_chk" CHECK ("partidas" >= 0);
ALTER TABLE "polizas_inventario" ADD CONSTRAINT "polizas_inventario_hash_chk" CHECK ("hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_renglon_chk" CHECK ("renglon" >= 0);
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_almacen_origen_sr_id_chk" CHECK (length("almacen_origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_insumo_origen_sr_id_chk" CHECK (length("insumo_origen_sr_id") BETWEEN 1 AND 64);
