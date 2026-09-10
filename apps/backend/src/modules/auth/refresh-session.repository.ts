import { Inject, Injectable } from '@nestjs/common';
import { runInRlsTransaction } from '../../shared/database/postgres/rls-context';
import { DataSource, EntityManager } from 'typeorm';

export interface RefreshSessionRow {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
}

export interface CreateRefreshSessionInput {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
}

export type RevocationReason =
  | 'logout'
  | 'reuse_detected'
  | 'credentials_changed'
  | 'rotation_conflict';

@Injectable()
export class RefreshSessionRepository {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {}

  /**
   * Toda query aqui roda como ator `auth`.
   *
   * O refresh é buscado por `token_hash` ANTES de existir usuário autenticado —
   * não há `app.user_id` para escopar, e uma policy só por `user_id` mataria a
   * rotação. `refresh_sessions_scope` abre exatamente esse caso.
   *
   * É o único repositório que fixa o ator, e o escopo é deliberadamente
   * estreito: se uma consulta que não é de bootstrap de sessão aparecer aqui,
   * ela herda o mesmo privilégio. Manter esta classe restrita a refresh.
   */
  private async asAuth<T>(
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return runInRlsTransaction(this.datasource, work, {
      actorType: 'auth',
      userId: null,
    });
  }

  async create(input: CreateRefreshSessionInput): Promise<void> {
    await this.asAuth((manager) =>
      manager.query(
        `INSERT INTO refresh_sessions (id, user_id, family_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          input.id,
          input.userId,
          input.familyId,
          input.tokenHash,
          input.expiresAt,
        ],
      ),
    );
  }

  async findByTokenHash(tokenHash: string): Promise<RefreshSessionRow | null> {
    const rows = (await this.asAuth((manager) =>
      manager.query(
        `SELECT id, user_id, family_id, expires_at, consumed_at, revoked_at
         FROM refresh_sessions WHERE token_hash = $1`,
        [tokenHash],
      ),
    )) as Array<{
      id: string;
      user_id: string;
      family_id: string;
      expires_at: Date;
      consumed_at: Date | null;
      revoked_at: Date | null;
    }>;

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      familyId: row.family_id,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
      revokedAt: row.revoked_at,
    };
  }

  async consume(id: string): Promise<boolean> {
    const result = (await this.asAuth((manager) =>
      manager.query(
        `UPDATE refresh_sessions SET consumed_at = now()
         WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
        [id],
      ),
    )) as [unknown[], number];

    return result[1] === 1;
  }

  async revokeFamily(
    familyId: string,
    reason: RevocationReason,
  ): Promise<number> {
    const result = (await this.asAuth((manager) =>
      manager.query(
        `UPDATE refresh_sessions SET revoked_at = now(), revoked_reason = $2
         WHERE family_id = $1 AND revoked_at IS NULL`,
        [familyId, reason],
      ),
    )) as [unknown[], number];

    return result[1];
  }

  async revokeAllForUser(
    userId: string,
    reason: RevocationReason,
  ): Promise<number> {
    const result = (await this.asAuth((manager) =>
      manager.query(
        `UPDATE refresh_sessions SET revoked_at = now(), revoked_reason = $2
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId, reason],
      ),
    )) as [unknown[], number];

    return result[1];
  }

  async deleteExpired(userId: string): Promise<void> {
    await this.asAuth((manager) =>
      manager.query(
        `DELETE FROM refresh_sessions
         WHERE user_id = $1 AND expires_at < now() - interval '30 days'`,
        [userId],
      ),
    );
  }
}
