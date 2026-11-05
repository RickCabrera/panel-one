import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Dialogo } from './Dialogo';

// UI-06: en el estilo «Noche» las tarjetas son de vidrio (`backdrop-filter`), y un ancestro con
// `backdrop-filter` se vuelve el contenedor de todo `fixed`: un diálogo montado DENTRO de una
// tarjeta (Facturación › Facturas emitidas) sólo cubría la tarjeta. Por eso va en un portal.
describe('Dialogo (UI-06)', () => {
  it('se monta en <body>, fuera de la tarjeta de vidrio que lo abre', () => {
    render(
      <section data-testid="tarjeta" className="vidrio">
        <Dialogo titulo="Cancelar F-1" onCerrar={() => {}}>
          <p>Contenido</p>
        </Dialogo>
      </section>,
    );
    const dialogo = screen.getByRole('dialog', { name: 'Cancelar F-1' });
    const velo = dialogo.parentElement!;
    expect(screen.getByTestId('tarjeta')).not.toContainElement(dialogo);
    expect(velo.parentElement).toBe(document.body);
    expect(velo).toHaveClass('fixed', 'inset-0');
  });
});
