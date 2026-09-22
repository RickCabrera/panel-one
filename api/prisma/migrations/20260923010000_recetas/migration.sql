-- CreateTable
CREATE TABLE "recetas" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "producto_origen_sr_id" TEXT NOT NULL,
    "renglones" INTEGER NOT NULL,
    "hash" CHAR(64) NOT NULL,
    "leida_at" TIMESTAMPTZ(3) NOT NULL,
    "recibida_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recetas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renglones_receta" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "receta_id" UUID NOT NULL,
    "renglon" INTEGER NOT NULL,
    "insumo_origen_sr_id" TEXT NOT NULL,
    "cantidad" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "renglones_receta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recetas_empresa_id_idx" ON "recetas"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "recetas_sucursal_producto_key" ON "recetas"("sucursal_id", "producto_origen_sr_id");

-- CreateIndex
CREATE UNIQUE INDEX "recetas_id_sucursal_empresa_key" ON "recetas"("id", "sucursal_id", "empresa_id");

-- CreateIndex
CREATE INDEX "renglones_receta_empresa_id_idx" ON "renglones_receta"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "renglones_receta_receta_renglon_key" ON "renglones_receta"("receta_id", "renglon");

-- AddForeignKey
ALTER TABLE "recetas" ADD CONSTRAINT "recetas_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renglones_receta" ADD CONSTRAINT "renglones_receta_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renglones_receta" ADD CONSTRAINT "renglones_receta_receta_fkey" FOREIGN KEY ("receta_id", "sucursal_id", "empresa_id") REFERENCES "recetas"("id", "sucursal_id", "empresa_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CHECKs escritos a mano (F2-125): Prisma no los modela.
ALTER TABLE "recetas" ADD CONSTRAINT "recetas_producto_origen_sr_id_chk" CHECK (length("producto_origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "recetas" ADD CONSTRAINT "recetas_renglones_chk" CHECK ("renglones" >= 0);
ALTER TABLE "recetas" ADD CONSTRAINT "recetas_hash_chk" CHECK ("hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "renglones_receta" ADD CONSTRAINT "renglones_receta_insumo_origen_sr_id_chk" CHECK (length("insumo_origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "renglones_receta" ADD CONSTRAINT "renglones_receta_renglon_chk" CHECK ("renglon" >= 0);
ALTER TABLE "renglones_receta" ADD CONSTRAINT "renglones_receta_cantidad_chk" CHECK ("cantidad" >= 0);
