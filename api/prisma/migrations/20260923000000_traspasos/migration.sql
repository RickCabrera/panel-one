-- CreateEnum
CREATE TYPE "estado_traspaso" AS ENUM ('enviado', 'recibido', 'cancelado');

-- AlterEnum
ALTER TYPE "tipo_alerta" ADD VALUE 'traspaso_sin_conciliar';

-- CreateTable
CREATE TABLE "traspasos" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "folio" INTEGER NOT NULL,
    "almacen_origen_sr_id" TEXT NOT NULL,
    "sucursal_destino_id" UUID NOT NULL,
    "almacen_destino_sr_id" TEXT NOT NULL,
    "nota" TEXT,
    "estado" "estado_traspaso" NOT NULL DEFAULT 'enviado',
    "enviado_por" UUID NOT NULL,
    "enviado_at" TIMESTAMPTZ(3) NOT NULL,
    "recibido_por" UUID,
    "recibido_at" TIMESTAMPTZ(3),
    "cancelado_por" UUID,
    "cancelado_at" TIMESTAMPTZ(3),
    "conciliado_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "traspasos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partidas_traspaso" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "sucursal_destino_id" UUID NOT NULL,
    "traspaso_id" UUID NOT NULL,
    "insumo_origen_sr_id" TEXT NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "costo_unitario" DECIMAL(12,2),
    "poliza_salida_id" UUID,
    "renglon_salida" INTEGER,
    "poliza_entrada_id" UUID,
    "renglon_entrada" INTEGER,

    CONSTRAINT "partidas_traspaso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "traspasos_sucursal_id_estado_idx" ON "traspasos"("sucursal_id", "estado");

-- CreateIndex
CREATE INDEX "traspasos_sucursal_destino_id_idx" ON "traspasos"("sucursal_destino_id");

-- CreateIndex
CREATE UNIQUE INDEX "traspasos_empresa_folio_key" ON "traspasos"("empresa_id", "folio");

-- CreateIndex
CREATE UNIQUE INDEX "traspasos_id_sucursales_empresa_key" ON "traspasos"("id", "sucursal_id", "sucursal_destino_id", "empresa_id");

-- CreateIndex
CREATE INDEX "partidas_traspaso_empresa_id_idx" ON "partidas_traspaso"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "partidas_traspaso_traspaso_insumo_key" ON "partidas_traspaso"("traspaso_id", "insumo_origen_sr_id");

-- CreateIndex
CREATE UNIQUE INDEX "partidas_traspaso_espejo_salida_key" ON "partidas_traspaso"("poliza_salida_id", "renglon_salida");

-- CreateIndex
CREATE UNIQUE INDEX "partidas_traspaso_espejo_entrada_key" ON "partidas_traspaso"("poliza_entrada_id", "renglon_entrada");

-- AddForeignKey
ALTER TABLE "traspasos" ADD CONSTRAINT "traspasos_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traspasos" ADD CONSTRAINT "traspasos_sucursal_destino_empresa_fkey" FOREIGN KEY ("sucursal_destino_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partidas_traspaso" ADD CONSTRAINT "partidas_traspaso_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partidas_traspaso" ADD CONSTRAINT "partidas_traspaso_sucursal_destino_empresa_fkey" FOREIGN KEY ("sucursal_destino_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partidas_traspaso" ADD CONSTRAINT "partidas_traspaso_traspaso_fkey" FOREIGN KEY ("traspaso_id", "sucursal_id", "sucursal_destino_id", "empresa_id") REFERENCES "traspasos"("id", "sucursal_id", "sucursal_destino_id", "empresa_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partidas_traspaso" ADD CONSTRAINT "partidas_traspaso_poliza_salida_fkey" FOREIGN KEY ("poliza_salida_id", "sucursal_id", "empresa_id") REFERENCES "polizas_inventario"("id", "sucursal_id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partidas_traspaso" ADD CONSTRAINT "partidas_traspaso_poliza_entrada_fkey" FOREIGN KEY ("poliza_entrada_id", "sucursal_destino_id", "empresa_id") REFERENCES "polizas_inventario"("id", "sucursal_id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECKs escritos a mano (F2-124): Prisma no los modela.
ALTER TABLE "traspasos" ADD CONSTRAINT "traspasos_folio_chk" CHECK ("folio" > 0);
ALTER TABLE "traspasos" ADD CONSTRAINT "traspasos_almacen_origen_sr_id_chk" CHECK (length("almacen_origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "traspasos" ADD CONSTRAINT "traspasos_almacen_destino_sr_id_chk" CHECK (length("almacen_destino_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "traspasos" ADD CONSTRAINT "traspasos_nota_chk" CHECK ("nota" IS NULL OR length("nota") BETWEEN 1 AND 200);
-- Un traspaso mueve de un almacén a OTRO.
ALTER TABLE "traspasos" ADD CONSTRAINT "traspasos_origen_destino_chk" CHECK (NOT ("sucursal_id" = "sucursal_destino_id" AND "almacen_origen_sr_id" = "almacen_destino_sr_id"));
-- Recibido ⇔ sus dos marcas; cancelado ⇔ las suyas. Nunca las dos.
ALTER TABLE "traspasos" ADD CONSTRAINT "traspasos_recibido_chk" CHECK (("estado" = 'recibido') = ("recibido_at" IS NOT NULL AND "recibido_por" IS NOT NULL) AND ("recibido_at" IS NULL) = ("recibido_por" IS NULL));
ALTER TABLE "traspasos" ADD CONSTRAINT "traspasos_cancelado_chk" CHECK (("estado" = 'cancelado') = ("cancelado_at" IS NOT NULL AND "cancelado_por" IS NOT NULL) AND ("cancelado_at" IS NULL) = ("cancelado_por" IS NULL));
-- Un cancelado nunca está conciliado.
ALTER TABLE "traspasos" ADD CONSTRAINT "traspasos_conciliado_chk" CHECK ("estado" <> 'cancelado' OR "conciliado_at" IS NULL);
ALTER TABLE "partidas_traspaso" ADD CONSTRAINT "partidas_traspaso_insumo_origen_sr_id_chk" CHECK (length("insumo_origen_sr_id") BETWEEN 1 AND 64);
ALTER TABLE "partidas_traspaso" ADD CONSTRAINT "partidas_traspaso_cantidad_chk" CHECK ("cantidad" > 0);
ALTER TABLE "partidas_traspaso" ADD CONSTRAINT "partidas_traspaso_costo_unitario_chk" CHECK ("costo_unitario" IS NULL OR "costo_unitario" >= 0);
-- El espejo es (póliza, renglón): los dos o ninguno.
ALTER TABLE "partidas_traspaso" ADD CONSTRAINT "partidas_traspaso_espejo_salida_chk" CHECK (("poliza_salida_id" IS NULL) = ("renglon_salida" IS NULL));
ALTER TABLE "partidas_traspaso" ADD CONSTRAINT "partidas_traspaso_espejo_entrada_chk" CHECK (("poliza_entrada_id" IS NULL) = ("renglon_entrada" IS NULL));
