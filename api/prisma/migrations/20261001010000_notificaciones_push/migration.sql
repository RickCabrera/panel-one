-- CreateTable
CREATE TABLE "dispositivos_push" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "empresa_id" UUID,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "version_sesion" INTEGER NOT NULL,
    "creado_at" TIMESTAMPTZ(3) NOT NULL,
    "renovado_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dispositivos_push_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preferencias_push" (
    "usuario_id" UUID NOT NULL,
    "empresa_id" UUID,
    "mesa_abierta" BOOLEAN NOT NULL DEFAULT false,
    "sucursal_sin_reporte" BOOLEAN NOT NULL DEFAULT false,
    "folios_bajo" BOOLEAN NOT NULL DEFAULT false,
    "cierre_dia" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "preferencias_push_pkey" PRIMARY KEY ("usuario_id")
);

-- CreateTable
CREATE TABLE "envios_push_resumen" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "periodo" TEXT NOT NULL,
    "creado_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "envios_push_resumen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dispositivos_push_usuario_id_idx" ON "dispositivos_push"("usuario_id");

-- CreateIndex
CREATE INDEX "dispositivos_push_empresa_id_idx" ON "dispositivos_push"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "dispositivos_push_endpoint_key" ON "dispositivos_push"("endpoint");

-- CreateIndex
CREATE INDEX "preferencias_push_empresa_id_idx" ON "preferencias_push"("empresa_id");

-- CreateIndex
CREATE INDEX "envios_push_resumen_empresa_id_idx" ON "envios_push_resumen"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "envios_push_resumen_usuario_empresa_periodo_key" ON "envios_push_resumen"("usuario_id", "empresa_id", "periodo");

-- AddForeignKey
ALTER TABLE "dispositivos_push" ADD CONSTRAINT "dispositivos_push_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispositivos_push" ADD CONSTRAINT "dispositivos_push_usuario_empresa_fkey" FOREIGN KEY ("usuario_id", "empresa_id") REFERENCES "usuarios"("id", "empresa_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preferencias_push" ADD CONSTRAINT "preferencias_push_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preferencias_push" ADD CONSTRAINT "preferencias_push_usuario_empresa_fkey" FOREIGN KEY ("usuario_id", "empresa_id") REFERENCES "usuarios"("id", "empresa_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envios_push_resumen" ADD CONSTRAINT "envios_push_resumen_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envios_push_resumen" ADD CONSTRAINT "envios_push_resumen_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A mano (F2-146): el periodo del resumen es un dia de calendario AAAA-MM-DD.
ALTER TABLE "envios_push_resumen" ADD CONSTRAINT "envios_push_resumen_periodo_chk" CHECK ("periodo" ~ '^\d{4}-\d{2}-\d{2}$');
