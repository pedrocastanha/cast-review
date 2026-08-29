import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { CurrentUser } from '../auth/utils/current-user-decorator';
import { RepositoriesService } from './repositories.service';

@Controller('repositories')
export class RepositoriesController {
  constructor(private readonly repositoriesService: RepositoriesService) {}

  @Get()
  async listUserRepositories(
    @CurrentUser() currentUser: CurrentUserData,
    @Query('indexed') indexed?: string,
  ) {
    return this.repositoriesService.listRepos(currentUser, indexed === 'true');
  }

  @Get(':repo/pulls')
  async listPulls(
    @Param('repo') repo: string,
    @CurrentUser() currentUser: CurrentUserData,
    @Query('owner') owner?: string,
  ) {
    return this.repositoriesService.listPulls(repo, currentUser, owner);
  }

  @Get(':repo/pulls/:pullNumber')
  async getPullByNumber(
    @Param('repo') repo: string,
    @Param('pullNumber', ParseIntPipe) pullNumber: number,
    @CurrentUser() currentUser: CurrentUserData,
    @Query('owner') owner?: string,
  ) {
    return this.repositoriesService.getPullByNumber(
      repo,
      pullNumber,
      currentUser,
      owner,
    );
  }

  @Post(':repo/index')
  @HttpCode(202)
  async indexRepository(
    @Param('repo') repo: string,
    @CurrentUser() currentUser: CurrentUserData,
    @Query('owner') owner?: string,
  ) {
    return this.repositoriesService.enqueueIndexJob(repo, currentUser, owner);
  }

  @Get(':repo/index/status')
  async getIndexStatus(
    @Param('repo') repo: string,
    @CurrentUser() currentUser: CurrentUserData,
    @Query('owner') owner?: string,
  ) {
    return this.repositoriesService.getRepositoryIndexStatus(
      repo,
      currentUser,
      owner,
    );
  }

  @Get(':repo/graph')
  async getGraph(
    @Param('repo') repo: string,
    @CurrentUser() currentUser: CurrentUserData,
    @Query('owner') owner?: string,
    @Query('sha') sha?: string,
    @Query('focus') focus?: string,
    @Query('depth') depth?: string,
  ) {
    return this.repositoriesService.getRepositoryGraph(
      repo,
      currentUser,
      owner,
      sha,
      focus,
      depth !== undefined ? Number(depth) : undefined,
    );
  }
}
