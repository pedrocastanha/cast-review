import { Module } from '@nestjs/common';
import { GithubModule } from '../github/github.module';
import { ContextBuilderService } from './context-builder.service';

@Module({
  imports: [GithubModule],
  providers: [ContextBuilderService],
  exports: [ContextBuilderService],
})
export class ContextBuilderModule {}
