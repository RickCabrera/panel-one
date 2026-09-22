-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "catalogo_sr" ADD VALUE 'unidades';
ALTER TYPE "catalogo_sr" ADD VALUE 'grupos_insumo';
ALTER TYPE "catalogo_sr" ADD VALUE 'insumos';
ALTER TYPE "catalogo_sr" ADD VALUE 'almacenes';
ALTER TYPE "catalogo_sr" ADD VALUE 'proveedores';

-- CreateTable
CREATE TABLE "unidades_catalogo" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "origen_sr_id" TEXT NOT NULL,
    "clave" TEXT,
    "nombre" TEXT NOT NULL,
    "activo_pos" BOOLEAN,
    "hash" CHAR(64) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "visto_at" TIMESTAMPTZ(3) NOT NULL,
    "sincronizacion_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "unidades_catalogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grupos_insumo" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "origen_sr_id" TEXT NOT NULL,
    "clave" TEXT,
    "nombre" TEXT NOT NULL,
    "activo_pos" BOOLEAN,
    "hash" CHAR(64) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "visto_at" TIMESTAMPTZ(3) NOT NULL,
    "sincronizacion_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "grupos_insumo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insumos" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "origen_sr_id" TEXT NOT NULL,
    "clave" TEXT,
    "nombre" TEXT NOT NULL,
    "grupo_origen_sr_id" TEXT,
    "unidad_origen_sr_id" TEXT,
    "activo_pos" BOOLEAN,
    "hash" CHAR(64) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "visto_at" TIMESTAMPTZ(3) NOT NULL,
    "sincronizacion_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "insumos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "almacenes_catalogo" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "origen_sr_id" TEXT NOT NULL,
    "clave" TEXT,
    "nombre" TEXT NOT NULL,
    "activo_pos" BOOLEAN,
    "hash" CHAR(64) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "visto_at" TIMESTAMPTZ(3) NOT NULL,
    "sincronizacion_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "almacenes_catalogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proveedores_catalogo" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "origen_sr_id" TEXT NOT NULL,
    "clave" TEXT,
    "nombre" TEXT NOT NULL,
    "activo_pos" BOOLEAN,
    "hash" CHAR(64) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "visto_at" TIMESTAMPTZ(3) NOT NULL,
    "sincronizacion_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "proveedores_catalogo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unidades_catalogo_empresa_id_idx" ON "unidades_catalogo"("empresa_id");

-- CreateIndex
CREATE INDEX "unidades_catalogo_sucursal_id_sincronizacion_id_idx" ON "unidades_catalogo"("sucursal_id", "sincronizacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "unidades_catalogo_sucursal_id_origen_sr_id_key" ON "unidades_catalogo"("sucursal_id", "origen_sr_id");

-- CreateIndex
CREATE INDEX "grupos_insumo_empresa_id_idx" ON "grupos_insumo"("empresa_id");

-- CreateIndex
CREATE INDEX "grupos_insumo_sucursal_id_sincronizacion_id_idx" ON "grupos_insumo"("sucursal_id", "sincronizacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "grupos_insumo_sucursal_id_origen_sr_id_key" ON "grupos_insumo"("sucursal_id", "origen_sr_id");

-- CreateIndex
CREATE INDEX "insumos_empresa_id_idx" ON "insumos"("empresa_id");

-- CreateIndex
CREATE INDEX "insumos_sucursal_id_sincronizacion_id_idx" ON "insumos"("sucursal_id", "sincronizacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "insumos_sucursal_id_origen_sr_id_key" ON "insumos"("sucursal_id", "origen_sr_id");

-- CreateIndex
CREATE INDEX "almacenes_catalogo_empresa_id_idx" ON "almacenes_catalogo"("empresa_id");

-- CreateIndex
CREATE INDEX "almacenes_catalogo_sucursal_id_sincronizacion_id_idx" ON "almacenes_catalogo"("sucursal_id", "sincronizacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "almacenes_catalogo_sucursal_id_origen_sr_id_key" ON "almacenes_catalogo"("sucursal_id", "origen_sr_id");

-- CreateIndex
CREATE INDEX "proveedores_catalogo_empresa_id_idx" ON "proveedores_catalogo"("empresa_id");

-- CreateIndex
CREATE INDEX "proveedores_catalogo_sucursal_id_sincronizacion_id_idx" ON "proveedores_catalogo"("sucursal_id", "sincronizacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "proveedores_catalogo_sucursal_id_origen_sr_id_key" ON "proveedores_catalogo"("sucursal_id", "origen_sr_id");

-- AddForeignKey
ALTER TABLE "unidades_catalogo" ADD CONSTRAINT "unidades_catalogo_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grupos_insumo" ADD CONSTRAINT "grupos_insumo_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insumos" ADD CONSTRAINT "insumos_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "almacenes_catalogo" ADD CONSTRAINT "almacenes_catalogo_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proveedores_catalogo" ADD CONSTRAINT "proveedores_catalogo_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECKs escritos a mano (F2-120), como los de F2-230: Prisma no los modela.
ALTER TABLE "unidades_catalogo" ADD CONSTRAINT "unidades_catalogo_origen_sr_id_chk" CHECK (length("origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "unidades_catalogo" ADD CONSTRAINT "unidades_catalogo_nombre_chk" CHECK (length("nombre") BETWEEN 1 AND 200);
ALTER TABLE "unidades_catalogo" ADD CONSTRAINT "unidades_catalogo_hash_chk" CHECK ("hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "grupos_insumo" ADD CONSTRAINT "grupos_insumo_origen_sr_id_chk" CHECK (length("origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "grupos_insumo" ADD CONSTRAINT "grupos_insumo_nombre_chk" CHECK (length("nombre") BETWEEN 1 AND 200);
ALTER TABLE "grupos_insumo" ADD CONSTRAINT "grupos_insumo_hash_chk" CHECK ("hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "insumos" ADD CONSTRAINT "insumos_origen_sr_id_chk" CHECK (length("origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "insumos" ADD CONSTRAINT "insumos_nombre_chk" CHECK (length("nombre") BETWEEN 1 AND 200);
ALTER TABLE "insumos" ADD CONSTRAINT "insumos_hash_chk" CHECK ("hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "almacenes_catalogo" ADD CONSTRAINT "almacenes_catalogo_origen_sr_id_chk" CHECK (length("origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "almacenes_catalogo" ADD CONSTRAINT "almacenes_catalogo_nombre_chk" CHECK (length("nombre") BETWEEN 1 AND 200);
ALTER TABLE "almacenes_catalogo" ADD CONSTRAINT "almacenes_catalogo_hash_chk" CHECK ("hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "proveedores_catalogo" ADD CONSTRAINT "proveedores_catalogo_origen_sr_id_chk" CHECK (length("origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "proveedores_catalogo" ADD CONSTRAINT "proveedores_catalogo_nombre_chk" CHECK (length("nombre") BETWEEN 1 AND 200);
ALTER TABLE "proveedores_catalogo" ADD CONSTRAINT "proveedores_catalogo_hash_chk" CHECK ("hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "insumos" ADD CONSTRAINT "insumos_grupo_origen_sr_id_chk" CHECK ("grupo_origen_sr_id" IS NULL OR length("grupo_origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "insumos" ADD CONSTRAINT "insumos_unidad_origen_sr_id_chk" CHECK ("unidad_origen_sr_id" IS NULL OR length("unidad_origen_sr_id") BETWEEN 1 AND 64);
