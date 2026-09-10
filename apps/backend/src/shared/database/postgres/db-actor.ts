import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Quem está falando com o banco nesta unidade de trabalho.
 *
 * - `user`: requisição autenticada. `userId` vem do payload JWT já verificado
 *   pelo guard — nunca de body, query ou header.
 * - `auth`: bootstrap de autenticação (login por e-mail, rotação de refresh).
 *   Precisa ler linhas de um usuário que ainda não se autenticou, então tem
 *   policy própria e escopo deliberadamente estreito.
 * - `service`: webhook e outras entradas sem usuário humano.
 * - `job`: worker BullMQ agindo em nome de `userId`.
 * - `anonymous`: nenhum contexto. Sob RLS isso não lê nada — é o default e é
 *   intencional (SEC-14: o padrão de autorização é negar).
 */
export type ActorType = 'user' | 'auth' | 'service' | 'job' | 'anonymous';

export interface DbActor {
  userId: string | null;
  actorType: ActorType;
}

export const ANONYMOUS_ACTOR: DbActor = {
  userId: null,
  actorType: 'anonymous',
};

export const dbActorStorage = new AsyncLocalStorage<DbActor>();

export function currentDbActor(): DbActor {
  return dbActorStorage.getStore() ?? ANONYMOUS_ACTOR;
}

/**
 * Abre um escopo de ator mutável para o resto da cadeia assíncrona.
 *
 * O objeto é mutável de propósito: o middleware roda antes do guard e ainda não
 * sabe quem é o usuário, então o guard preenche o mesmo objeto depois de
 * verificar o token. Ver `setCurrentDbActor`.
 */
export function runWithDbActor<T>(actor: DbActor, work: () => T): T {
  return dbActorStorage.run(actor, work);
}

export function setCurrentDbActor(userId: string, actorType: ActorType): void {
  const actor = dbActorStorage.getStore();
  if (!actor) return;
  actor.userId = userId;
  actor.actorType = actorType;
}
