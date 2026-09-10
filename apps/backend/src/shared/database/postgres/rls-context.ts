import { DataSource, EntityManager } from 'typeorm';
import type { IsolationLevel } from 'typeorm/driver/types/IsolationLevel';
import { type ActorType, currentDbActor } from './db-actor';

const SET_CONTEXT_SQL = `SELECT set_config('app.user_id', $1, true),
                                set_config('app.actor_type', $2, true)`;

export interface RlsTransactionOptions {
  /** Sobrescreve o ator do escopo assíncrono. Use para 'auth', 'service', 'job'. */
  actorType?: ActorType;
  userId?: string | null;
  isolationLevel?: IsolationLevel;
}

/**
 * Abre uma transação e injeta o contexto de RLS antes de rodar `work`.
 *
 * `set_config(..., true)` é transaction-local: fora de uma transação explícita o
 * valor não sobrevive ao statement e a policy passa a ver contexto vazio, que
 * nega tudo. Por isso toda query sob RLS precisa passar por aqui.
 *
 * Os valores vão como parâmetro, nunca interpolados: o id entra numa policy.
 */
export async function runInRlsTransaction<T>(
  datasource: DataSource,
  work: (manager: EntityManager) => Promise<T>,
  options: RlsTransactionOptions = {},
): Promise<T> {
  const ambient = currentDbActor();
  const actorType = options.actorType ?? ambient.actorType;
  const userId = options.actorType ? (options.userId ?? null) : ambient.userId;

  const scoped = async (manager: EntityManager): Promise<T> => {
    await manager.query(SET_CONTEXT_SQL, [userId ?? '', actorType]);
    return work(manager);
  };

  return options.isolationLevel
    ? datasource.transaction(options.isolationLevel, scoped)
    : datasource.transaction(scoped);
}
