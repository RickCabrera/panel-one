-- CreateTable
CREATE TABLE "perfiles_fiscales" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "rfc" TEXT NOT NULL,
    "razon_social" TEXT NOT NULL,
    "regimen_fiscal" CHAR(3) NOT NULL,
    "cp" CHAR(5) NOT NULL,
    "serie" TEXT NOT NULL,
    "folio_actual" INTEGER NOT NULL DEFAULT 0,
    "facturama_org_id" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "csd_no_certificado" TEXT,
    "csd_rfc" TEXT,
    "csd_vigente_desde" TIMESTAMPTZ(3),
    "csd_vigente_hasta" TIMESTAMPTZ(3),
    "csd_cargado_at" TIMESTAMPTZ(3),
    "csd_cargado_por" UUID,
    "creado_por" UUID,
    "actualizado_por" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "perfiles_fiscales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receptores_frecuentes" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "rfc" TEXT NOT NULL,
    "razon_social" TEXT NOT NULL,
    "regimen_fiscal" CHAR(3) NOT NULL,
    "cp" CHAR(5) NOT NULL,
    "uso_cfdi" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "receptores_frecuentes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "perfiles_fiscales_empresa_id_key" ON "perfiles_fiscales"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "receptores_frecuentes_empresa_rfc_key" ON "receptores_frecuentes"("empresa_id", "rfc");

-- AddForeignKey
ALTER TABLE "perfiles_fiscales" ADD CONSTRAINT "perfiles_fiscales_empresa_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receptores_frecuentes" ADD CONSTRAINT "receptores_frecuentes_empresa_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
