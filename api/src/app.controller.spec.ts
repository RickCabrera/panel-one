import { Test, type TestingModule } from '@nestjs/testing';

import { AppController } from './app.controller';
import { AppService } from './app.service';

// Andamio: comprueba que el contenedor de Nest levanta y que jest + ts-jest están
// bien cableados en este carril. No es cobertura de negocio y no pretende serlo;
// la primera lógica que vale la pena probar llega con F1-011.
describe('AppController', () => {
  let app: TestingModule;

  beforeEach(async () => {
    app = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();
  });

  it('responde el estado del servicio', () => {
    const controller = app.get(AppController);

    expect(controller.estado()).toEqual({ servicio: 'monitor-api', estado: 'arriba' });
  });
});
