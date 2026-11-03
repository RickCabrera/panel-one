-- CreateTable
CREATE TABLE "codigos_enlace" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "codigo_hash" CHAR(64) NOT NULL,
    "expira_at" TIMESTAMPTZ(3) NOT NULL,
    "usado_at" TIMESTAMPTZ(3),
    "creado_por" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codigos_enlace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "codigos_enlace_codigo_hash_key" ON "codigos_enlace"("codigo_hash");

-- CreateIndex
CREATE INDEX "codigos_enlace_empresa_id_idx" ON "codigos_enlace"("empresa_id");

-- CreateIndex
CREATE INDEX "codigos_enlace_sucursal_id_idx" ON "codigos_enlace"("sucursal_id");

-- AddForeignKey
ALTER TABLE "codigos_enlace" ADD CONSTRAINT "codigos_enlace_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Instalador de un clic: CHECK escrito a mano (Prisma no lo modela).
-- En la base sólo vive el SHA-256 del código, nunca el código.
ALTER TABLE "codigos_enlace" ADD CONSTRAINT "codigos_enlace_hash_check"
    CHECK ("codigo_hash" ~ '^[0-9a-f]{64}$');
