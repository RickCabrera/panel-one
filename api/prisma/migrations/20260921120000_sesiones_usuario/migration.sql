-- CreateTable
CREATE TABLE "sesiones_usuario" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "empresa_id" UUID,
    "creada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_en" TIMESTAMPTZ(3) NOT NULL,
    "revocada_en" TIMESTAMPTZ(3),

    CONSTRAINT "sesiones_usuario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sesiones_usuario_usuario_id_idx" ON "sesiones_usuario"("usuario_id");

-- CreateIndex
CREATE INDEX "sesiones_usuario_empresa_id_idx" ON "sesiones_usuario"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_id_empresa_id_key" ON "usuarios"("id", "empresa_id");

-- AddForeignKey
ALTER TABLE "sesiones_usuario" ADD CONSTRAINT "sesiones_usuario_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones_usuario" ADD CONSTRAINT "sesiones_usuario_usuario_empresa_fkey" FOREIGN KEY ("usuario_id", "empresa_id") REFERENCES "usuarios"("id", "empresa_id") ON DELETE CASCADE ON UPDATE CASCADE;

