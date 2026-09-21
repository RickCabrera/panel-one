import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Sin `globals: true` en vitest, Testing Library no registra su limpieza
// automática: si no se hace aquí, el segundo test que renderice encuentra el DOM
// del primero y falla por una razón que no tiene nada que ver con lo que prueba.
afterEach(() => {
  cleanup();
});

// OJO: la sesión (`src/auth/sesion.ts`) vive en variables del módulo y sobrevive
// entre tests. Todo test que la establezca llama `terminarSesion()` en su
// afterEach (como App.test.tsx y cliente.test.ts), o el siguiente arranca con el
// token y el timer del anterior.
