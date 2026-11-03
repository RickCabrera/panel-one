-- AlterTable
ALTER TABLE "cheques" ADD COLUMN     "turno_sr" TEXT;

-- CreateTable
CREATE TABLE "turnos" (
    "id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "turno_sr" TEXT NOT NULL,
    "apertura_at" TIMESTAMPTZ(3) NOT NULL,
    "cierre_at" TIMESTAMPTZ(3),
    "estacion" TEXT,
    "fondo" DECIMAL(12,2) NOT NULL,
    "declarado_efectivo" DECIMAL(12,2) NOT NULL,
    "declarado_tarjeta" DECIMAL(12,2) NOT NULL,
    "declarado_vales" DECIMAL(12,2) NOT NULL,
    "declarado_credito" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "turnos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cheques_sucursal_id_turno_sr_idx" ON "cheques"("sucursal_id", "turno_sr");

-- CreateIndex
CREATE INDEX "turnos_empresa_id_idx" ON "turnos"("empresa_id");

-- CreateIndex
CREATE INDEX "turnos_sucursal_id_apertura_at_idx" ON "turnos"("sucursal_id", "apertura_at");

-- CreateIndex
CREATE UNIQUE INDEX "turnos_sucursal_id_turno_sr_key" ON "turnos"("sucursal_id", "turno_sr");

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECKs escritos a mano (MVP de cortes): Prisma no los modela. Mismo largo que el contrato
-- (1..64). Nulo en cheques = la cuenta no trae turno, nunca texto vacío.
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_turno_sr_chk" CHECK ("turno_sr" IS NULL OR length("turno_sr") BETWEEN 1 AND 64);
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_turno_sr_chk" CHECK (length("turno_sr") BETWEEN 1 AND 64);
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_estacion_chk" CHECK ("estacion" IS NULL OR length("estacion") BETWEEN 1 AND 100);
