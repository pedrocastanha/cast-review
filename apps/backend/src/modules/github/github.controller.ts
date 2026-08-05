import {
  Controller,
  Get,
  Headers,
  Param,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { GithubService } from './github.service';

@Controller()
export class GithubController {
  constructor(private readonly github: GithubService) {}

  // Isso deveria ser um decorator.
  private extractToken(authorization?: string): string {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing Authorization: Bearer <github_pat>',
      );
    }
    return authorization.slice('Bearer '.length).trim();
  }

  @Get('repos')
  async listRepos(@Headers('authorization') authorization?: string) {
    const token = this.extractToken(authorization);
    return this.github.listRepos(token);
  }

  @Get('repos/:owner/:repo/pulls')
  async listPulls(
    @Headers('authorization') authorization: string | undefined,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('state') state?: 'open' | 'closed' | 'all',
  ) {
    const token = this.extractToken(authorization);
    return this.github.listPullRequests(token, owner, repo, state ?? 'open');
  }

  @Get('repos/:owner/:repo/pulls/:number')
  async getPull(
    @Headers('authorization') authorization: string | undefined,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number') number: string,
  ) {
    const token = this.extractToken(authorization);
    return this.github.getPullRequest(token, owner, repo, Number(number));
  }
}
