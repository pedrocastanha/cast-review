import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { CurrentUser } from '../auth/utils/current-user-decorator';
import { Public } from '../auth/utils/public.decorator';
import { LinkInstallationDto } from './dtos/link-installation.dto';
import { TriggerReviewDto } from './dtos/trigger-review.dto';
import { UpdateRepositoryConfigDto } from './dtos/update-repository-config.dto';
import { GithubAppService } from './github-app.service';

@Controller('github-app')
export class GithubAppController {
  constructor(private readonly githubAppService: GithubAppService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 600 } })
  @Post('webhooks')
  @HttpCode(202)
  async receiveWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Body() payload: Record<string, unknown>,
    @Headers('x-github-delivery') deliveryId: string | undefined,
    @Headers('x-github-event') event: string | undefined,
    @Headers('x-hub-signature-256') signature: string | undefined,
  ) {
    const outcome = await this.githubAppService.handleWebhook({
      deliveryId,
      event,
      signature,
      rawBody: req.rawBody,
      payload: payload ?? {},
    });

    if (outcome.status === 'invalid_signature') {
      throw new UnauthorizedException('Assinatura do webhook inválida');
    }

    return outcome;
  }

  @Get('install-url')
  installUrl(@CurrentUser() currentUser: CurrentUserData) {
    return this.githubAppService.installUrl(currentUser);
  }

  @Post('installations')
  link(
    @CurrentUser() currentUser: CurrentUserData,
    @Body() dto: LinkInstallationDto,
  ) {
    return this.githubAppService.link(currentUser, dto);
  }

  @Get('installations')
  list(@CurrentUser() currentUser: CurrentUserData) {
    return this.githubAppService.list(currentUser);
  }

  @Get('installations/:id')
  detail(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserData) {
    return this.githubAppService.detail(id, currentUser);
  }

  @Post('installations/:id/refresh')
  refresh(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.githubAppService.refresh(id, currentUser);
  }

  @Post('installations/:id/pause')
  pause(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserData) {
    return this.githubAppService.setInstallationPaused(
      id,
      currentUser,
      true,
    );
  }

  @Post('installations/:id/resume')
  resume(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserData) {
    return this.githubAppService.setInstallationPaused(
      id,
      currentUser,
      false,
    );
  }

  @Delete('installations/:id')
  unlink(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserData) {
    return this.githubAppService.unlink(id, currentUser);
  }

  @Patch('repositories/:repositoryId')
  updateRepository(
    @Param('repositoryId') repositoryId: string,
    @CurrentUser() currentUser: CurrentUserData,
    @Body() dto: UpdateRepositoryConfigDto,
  ) {
    return this.githubAppService.updateRepository(
      repositoryId,
      currentUser,
      dto,
    );
  }

  @Get('repositories/:repositoryId/runs')
  listRuns(
    @Param('repositoryId') repositoryId: string,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.githubAppService.listRuns(repositoryId, currentUser);
  }

  @Post('repositories/:repositoryId/runs')
  triggerRun(
    @Param('repositoryId') repositoryId: string,
    @CurrentUser() currentUser: CurrentUserData,
    @Body() dto: TriggerReviewDto,
  ) {
    return this.githubAppService.triggerManualRun(
      repositoryId,
      currentUser,
      dto,
    );
  }

  @Post('runs/:runId/retry')
  retryRun(
    @Param('runId') runId: string,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.githubAppService.retryRun(runId, currentUser);
  }
}
