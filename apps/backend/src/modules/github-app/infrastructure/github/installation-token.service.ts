import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { AppLogger } from 'src/shared/logger/logger.service';
import { resolveGithubAppConfig } from '../../config/github-app.config';
import { signAppJwt } from './security/app-jwt';

interface CachedToken {
  token: string;
  expiresAt: number;
}

const EXPIRY_MARGIN_MS = 60_000;

@Injectable()
export class InstallationTokenService {
  private readonly cache = new Map<string, CachedToken>();

  constructor(private readonly logger: AppLogger) {}

  appClient(): Octokit {
    const config = resolveGithubAppConfig();
    if (!config.appId || !config.privateKey) {
      throw new InternalServerErrorException('GitHub App não configurada');
    }
    return new Octokit({ auth: signAppJwt(config.appId, config.privateKey) });
  }

  async tokenFor(installationId: string): Promise<string> {
    const cached = this.cache.get(installationId);
    if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
      return cached.token;
    }

    try {
      const { data } =
        await this.appClient().apps.createInstallationAccessToken({
          installation_id: Number(installationId),
        });
      this.cache.set(installationId, {
        token: data.token,
        expiresAt: new Date(data.expires_at).getTime(),
      });
      return data.token;
    } catch (err) {
      this.cache.delete(installationId);
      this.logger.error('Falha ao emitir token de instalação', {
        exception: err,
        installationId,
      });
      throw new InternalServerErrorException(
        'Não foi possível autenticar a instalação do GitHub',
      );
    }
  }

  async clientFor(installationId: string): Promise<Octokit> {
    return new Octokit({ auth: await this.tokenFor(installationId) });
  }

  forget(installationId: string): void {
    this.cache.delete(installationId);
  }
}
