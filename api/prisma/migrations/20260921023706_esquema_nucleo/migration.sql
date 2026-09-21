-- CreateEnum
CREATE TYPE "rol_usuario" AS ENUM ('admin_global', 'admin_empresa', 'visor');

-- CreateTable
CREATE TABLE "empresas" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sucursales" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "zona_horaria" TEXT NOT NULL DEFAULT 'America/Mexico_City',
    "api_key_hash" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sucursales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" "rol_usuario" NOT NULL,
    "empresa_id" UUID,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agente_estado" (
    "sucursal_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "version_agente" TEXT,
    "version_sr" TEXT,
    "ultima_lectura_at" TIMESTAMPTZ(3),
    "ultimo_error" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agente_estado_pkey" PRIMARY KEY ("sucursal_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sucursales_api_key_hash_key" ON "sucursales"("api_key_hash");

-- CreateIndex
CREATE INDEX "sucursales_empresa_id_idx" ON "sucursales"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "sucursales_id_empresa_id_key" ON "sucursales"("id", "empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE INDEX "usuarios_empresa_id_idx" ON "usuarios"("empresa_id");

-- CreateIndex
CREATE INDEX "agente_estado_empresa_id_idx" ON "agente_estado"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "agente_estado_sucursal_id_empresa_id_key" ON "agente_estado"("sucursal_id", "empresa_id");

-- AddForeignKey
ALTER TABLE "sucursales" ADD CONSTRAINT "sucursales_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agente_estado" ADD CONSTRAINT "agente_estado_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheckConstraint (a mano: Prisma no modela CHECK)
-- Un admin_global no pertenece a ninguna empresa, y cualquier otro rol tiene la
-- suya obligatoria. Es la invariante sobre la que se apoya el helper de scope de
-- F1-011: un visor o admin_empresa sin empresa vería "todo" o "nada" por accidente.
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_rol_empresa_chk" CHECK (("rol" = 'admin_global') = ("empresa_id" IS NULL));
