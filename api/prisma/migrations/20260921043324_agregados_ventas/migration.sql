-- CreateTable
CREATE TABLE "formas_pago_catalogo" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "forma_raw" TEXT NOT NULL,
    "forma" "forma_pago" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "formas_pago_catalogo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "formas_pago_catalogo_empresa_id_forma_raw_key" ON "formas_pago_catalogo"("empresa_id", "forma_raw");

-- CreateIndex
CREATE INDEX "cheques_sucursal_id_cerrado_at_idx" ON "cheques"("sucursal_id", "cerrado_at");

-- AddForeignKey
ALTER TABLE "formas_pago_catalogo" ADD CONSTRAINT "formas_pago_catalogo_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
