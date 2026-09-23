-- CreateTable
CREATE TABLE "portales_facturacion" (
    "sucursal_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "color" CHAR(7) NOT NULL,
    "logo" BYTEA,
    "logo_tipo" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "actualizado_por" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "portales_facturacion_pkey" PRIMARY KEY ("sucursal_id")
);

-- CreateIndex
CREATE INDEX "portales_facturacion_empresa_id_idx" ON "portales_facturacion"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "portales_facturacion_slug_key" ON "portales_facturacion"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "portales_facturacion_sucursal_id_empresa_id_key" ON "portales_facturacion"("sucursal_id", "empresa_id");

-- AddForeignKey
ALTER TABLE "portales_facturacion" ADD CONSTRAINT "portales_facturacion_sucursal_empresa_fkey" FOREIGN KEY ("sucursal_id", "empresa_id") REFERENCES "sucursales"("id", "empresa_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A mano (F2-103): lo que la base también cuida del portal (`api/src/facturacion/portal.ts`).
-- El slug es la ruta pública `/f/:slug`: minúsculas, dígitos y guiones sueltos, de 3 a 40.
ALTER TABLE "portales_facturacion" ADD CONSTRAINT "portales_facturacion_slug_formato_check"
    CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("slug") BETWEEN 3 AND 40);
-- El color se inyecta como variable CSS en el portal: sólo `#rrggbb` en minúsculas.
ALTER TABLE "portales_facturacion" ADD CONSTRAINT "portales_facturacion_color_check"
    CHECK ("color" ~ '^#[0-9a-f]{6}$');
-- El logo se sirve en una ruta pública: sólo PNG, JPEG o WebP (nunca SVG), hasta 200 KB, y
-- siempre con su tipo.
ALTER TABLE "portales_facturacion" ADD CONSTRAINT "portales_facturacion_logo_check"
    CHECK (
        ("logo" IS NULL AND "logo_tipo" IS NULL)
        OR ("logo" IS NOT NULL AND "logo_tipo" IN ('image/png', 'image/jpeg', 'image/webp')
            AND octet_length("logo") BETWEEN 1 AND 204800)
    );
