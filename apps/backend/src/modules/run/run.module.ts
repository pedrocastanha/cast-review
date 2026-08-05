/**
 * RunModule — único módulo que conhece o Python (via HTTP SSE).
 *
 * Importa ContextBuilderModule (que já puxa GithubModule).
 * NÃO é importado por Auth/Github — direção da dependência é de
 * orquestração → dados, nunca o contrário.
 */
import { Module } from '@nestjs/common';
import { ContextBuilderModule } from '../context-builder/context-builder.module';
import { RunController } from './run.controller';
import { RunGateway } from './run.gateway';
import { RunService } from './run.service';

@Module({
  imports: [ContextBuilderModule],
  controllers: [RunController],
  providers: [RunService, RunGateway],
  exports: [RunService],
})
export class RunModule {}
