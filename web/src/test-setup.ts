import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

import { instalarMatchMediaFalso } from './test/matchMedia';

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

// jsdom no trae ResizeObserver y el `ResponsiveContainer` de Recharts lo pide al
// montarse. Con tamaño 0 no dibuja nada, que es lo que queremos: los tests revisan
// los números en texto, no los píxeles de la gráfica.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom tampoco trae `matchMedia` (F2-211): el tema "sistema" lo lee. Uno falso por
// test, con el sistema en claro, que `temaDelSistema()` puede cambiar a oscuro.
// Y cada test arranca con la raíz sin tema aplicado.
beforeEach(() => {
  // Los tests con `@vitest-environment node` (los `*.node.test.ts`) no tienen DOM.
  if (typeof window === 'undefined') return;
  instalarMatchMediaFalso();
  document.documentElement.removeAttribute('style');
  delete document.documentElement.dataset.tema;
});
