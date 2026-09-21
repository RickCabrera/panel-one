import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import App from './App';

// Andamio: comprueba que vitest + jsdom + Testing Library están bien cableados en
// este carril y que la app monta. No es cobertura de negocio; la primera vista con
// lógica que vale la pena probar llega con F1-041, que es la que además descomenta
// el paso `npm test` del carril `web` en el CI.
describe('App', () => {
  it('monta y muestra el título del panel', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Monitor SoftRestaurant' })).toBeDefined();
  });
});
