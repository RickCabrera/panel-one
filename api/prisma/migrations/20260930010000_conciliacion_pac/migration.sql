-- F2-110b · Conciliación de reservas colgadas con el PAC.

-- Una solicitud de cancelación que se dio por no registrada, pero que el PAC pudo registrar tarde.
-- (El valor nuevo no se usa dentro de esta migración: Postgres no lo permite en la misma transacción.)
ALTER TYPE "estado_cancelacion_cfdi" ADD VALUE 'sin_confirmar';

-- El candado de la conciliación (UPDATE condicional) y la primera búsqueda vacía de una reserva.
ALTER TABLE "cfdis" ADD COLUMN "conciliacion_at" TIMESTAMPTZ(3),
ADD COLUMN "conciliacion_vacia_at" TIMESTAMPTZ(3);

-- Las reservas colgadas se buscan por antigüedad (`updated_at` de la reserva).
CREATE INDEX "cfdis_timbrando_updated_at_idx" ON "cfdis" ("updated_at") WHERE "estado" = 'timbrando';

-- Los CFDI vigentes a los que les faltan archivos (F2-105) son pocos: índice parcial.
CREATE INDEX "cfdis_vigente_sin_archivos_idx" ON "cfdis" ("id")
  WHERE "estado" = 'vigente' AND ("xml_clave" IS NULL OR "pdf_clave" IS NULL);
