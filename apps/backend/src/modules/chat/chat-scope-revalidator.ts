import { Inject, Injectable } from '@nestjs/common';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import type { RepositoriesService } from '../repositories/repositories.service';

/**
 * Janela de confiança de uma permissão já verificada.
 *
 * Mesmo valor do TTL do grant de catálogo: a permissão do GitHub é revalidada
 * pelo menos a cada 5 minutos de uso da thread. É o teto de defasagem aceito —
 * um acesso revogado para de funcionar dentro dessa janela.
 */
export const SCOPE_REVALIDATION_TTL_MS = 300_000;

interface CacheEntry {
  until: number;
  allowed: boolean;
}

/**
 * Revalida contra o GitHub o escopo persistido de uma thread.
 *
 * `chat_threads.scope` é gravado na criação da thread, quando a permissão foi
 * de fato verificada. Depois disso nada revalidava: um usuário removido de um
 * repositório continuava lendo o grafo indexado dele por uma thread antiga.
 *
 * O cache é por processo e de vida curta. Não é otimização de latência à toa:
 * sem ele, uma thread de projeto com N repositórios faria N chamadas ao GitHub
 * por mensagem enviada.
 */
@Injectable()
export class ChatScopeRevalidator {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Inject('REPOSITORIES_SERVICE')
    private readonly repositoriesService: RepositoriesService,
  ) {}

  /** Subconjunto de `repoIds` que o usuário ainda pode ler no GitHub. */
  async accessible(
    repoIds: string[],
    currentUser: CurrentUserData,
  ): Promise<Set<string>> {
    const unique = [...new Set(repoIds)];
    const checked = await Promise.all(
      unique.map(
        async (repoId) =>
          [repoId, await this.check(repoId, currentUser)] as const,
      ),
    );
    return new Set(
      checked.filter(([, allowed]) => allowed).map(([repoId]) => repoId),
    );
  }

  async isAccessible(
    repoId: string,
    currentUser: CurrentUserData,
  ): Promise<boolean> {
    return this.check(repoId, currentUser);
  }

  private async check(
    repoId: string,
    currentUser: CurrentUserData,
  ): Promise<boolean> {
    const key = `${currentUser.id}::${repoId.toLowerCase()}`;
    const cached = this.cache.get(key);
    const now = Date.now();
    if (cached && cached.until > now) return cached.allowed;

    const [owner, repo] = repoId.split('/');
    if (!owner || !repo) return false;

    let allowed: boolean;
    try {
      await this.repositoriesService.assertRepositoryAccess(
        owner,
        repo,
        currentUser,
      );
      allowed = true;
    } catch {
      // Qualquer falha de autorização nega. Falhar aberto aqui devolveria
      // exatamente o acesso que a revalidação existe para cortar.
      allowed = false;
    }

    this.cache.set(key, { until: now + SCOPE_REVALIDATION_TTL_MS, allowed });
    return allowed;
  }
}
