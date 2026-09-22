-- CreateEnum
CREATE TYPE "catalogo_sr" AS ENUM ('grupos', 'productos', 'meseros', 'clientes', 'areas', 'canales');

-- CreateTable
CREATE TABLE "grupos_producto" (
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

    CONSTRAINT "grupos_producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productos" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "origen_sr_id" TEXT NOT NULL,
    "clave" TEXT,
    "nombre" TEXT NOT NULL,
    "grupo_origen_sr_id" TEXT,
    "activo_pos" BOOLEAN,
    "hash" CHAR(64) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "visto_at" TIMESTAMPTZ(3) NOT NULL,
    "sincronizacion_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "productos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meseros_catalogo" (
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

    CONSTRAINT "meseros_catalogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes_catalogo" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "origen_sr_id" TEXT NOT NULL,
    "clave" TEXT,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT,
    "correo" TEXT,
    "rfc" TEXT,
    "activo_pos" BOOLEAN,
    "hash" CHAR(64) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "visto_at" TIMESTAMPTZ(3) NOT NULL,
    "sincronizacion_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clientes_catalogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas_catalogo" (
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

    CONSTRAINT "areas_catalogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canales_venta_catalogo" (
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

    CONSTRAINT "canales_venta_catalogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productos_metadata" (
    "producto_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "descripcion" TEXT,
    "foto_url" TEXT,
    "etiquetas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minimo" DECIMAL(12,3),
    "maximo" DECIMAL(12,3),
    "actualizado_por" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "productos_metadata_pkey" PRIMARY KEY ("producto_id")
);

-- CreateTable
CREATE TABLE "sincronizaciones_catalogo" (
    "sucursal_id" UUID NOT NULL,
    "catalogo" "catalogo_sr" NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sincronizacion_id" UUID NOT NULL,
    "ultima_completa_at" TIMESTAMPTZ(3) NOT NULL,
    "total" INTEGER NOT NULL,
    "rechazados" INTEGER NOT NULL,
    "desactivados" INTEGER NOT NULL,
    "recibida_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sincronizaciones_catalogo_pkey" PRIMARY KEY ("sucursal_id","catalogo")
);

-- CreateTable
CREATE TABLE "solicitudes_sincronizacion" (
    "sucursal_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "solicitada_at" TIMESTAMPTZ(3) NOT NULL,
    "solicitada_por" UUID NOT NULL,

    CONSTRAINT "solicitudes_sincronizacion_pkey" PRIMARY KEY ("sucursal_id")
);

-- CreateIndex
CREATE INDEX "grupos_producto_empresa_id_idx" ON "grupos_producto"("empresa_id");

-- CreateIndex
CREATE INDEX "grupos_producto_sucursal_id_sincronizacion_id_idx" ON "grupos_producto"("sucursal_id", "sincronizacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "grupos_producto_sucursal_id_origen_sr_id_key" ON "grupos_producto"("sucursal_id", "origen_sr_id");

-- CreateIndex
CREATE INDEX "productos_empresa_id_idx" ON "productos"("empresa_id");

-- CreateIndex
CREATE INDEX "productos_sucursal_id_sincronizacion_id_idx" ON "productos"("sucursal_id", "sincronizacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "productos_sucursal_id_origen_sr_id_key" ON "productos"("sucursal_id", "origen_sr_id");

-- CreateIndex
CREATE UNIQUE INDEX "productos_id_empresa_id_key" ON "productos"("id", "empresa_id");

-- CreateIndex
CREATE INDEX "meseros_catalogo_empresa_id_idx" ON "meseros_catalogo"("empresa_id");

-- CreateIndex
CREATE INDEX "meseros_catalogo_sucursal_id_sincronizacion_id_idx" ON "meseros_catalogo"("sucursal_id", "sincronizacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "meseros_catalogo_sucursal_id_origen_sr_id_key" ON "meseros_catalogo"("sucursal_id", "origen_sr_id");

-- CreateIndex
CREATE INDEX "clientes_catalogo_empresa_id_idx" ON "clientes_catalogo"("empresa_id");

-- CreateIndex
CREATE INDEX "clientes_catalogo_sucursal_id_sincronizacion_id_idx" ON "clientes_catalogo"("sucursal_id", "sincronizacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_catalogo_sucursal_id_origen_sr_id_key" ON "clientes_catalogo"("sucursal_id", "origen_sr_id");

-- CreateIndex
CREATE INDEX "areas_catalogo_empresa_id_idx" ON "areas_catalogo"("empresa_id");

-- CreateIndex
CREATE INDEX "areas_catalogo_sucursal_id_sincronizacion_id_idx" ON "areas_catalogo"("sucursal_id", "sincronizacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "areas_catalogo_sucursal_id_origen_sr_id_key" ON "areas_catalogo"("sucursal_id", "origen_sr_id");

-- CreateIndex
CREATE INDEX "canales_venta_catalogo_empresa_id_idx" ON "canales_venta_catalogo"("empresa_id");

-- CreateIndex
CREATE INDEX "canales_venta_catalogo_sucursal_id_sincronizacion_id_idx" ON "canales_venta_catalogo"("sucursal_id", "sincronizacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "canales_venta_catalogo_sucursal_id_origen_sr_id_key" ON "canales_venta_catalogo"("sucursal_id", "origen_sr_id");

-- CreateIndex
CREATE INDEX "productos_metadata_empresa_id_idx" ON "productos_metadata"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "productos_metadata_producto_id_empresa_id_key" ON "productos_metadata"("producto_id", "empresa_id");

-- CreateIndex
CREATE INDEX "sincronizaciones_catalogo_empresa_id_idx" ON "sincronizaciones_catalogo"("empresa_id");

-- CreateIndex
CREATE INDEX "solicitudes_sincronizacion_empresa_id_idx" ON "solicitudes_sincronizacion"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "solicitudes_sincronizacion_sucursal_id_empresa_id_key" ON "solicitudes_sincronizacion"("sucursal_id", "empresa_id");

-- AddForeignKey
ALTER TABLE "grupos_producto" ADD CONSTRAINT "grupos_producto_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos" ADD CONSTRAINT "productos_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meseros_catalogo" ADD CONSTRAINT "meseros_catalogo_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes_catalogo" ADD CONSTRAINT "clientes_catalogo_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas_catalogo" ADD CONSTRAINT "areas_catalogo_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canales_venta_catalogo" ADD CONSTRAINT "canales_venta_catalogo_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos_metadata" ADD CONSTRAINT "productos_metadata_producto_empresa_fkey" FOREIGN KEY ("producto_id", "empresa_id") REFERENCES "productos"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sincronizaciones_catalogo" ADD CONSTRAINT "sincronizaciones_catalogo_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_sincronizacion" ADD CONSTRAINT "solicitudes_sincronizacion_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECKs escritos a mano (F2-230): Prisma no los modela.
ALTER TABLE "grupos_producto" ADD CONSTRAINT "grupos_producto_origen_sr_id_chk" CHECK (length("origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "grupos_producto" ADD CONSTRAINT "grupos_producto_nombre_chk" CHECK (length("nombre") BETWEEN 1 AND 200);
ALTER TABLE "grupos_producto" ADD CONSTRAINT "grupos_producto_hash_chk" CHECK ("hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "productos" ADD CONSTRAINT "productos_origen_sr_id_chk" CHECK (length("origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "productos" ADD CONSTRAINT "productos_nombre_chk" CHECK (length("nombre") BETWEEN 1 AND 200);
ALTER TABLE "productos" ADD CONSTRAINT "productos_hash_chk" CHECK ("hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "meseros_catalogo" ADD CONSTRAINT "meseros_catalogo_origen_sr_id_chk" CHECK (length("origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "meseros_catalogo" ADD CONSTRAINT "meseros_catalogo_nombre_chk" CHECK (length("nombre") BETWEEN 1 AND 200);
ALTER TABLE "meseros_catalogo" ADD CONSTRAINT "meseros_catalogo_hash_chk" CHECK ("hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "clientes_catalogo" ADD CONSTRAINT "clientes_catalogo_origen_sr_id_chk" CHECK (length("origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "clientes_catalogo" ADD CONSTRAINT "clientes_catalogo_nombre_chk" CHECK (length("nombre") BETWEEN 1 AND 200);
ALTER TABLE "clientes_catalogo" ADD CONSTRAINT "clientes_catalogo_hash_chk" CHECK ("hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "areas_catalogo" ADD CONSTRAINT "areas_catalogo_origen_sr_id_chk" CHECK (length("origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "areas_catalogo" ADD CONSTRAINT "areas_catalogo_nombre_chk" CHECK (length("nombre") BETWEEN 1 AND 200);
ALTER TABLE "areas_catalogo" ADD CONSTRAINT "areas_catalogo_hash_chk" CHECK ("hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "canales_venta_catalogo" ADD CONSTRAINT "canales_venta_catalogo_origen_sr_id_chk" CHECK (length("origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "canales_venta_catalogo" ADD CONSTRAINT "canales_venta_catalogo_nombre_chk" CHECK (length("nombre") BETWEEN 1 AND 200);
ALTER TABLE "canales_venta_catalogo" ADD CONSTRAINT "canales_venta_catalogo_hash_chk" CHECK ("hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "productos_metadata" ADD CONSTRAINT "productos_metadata_minimo_chk" CHECK ("minimo" IS NULL OR "minimo" >= 0);
ALTER TABLE "productos_metadata" ADD CONSTRAINT "productos_metadata_maximo_chk" CHECK ("maximo" IS NULL OR "maximo" >= 0);
ALTER TABLE "productos_metadata" ADD CONSTRAINT "productos_metadata_rango_chk" CHECK ("minimo" IS NULL OR "maximo" IS NULL OR "minimo" <= "maximo");
ALTER TABLE "productos_metadata" ADD CONSTRAINT "productos_metadata_etiquetas_chk" CHECK (cardinality("etiquetas") <= 20);
ALTER TABLE "sincronizaciones_catalogo" ADD CONSTRAINT "sincronizaciones_catalogo_conteos_chk" CHECK ("total" >= 0 AND "rechazados" >= 0 AND "rechazados" <= "total" AND "desactivados" >= 0);
