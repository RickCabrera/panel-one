-- CreateEnum
CREATE TYPE "EstadoCodigoFacturacion" AS ENUM ('pendiente', 'facturado', 'en_global', 'expirado');

-- CreateEnum
CREATE TYPE "ReglaVigenciaCodigo" AS ENUM ('fin_de_mes', 'dias');

-- CreateTable
CREATE TABLE "codigos_facturacion" (
    "id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "cheque_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "estado" "EstadoCodigoFacturacion" NOT NULL DEFAULT 'pendiente',
    "expira_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "codigos_facturacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuraciones_facturacion" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "vigencia_codigos" "ReglaVigenciaCodigo" NOT NULL DEFAULT 'fin_de_mes',
    "vigencia_dias" INTEGER,
    "actualizado_por" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "configuraciones_facturacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "codigos_facturacion_empresa_id_idx" ON "codigos_facturacion"("empresa_id");

-- CreateIndex
CREATE INDEX "codigos_facturacion_sucursal_id_idx" ON "codigos_facturacion"("sucursal_id");

-- CreateIndex
CREATE UNIQUE INDEX "codigos_facturacion_codigo_key" ON "codigos_facturacion"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "codigos_facturacion_cheque_id_empresa_id_key" ON "codigos_facturacion"("cheque_id", "empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "configuraciones_facturacion_empresa_id_key" ON "configuraciones_facturacion"("empresa_id");

-- AddForeignKey
ALTER TABLE "codigos_facturacion" ADD CONSTRAINT "codigos_facturacion_cheque_empresa_fkey" FOREIGN KEY ("cheque_id", "empresa_id") REFERENCES "cheques"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "codigos_facturacion" ADD CONSTRAINT "codigos_facturacion_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuraciones_facturacion" ADD CONSTRAINT "configuraciones_facturacion_empresa_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A mano (F2-101): el formato del código también lo cuida la base. 9 caracteres de A–Z y 2–9 sin
-- los ambiguos O, 0, I, 1 (`api/src/facturacion/codigo.ts#ALFABETO_CODIGO`).
ALTER TABLE "codigos_facturacion" ADD CONSTRAINT "codigos_facturacion_codigo_formato_check"
  CHECK ("codigo" ~ '^[A-HJ-NP-Z2-9]{9}$');

-- A mano (F2-101): `vigencia_dias` existe sólo con la regla `dias`, y entre 1 y 366.
ALTER TABLE "configuraciones_facturacion" ADD CONSTRAINT "configuraciones_facturacion_vigencia_check"
  CHECK (
    ("vigencia_codigos" = 'dias') = ("vigencia_dias" IS NOT NULL)
    AND ("vigencia_dias" IS NULL OR "vigencia_dias" BETWEEN 1 AND 366)
  );
