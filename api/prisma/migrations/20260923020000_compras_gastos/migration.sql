-- CreateTable
CREATE TABLE "compras" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "origen_sr_id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "proveedor_origen_sr_id" TEXT,
    "almacen_origen_sr_id" TEXT,
    "fecha" TIMESTAMPTZ(3) NOT NULL,
    "cancelada" BOOLEAN NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "partidas" INTEGER NOT NULL,
    "hash" CHAR(64) NOT NULL,
    "leida_at" TIMESTAMPTZ(3) NOT NULL,
    "recibida_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "compras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partidas_compra" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "compra_id" UUID NOT NULL,
    "renglon" INTEGER NOT NULL,
    "insumo_origen_sr_id" TEXT NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "costo_unitario" DECIMAL(12,2) NOT NULL,
    "importe" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "partidas_compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias_gasto" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "nombre_clave" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categorias_gasto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gastos" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "categoria_id" UUID NOT NULL,
    "dia" DATE NOT NULL,
    "concepto" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "folio" TEXT,
    "creado_por" UUID,
    "creado_at" TIMESTAMPTZ(3) NOT NULL,
    "actualizado_por" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "anulado_por" UUID,
    "anulado_at" TIMESTAMPTZ(3),

    CONSTRAINT "gastos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "compras_empresa_id_idx" ON "compras"("empresa_id");

-- CreateIndex
CREATE INDEX "compras_sucursal_id_fecha_idx" ON "compras"("sucursal_id", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "compras_sucursal_origen_key" ON "compras"("sucursal_id", "origen_sr_id");

-- CreateIndex
CREATE UNIQUE INDEX "compras_id_sucursal_empresa_key" ON "compras"("id", "sucursal_id", "empresa_id");

-- CreateIndex
CREATE INDEX "partidas_compra_empresa_id_idx" ON "partidas_compra"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "partidas_compra_compra_renglon_key" ON "partidas_compra"("compra_id", "renglon");

-- CreateIndex
CREATE INDEX "categorias_gasto_empresa_id_idx" ON "categorias_gasto"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_gasto_empresa_nombre_key" ON "categorias_gasto"("empresa_id", "nombre_clave");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_gasto_id_empresa_key" ON "categorias_gasto"("id", "empresa_id");

-- CreateIndex
CREATE INDEX "gastos_empresa_id_idx" ON "gastos"("empresa_id");

-- CreateIndex
CREATE INDEX "gastos_sucursal_id_dia_idx" ON "gastos"("sucursal_id", "dia");

-- CreateIndex
CREATE UNIQUE INDEX "gastos_sucursal_folio_key" ON "gastos"("sucursal_id", "folio");

-- AddForeignKey
ALTER TABLE "compras" ADD CONSTRAINT "compras_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partidas_compra" ADD CONSTRAINT "partidas_compra_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partidas_compra" ADD CONSTRAINT "partidas_compra_compra_fkey" FOREIGN KEY ("compra_id", "sucursal_id", "empresa_id") REFERENCES "compras"("id", "sucursal_id", "empresa_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias_gasto" ADD CONSTRAINT "categorias_gasto_empresa_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_categoria_empresa_fkey" FOREIGN KEY ("categoria_id", "empresa_id") REFERENCES "categorias_gasto"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECKs escritos a mano (F2-126): Prisma no los modela.
ALTER TABLE "compras" ADD CONSTRAINT "compras_origen_sr_id_chk" CHECK (length("origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "compras" ADD CONSTRAINT "compras_folio_chk" CHECK (length("folio") BETWEEN 1 AND 64);
ALTER TABLE "compras" ADD CONSTRAINT "compras_proveedor_chk" CHECK ("proveedor_origen_sr_id" IS NULL OR length("proveedor_origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "compras" ADD CONSTRAINT "compras_almacen_chk" CHECK ("almacen_origen_sr_id" IS NULL OR length("almacen_origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "compras" ADD CONSTRAINT "compras_total_chk" CHECK ("total" >= 0);
ALTER TABLE "compras" ADD CONSTRAINT "compras_partidas_chk" CHECK ("partidas" >= 0);
ALTER TABLE "compras" ADD CONSTRAINT "compras_hash_chk" CHECK ("hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "partidas_compra" ADD CONSTRAINT "partidas_compra_insumo_origen_sr_id_chk" CHECK (length("insumo_origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "partidas_compra" ADD CONSTRAINT "partidas_compra_renglon_chk" CHECK ("renglon" >= 0);
ALTER TABLE "partidas_compra" ADD CONSTRAINT "partidas_compra_cantidad_chk" CHECK ("cantidad" > 0);
ALTER TABLE "partidas_compra" ADD CONSTRAINT "partidas_compra_costo_chk" CHECK ("costo_unitario" >= 0);
ALTER TABLE "partidas_compra" ADD CONSTRAINT "partidas_compra_importe_chk" CHECK ("importe" >= 0);
ALTER TABLE "categorias_gasto" ADD CONSTRAINT "categorias_gasto_nombre_chk" CHECK (length(btrim("nombre")) BETWEEN 1 AND 60);
ALTER TABLE "categorias_gasto" ADD CONSTRAINT "categorias_gasto_nombre_clave_chk" CHECK (length("nombre_clave") BETWEEN 1 AND 60 AND "nombre_clave" = lower("nombre_clave"));
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_concepto_chk" CHECK (length(btrim("concepto")) BETWEEN 1 AND 200);
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_monto_chk" CHECK ("monto" > 0);
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_folio_chk" CHECK ("folio" IS NULL OR length("folio") BETWEEN 1 AND 64);
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_anulado_chk" CHECK (("anulado_at" IS NULL) = ("anulado_por" IS NULL) OR ("anulado_at" IS NOT NULL AND "anulado_por" IS NULL));
