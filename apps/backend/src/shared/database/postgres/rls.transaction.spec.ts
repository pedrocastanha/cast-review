import {
  ANONYMOUS_ACTOR,
  currentDbActor,
  type DbActor,
  runWithDbActor,
  setCurrentDbActor,
} from './db-actor';
import { RlsTransaction } from './rls.transaction';

function fakeDataSource() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const manager = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return [];
    }),
  };
  const datasource = {
    transaction: jest.fn(
      async (work: (m: typeof manager) => Promise<unknown>) => work(manager),
    ),
  };
  return { datasource: datasource as any, manager, queries };
}

describe('RlsTransaction', () => {
  it('sets the transaction-local context from the ambient actor', async () => {
    const { datasource, queries } = fakeDataSource();
    const rls = new RlsTransaction(datasource);

    await runWithDbActor({ userId: 'user-1', actorType: 'user' }, () =>
      rls.run(async () => 'done'),
    );

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain("set_config('app.user_id', $1, true)");
    expect(queries[0].sql).toContain("set_config('app.actor_type', $2, true)");
    // Parâmetros, nunca interpolação: o valor entra numa policy.
    expect(queries[0].params).toEqual(['user-1', 'user']);
  });

  it('runs inside a transaction, because set_config is transaction-local', async () => {
    const { datasource } = fakeDataSource();
    const rls = new RlsTransaction(datasource);

    await rls.runAs('service', null, async () => undefined);

    expect(datasource.transaction).toHaveBeenCalledTimes(1);
  });

  it('sends an empty user id for actors without a human owner', async () => {
    const { datasource, queries } = fakeDataSource();
    const rls = new RlsTransaction(datasource);

    await rls.runAs('service', null, async () => undefined);

    // String vazia vira NULL em app.current_user_id(), e NULL nega toda policy.
    expect(queries[0].params).toEqual(['', 'service']);
  });

  it('falls back to the anonymous actor when no scope was opened', async () => {
    const { datasource, queries } = fakeDataSource();
    const rls = new RlsTransaction(datasource);

    await rls.run(async () => undefined);

    expect(queries[0].params).toEqual(['', 'anonymous']);
  });

  it('exposes the manager of the transaction to the unit of work', async () => {
    const { datasource, manager } = fakeDataSource();
    const rls = new RlsTransaction(datasource);

    const received = await rls.run(async (m) => m);

    expect(received).toBe(manager);
  });
});

describe('db actor scope', () => {
  it('defaults to anonymous outside any scope', () => {
    expect(currentDbActor()).toEqual(ANONYMOUS_ACTOR);
  });

  it('lets the guard fill in the actor the middleware opened', () => {
    const actor: DbActor = { userId: null, actorType: 'anonymous' };

    runWithDbActor(actor, () => {
      setCurrentDbActor('user-9', 'user');
      expect(currentDbActor()).toEqual({ userId: 'user-9', actorType: 'user' });
    });
  });

  it('survives async hops, which is what keeps SSE handlers scoped', async () => {
    const actor: DbActor = { userId: null, actorType: 'anonymous' };

    await runWithDbActor(actor, async () => {
      setCurrentDbActor('user-9', 'user');
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(currentDbActor().userId).toBe('user-9');
    });
  });

  it('does not leak the actor across sibling scopes', async () => {
    const seen: Array<string | null> = [];

    await Promise.all([
      runWithDbActor({ userId: null, actorType: 'anonymous' }, async () => {
        setCurrentDbActor('user-a', 'user');
        await new Promise((resolve) => setTimeout(resolve, 5));
        seen.push(currentDbActor().userId);
      }),
      runWithDbActor({ userId: null, actorType: 'anonymous' }, async () => {
        setCurrentDbActor('user-b', 'user');
        await new Promise((resolve) => setTimeout(resolve, 1));
        seen.push(currentDbActor().userId);
      }),
    ]);

    expect(seen.sort()).toEqual(['user-a', 'user-b']);
    expect(currentDbActor().userId).toBeNull();
  });
});
