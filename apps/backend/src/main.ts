/**
 * Bootstrap da API Nest (orquestrador do Cast Review).
 *
 * Responsabilidades daqui:
 * - criar a app;
 * - ValidationPipe global (DTOs);
 * - CORS para o front Vite local;
 * - porta (env PORT ou 3000).
 *
 * Sem WebSocket: o run de análise é `POST /repositories/:repo/pulls/:n/analyses`
 * (AnalysesModule), resposta em streaming (SSE) na mesma conexão HTTP.
 */
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Front local (Vite default 5173) + margem para outros ports de dev.
  app.enableCors({
    origin: true,
    credentials: true,
  });

  // Pipes ANTES de listen — senão requests passam sem validação.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // remove campos não declarados no DTO
      transform: true, // coerção de tipos (string → number em params, etc.)
      forbidNonWhitelisted: true,
    }),
  );

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  // Log simples — em prod usaria logger estruturado.
  console.log(`Cast Review API listening on http://localhost:${port}`);
}

void bootstrap();
