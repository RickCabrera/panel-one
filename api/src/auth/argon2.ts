import { Algorithm } from '@node-rs/argon2';

// Parámetros recomendados por OWASP para argon2id (19 MiB, 2 iteraciones). Viven
// en `src/` (y no en el seed) para que el build de la API no arrastre `prisma/`:
// el seed los importa de aquí, y el login verifica con los mismos.
export const ARGON2_OPCIONES = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;
