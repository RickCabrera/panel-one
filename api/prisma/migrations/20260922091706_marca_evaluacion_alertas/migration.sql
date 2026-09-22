-- CreateTable
CREATE TABLE "alertas_evaluacion" (
    "empresa_id" UUID NOT NULL,
    "observado_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "alertas_evaluacion_pkey" PRIMARY KEY ("empresa_id")
);

-- AddForeignKey
ALTER TABLE "alertas_evaluacion" ADD CONSTRAINT "alertas_evaluacion_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
