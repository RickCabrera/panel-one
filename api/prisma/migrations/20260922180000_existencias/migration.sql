-- AlterEnum
ALTER TYPE "tipo_alerta" ADD VALUE 'bajo_minimo';

-- CreateTable
CREATE TABLE "existencias" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "almacen_origen_sr_id" TEXT NOT NULL,
    "insumo_origen_sr_id" TEXT NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "costo_promedio" DECIMAL(12,2) NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "existencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lecturas_existencias" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "almacen_origen_sr_id" TEXT NOT NULL,
    "capturado_at" TIMESTAMPTZ(3) NOT NULL,
    "recibida_at" TIMESTAMPTZ(3) NOT NULL,
    "filas" INTEGER NOT NULL,

    CONSTRAINT "lecturas_existencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "limites_existencia" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "almacen_origen_sr_id" TEXT NOT NULL,
    "insumo_origen_sr_id" TEXT NOT NULL,
    "minimo" DECIMAL(12,3),
    "maximo" DECIMAL(12,3),
    "actualizado_por" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "limites_existencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "existencias_empresa_id_idx" ON "existencias"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "existencias_sucursal_almacen_insumo_key" ON "existencias"("sucursal_id", "almacen_origen_sr_id", "insumo_origen_sr_id");

-- CreateIndex
CREATE INDEX "lecturas_existencias_empresa_id_idx" ON "lecturas_existencias"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "lecturas_existencias_sucursal_almacen_key" ON "lecturas_existencias"("sucursal_id", "almacen_origen_sr_id");

-- CreateIndex
CREATE INDEX "limites_existencia_empresa_id_idx" ON "limites_existencia"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "limites_existencia_sucursal_almacen_insumo_key" ON "limites_existencia"("sucursal_id", "almacen_origen_sr_id", "insumo_origen_sr_id");

-- AddForeignKey
ALTER TABLE "existencias" ADD CONSTRAINT "existencias_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lecturas_existencias" ADD CONSTRAINT "lecturas_existencias_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "limites_existencia" ADD CONSTRAINT "limites_existencia_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- CHECKs escritos a mano (F2-121): Prisma no los modela.
ALTER TABLE "existencias" ADD CONSTRAINT "existencias_almacen_origen_sr_id_chk" CHECK (length("almacen_origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "existencias" ADD CONSTRAINT "existencias_insumo_origen_sr_id_chk" CHECK (length("insumo_origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "lecturas_existencias" ADD CONSTRAINT "lecturas_existencias_almacen_origen_sr_id_chk" CHECK (length("almacen_origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "lecturas_existencias" ADD CONSTRAINT "lecturas_existencias_filas_chk" CHECK ("filas" >= 0);
ALTER TABLE "limites_existencia" ADD CONSTRAINT "limites_existencia_almacen_origen_sr_id_chk" CHECK (length("almacen_origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "limites_existencia" ADD CONSTRAINT "limites_existencia_insumo_origen_sr_id_chk" CHECK (length("insumo_origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "limites_existencia" ADD CONSTRAINT "limites_existencia_minimo_chk" CHECK ("minimo" IS NULL OR "minimo" >= 0);
ALTER TABLE "limites_existencia" ADD CONSTRAINT "limites_existencia_maximo_chk" CHECK ("maximo" IS NULL OR "maximo" >= 0);
ALTER TABLE "limites_existencia" ADD CONSTRAINT "limites_existencia_minimo_maximo_chk" CHECK ("minimo" IS NULL OR "maximo" IS NULL OR "minimo" <= "maximo");
ALTER TABLE "limites_existencia" ADD CONSTRAINT "limites_existencia_alguno_chk" CHECK ("minimo" IS NOT NULL OR "maximo" IS NOT NULL);
