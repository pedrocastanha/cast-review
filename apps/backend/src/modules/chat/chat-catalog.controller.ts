import {
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { Public } from '../auth/utils/public.decorator';
import type { RepositoriesService } from '../repositories/repositories.service';
import { ChatCatalogGrantService } from './chat-catalog-grant.service';

@Public()
@Controller('internal/chat/catalog')
export class ChatCatalogController {
  constructor(
    private readonly grants: ChatCatalogGrantService,
    @Inject('REPOSITORIES_SERVICE')
    private readonly repositoriesService: RepositoriesService,
  ) {}

  @Get()
  async list(
    @Headers('authorization') authorization?: string,
    @Query('query') query?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const { user } = this.grants.verify(this.bearer(authorization));
    const parsedLimit = Number.parseInt(limit ?? '', 10);
    return this.repositoriesService.listIndexedCatalog(
      user,
      query,
      Number.isFinite(parsedLimit)
        ? Math.min(Math.max(parsedLimit, 1), 20)
        : 20,
      cursor,
    );
  }

  @Get(':owner/:repo')
  async resolve(
    @Headers('authorization') authorization: string | undefined,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
  ) {
    const { user } = this.grants.verify(this.bearer(authorization));
    return this.repositoriesService.resolveIndexedCatalogEntry(
      user,
      owner,
      repo,
    );
  }

  private bearer(authorization?: string): string {
    const [scheme, token] = authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Grant de catálogo ausente');
    }
    return token;
  }
}
