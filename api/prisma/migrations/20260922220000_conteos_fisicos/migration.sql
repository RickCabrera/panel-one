-- CreateEnum
CREATE TYPE "estado_conteo" AS ENUM ('en_captura', 'cerrado', 'cancelado');

-- CreateTable
CREATE TABLE "conteos_fisicos" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "folio" INTEGER NOT NULL,
    "almacen_origen_sr_id" TEXT NOT NULL,
    "grupo_origen_sr_id" TEXT,
    "nota" TEXT,
    "estado" "estado_conteo" NOT NULL DEFAULT 'en_captura',
    "teorico_capturado_at" TIMESTAMPTZ(3) NOT NULL,
    "creado_por" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerrado_por" UUID,
    "cerrado_at" TIMESTAMPTZ(3),
    "cancelado_por" UUID,
    "cancelado_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conteos_fisicos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partidas_conteo" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "conteo_id" UUID NOT NULL,
    "insumo_origen_sr_id" TEXT NOT NULL,
    "teorico" DECIMAL(12,3),
    "costo_promedio" DECIMAL(12,2),
    "contado" DECIMAL(12,3),
    "capturado_por" UUID,
    "capturado_at" TIMESTAMPTZ(3),

    CONSTRAINT "partidas_conteo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conteos_fisicos_empresa_id_idx" ON "conteos_fisicos"("empresa_id");

-- CreateIndex
CREATE INDEX "conteos_fisicos_sucursal_id_estado_idx" ON "conteos_fisicos"("sucursal_id", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "conteos_fisicos_sucursal_folio_key" ON "conteos_fisicos"("sucursal_id", "folio");

-- CreateIndex
CREATE UNIQUE INDEX "conteos_fisicos_id_sucursal_empresa_key" ON "conteos_fisicos"("id", "sucursal_id", "empresa_id");

-- CreateIndex
CREATE INDEX "partidas_conteo_empresa_id_idx" ON "partidas_conteo"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "partidas_conteo_conteo_insumo_key" ON "partidas_conteo"("conteo_id", "insumo_origen_sr_id");

-- AddForeignKey
ALTER TABLE "conteos_fisicos" ADD CONSTRAINT "conteos_fisicos_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partidas_conteo" ADD CONSTRAINT "partidas_conteo_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partidas_conteo" ADD CONSTRAINT "partidas_conteo_conteo_fkey" FOREIGN KEY ("conteo_id", "sucursal_id", "empresa_id") REFERENCES "conteos_fisicos"("id", "sucursal_id", "empresa_id") ON DELETE CASCADE ON UPDATE CASCADE;




-- CHECKs escritos a mano (F2-123): Prisma no los modela.
ALTER TABLE "conteos_fisicos" ADD CONSTRAINT "conteos_fisicos_folio_chk" CHECK ("folio" > 0);
ALTER TABLE "conteos_fisicos" ADD CONSTRAINT "conteos_fisicos_almacen_origen_sr_id_chk" CHECK (length("almacen_origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "conteos_fisicos" ADD CONSTRAINT "conteos_fisicos_grupo_origen_sr_id_chk" CHECK ("grupo_origen_sr_id" IS NULL OR length("grupo_origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "conteos_fisicos" ADD CONSTRAINT "conteos_fisicos_nota_chk" CHECK ("nota" IS NULL OR length("nota") BETWEEN 1 AND 200);
-- Cerrado ⇔ sus dos marcas de cierre; cancelado ⇔ las suyas. Nunca las dos.
ALTER TABLE "conteos_fisicos" ADD CONSTRAINT "conteos_fisicos_cerrado_chk" CHECK (("estado" = 'cerrado') = ("cerrado_at" IS NOT NULL AND "cerrado_por" IS NOT NULL) AND ("cerrado_at" IS NULL) = ("cerrado_por" IS NULL));
ALTER TABLE "conteos_fisicos" ADD CONSTRAINT "conteos_fisicos_cancelado_chk" CHECK (("estado" = 'cancelado') = ("cancelado_at" IS NOT NULL AND "cancelado_por" IS NOT NULL) AND ("cancelado_at" IS NULL) = ("cancelado_por" IS NULL));
ALTER TABLE "partidas_conteo" ADD CONSTRAINT "partidas_conteo_insumo_origen_sr_id_chk" CHECK (length("insumo_origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "partidas_conteo" ADD CONSTRAINT "partidas_conteo_contado_chk" CHECK ("contado" IS NULL OR "contado" >= 0);
ALTER TABLE "partidas_conteo" ADD CONSTRAINT "partidas_conteo_costo_promedio_chk" CHECK ("costo_promedio" IS NULL OR "costo_promedio" >= 0);
-- Teórico y costo salen de la misma foto: los dos o ninguno.
ALTER TABLE "partidas_conteo" ADD CONSTRAINT "partidas_conteo_teorico_costo_chk" CHECK (("teorico" IS NULL) = ("costo_promedio" IS NULL));
-- Capturado ⇔ quién y cuándo.
ALTER TABLE "partidas_conteo" ADD CONSTRAINT "partidas_conteo_captura_chk" CHECK (("capturado_at" IS NULL) = ("capturado_por" IS NULL));
