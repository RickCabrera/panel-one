import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Sin `globals: true` en vitest, Testing Library no registra su limpieza
// automática: si no se hace aquí, el segundo test que renderice encuentra el DOM
// del primero y falla por una razón que no tiene nada que ver con lo que prueba.
afterEach(() => {
  cleanup();
});
