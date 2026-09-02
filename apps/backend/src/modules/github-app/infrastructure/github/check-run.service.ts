import { Injectable } from '@nestjs/common';
import { AppLogger } from 'src/shared/logger/logger.service';
import type { CheckRunSnapshot } from '../../domain/github-app.types';
import {
  CHECK_RUN_NAME,
  type CheckRunOutput,
} from '../../domain/check-run-output';
import { InstallationTokenService } from './installation-token.service';

@Injectable()
export class CheckRunService {
  constructor(
    private readonly tokenService: InstallationTokenService,
    private readonly logger: AppLogger,
  ) {}

  async create(input: {
    installationId: string;
    owner: string;
    repo: string;
    headSha: string;
    status: 'queued' | 'in_progress';
    output?: CheckRunOutput;
    detailsUrl?: string;
  }): Promise<CheckRunSnapshot | null> {
    try {
      const octokit = await this.tokenService.clientFor(input.installationId);
      const { data } = await octokit.checks.create({
        owner: input.owner,
        repo: input.repo,
        name: CHECK_RUN_NAME,
        head_sha: input.headSha,
        status: input.status,
        ...(input.status === 'in_progress'
          ? { started_at: new Date().toISOString() }
          : {}),
        ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
        ...(input.output ? { output: input.output } : {}),
      });
      return {
        id: data.id,
        status: input.status,
        conclusion: null,
        htmlUrl: data.html_url ?? null,
      };
    } catch (err) {
      this.logger.error('Falha ao criar Check Run', {
        exception: err,
        owner: input.owner,
        repo: input.repo,
        headSha: input.headSha,
      });
      return null;
    }
  }

  async update(input: {
    installationId: string;
    owner: string;
    repo: string;
    checkRunId: number;
    status: 'in_progress' | 'completed';
    conclusion?: 'success' | 'neutral' | 'failure';
    output?: CheckRunOutput;
    detailsUrl?: string;
  }): Promise<CheckRunSnapshot | null> {
    try {
      const octokit = await this.tokenService.clientFor(input.installationId);
      const { data } = await octokit.checks.update({
        owner: input.owner,
        repo: input.repo,
        check_run_id: input.checkRunId,
        status: input.status,
        ...(input.conclusion ? { conclusion: input.conclusion } : {}),
        ...(input.status === 'completed'
          ? { completed_at: new Date().toISOString() }
          : {}),
        ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
        ...(input.output ? { output: input.output } : {}),
      });
      return {
        id: data.id,
        status: input.status,
        conclusion: input.conclusion ?? null,
        htmlUrl: data.html_url ?? null,
      };
    } catch (err) {
      this.logger.error('Falha ao atualizar Check Run', {
        exception: err,
        owner: input.owner,
        repo: input.repo,
        checkRunId: input.checkRunId,
      });
      return null;
    }
  }
}
