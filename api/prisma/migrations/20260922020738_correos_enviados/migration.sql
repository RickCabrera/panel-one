-- CreateTable
CREATE TABLE "correos_enviados" (
    "id" UUID NOT NULL,
    "empresa_id" UUID,
    "destinatario" TEXT NOT NULL,
    "plantilla" TEXT NOT NULL,
    "asunto" TEXT NOT NULL,
    "adjuntos" JSONB NOT NULL,
    "enviado_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "correos_enviados_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "correos_enviados_empresa_id_idx" ON "correos_enviados"("empresa_id");

-- AddForeignKey
ALTER TABLE "correos_enviados" ADD CONSTRAINT "correos_enviados_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
