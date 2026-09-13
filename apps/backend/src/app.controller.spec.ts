import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;
  const environment = { ...process.env };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  afterEach(() => {
    process.env = { ...environment };
  });

  describe('root', () => {
    it('should return orchestrator hello', () => {
      expect(appController.getHello()).toContain('Cast Review');
    });
  });

  describe('instance', () => {
    it('exposes the configured frontend URL to first-party clients', () => {
      process.env.FRONTEND_URL = 'https://cast.example.test';

      expect(appController.instance()).toMatchObject({
        frontendUrl: 'https://cast.example.test',
      });
    });

    it('falls back to the first validated frontend origin', () => {
      delete process.env.FRONTEND_URL;
      process.env.FRONTEND_ORIGINS =
        'https://cast-primary.example.test,https://cast-secondary.example.test';

      expect(appController.instance()).toMatchObject({
        frontendUrl: 'https://cast-primary.example.test',
      });
    });
  });
});
