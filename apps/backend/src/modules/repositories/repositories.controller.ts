import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { CurrentUser } from '../auth/utils/current-user-decorator';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { RepositoriesService } from './repositories.service';

@Controller('repositories')
export class RepositoriesController {
  constructor(private readonly repositoriesService: RepositoriesService) {}

  @Get()
  async listUserRepositories(@CurrentUser() currentUser: CurrentUserData) {
    return this.repositoriesService.listRepos(currentUser);
  }

  @Get(':repo/pulls')
  async listPulls(
    @Param('repo') repo: string,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.repositoriesService.listPulls(repo, currentUser);
  }

  @Get(':repo/pulls/:pullNumber')
  async getPullByNumber(
    @Param('repo') repo: string,
    @Param('pullNumber', ParseIntPipe) pullNumber: number,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.repositoriesService.getPullByNumber(
      repo,
      pullNumber,
      currentUser,
    );
  }
}
