-- CreateTable
CREATE TABLE "paquetes_folios" (
    "id" UUID NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "comprado_at" TIMESTAMPTZ(3) NOT NULL,
    "vence_at" TIMESTAMPTZ(3) NOT NULL,
    "nota" VARCHAR(200),
    "aviso_vigencia_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paquetes_folios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion_folios" (
    "id" SMALLINT NOT NULL,
    "umbral_pct" INTEGER NOT NULL DEFAULT 20,
    "control_activo" BOOLEAN NOT NULL DEFAULT false,
    "aviso_umbral_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configuracion_folios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "paquetes_folios_vence_at_idx" ON "paquetes_folios"("vence_at");


-- A mano (F2-110) ------------------------------------------------------------

ALTER TABLE "paquetes_folios"
  ADD CONSTRAINT "paquetes_folios_cantidad_check" CHECK ("cantidad" BETWEEN 1 AND 1000000),
  ADD CONSTRAINT "paquetes_folios_vigencia_check" CHECK ("vence_at" > "comprado_at");

ALTER TABLE "configuracion_folios"
  ADD CONSTRAINT "configuracion_folios_unica_check" CHECK ("id" = 1),
  ADD CONSTRAINT "configuracion_folios_umbral_check" CHECK ("umbral_pct" BETWEEN 1 AND 100);

-- La única fila: el control nace APAGADO (se prende con el primer paquete).
INSERT INTO "configuracion_folios" ("id") VALUES (1);

-- Los timbres que consumen folio, por fecha de timbrado (el conteo FIFO del saldo y el reporte).
CREATE INDEX "cfdis_timbres_emitido_at_idx" ON "cfdis" ("emitido_at")
  WHERE "estado" IN ('vigente', 'cancelado');

-- Las reservas en `timbrando` (apartan folio) se cuentan en cada reserva nueva: índice parcial.
CREATE INDEX "cfdis_timbrando_idx" ON "cfdis" ("id") WHERE "estado" = 'timbrando';
