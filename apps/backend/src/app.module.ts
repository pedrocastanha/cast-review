/**
 * AppModule — raiz do monólito modular Nest.
 *
 * Imports = fronteiras de domínio:
 * - AuthModule          → PAT GitHub
 * - GithubModule        → repos / PRs / diff / contents
 * - ContextBuilderModule→ pacote rico (interno; também puxado pelo Run)
 * - RunModule           → WS + orquestração do Python
 *
 * ThrottlerModule global protege sobretudo /auth/validate.
 */
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { ContextBuilderModule } from './modules/context-builder/context-builder.module';
import { GithubModule } from './modules/github/github.module';
import { RunModule } from './modules/run/run.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100, // default global; auth aperta com @Throttle próprio
      },
    ]),
    AuthModule,
    GithubModule,
    ContextBuilderModule,
    RunModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
