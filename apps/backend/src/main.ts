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
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request } from 'express';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import {
  type DbActor,
  dbActorStorage,
} from './shared/database/postgres/db-actor';
import { allowedOrigins, httpSecurity } from './shared/security/http-security';
import {
  requestLimits,
  trustProxyHops,
  validateProductionConfig,
} from './shared/security/production-config';
import { ProductionErrors } from './shared/security/production-errors';
import { requestCredentials } from './shared/security/request-credentials';

const WEBHOOK_PATH = '/github-app/webhooks';

function captureRawBody(req: Request, _res: unknown, buffer: Buffer) {
  Object.assign(req, { rawBody: Buffer.from(buffer) });
}

async function bootstrap() {
  validateProductionConfig();
  const limits = requestLimits();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  app.set('trust proxy', trustProxyHops());
  app.use(
    WEBHOOK_PATH,
    json({ limit: limits.webhookBody, verify: captureRawBody }),
  );
  app.use(json({ limit: limits.jsonBody, verify: captureRawBody }));
  app.use(urlencoded({ extended: false, limit: limits.urlencodedBody }));
  app.use(httpSecurity);
  app.use(requestCredentials);
  // Abre o escopo do ator do banco para toda a cadeia da requisição. Middleware,
  // e não interceptor, porque precisa cobrir também streams SSE de vida longa.
  // O objeto começa anônimo e o `JwtAccessGuard` o preenche depois de verificar
  // o token — sob RLS, anônimo não lê nada.
  app.use((_req, _res, next) => {
    const actor: DbActor = { userId: null, actorType: 'anonymous' };
    dbActorStorage.run(actor, () => next());
  });
  if (process.env.NODE_ENV === 'production')
    app.useGlobalFilters(new ProductionErrors());
  app.enableShutdownHooks();

  // Front local (Vite default 5173) + margem para outros ports de dev.
  app.enableCors({
    origin: allowedOrigins(),
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

  const server = app.getHttpServer();
  server.keepAliveTimeout = limits.keepAliveTimeoutMs;
  server.headersTimeout = limits.headersTimeoutMs;
  server.requestTimeout = limits.requestTimeoutMs;
  server.maxConnections = limits.maxConnections;

  // Log simples — em prod usaria logger estruturado.
  console.log(`Cast Review API listening on http://localhost:${port}`);
}

void bootstrap();
