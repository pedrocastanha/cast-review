import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { ChatService } from './chat.service';

const currentUser: CurrentUserData = {
  id: 'user-1',
  username: 'pedrocastanha',
  email: 'pedro@example.com',
};

function threadRepository(seed: any[] = []) {
  const rows = [...seed];
  return {
    rows,
    create: jest.fn((entity: any) => ({ id: 'generated-id', ...entity })),
    save: jest.fn(async (entity: any) => {
      rows.push(entity);
      return entity;
    }),
    find: jest.fn(async () => [...rows]),
    findOne: jest.fn(
      async ({ where }: any) =>
        rows.find(
          (row) =>
            row.id === where.id &&
            row.userId === where.userId &&
            row.active !== false,
        ) ?? null,
    ),
    update: jest.fn(async (id: string, patch: any) => {
      const row = rows.find((candidate) => candidate.id === id);
      if (row) Object.assign(row, patch);
      return { affected: 1 };
    }),
  };
}

function messageRepository(seed: any[] = []) {
  const rows = [...seed];
  return {
    rows,
    create: jest.fn((entity: any) => ({ id: 'generated-id', ...entity })),
    save: jest.fn(async (entity: any) => {
      rows.push(entity);
      return entity;
    }),
    find: jest.fn(async () => [...rows]),
  };
}

function buildService(overrides: any = {}) {
  const threads = overrides.threads ?? threadRepository();
  const messages = overrides.messages ?? messageRepository();
  const repositoriesService = {
    getRepositoryIndexStatus: jest.fn(async () => ({
      status: 'indexed',
      sha: 'sha-abc',
      stale: false,
    })),
    getFileContent: jest.fn(async () => 'conteudo do github'),
    ...overrides.repositoriesService,
  };
  const userService = {
    getOpenaiKey: jest.fn(async () => 'sk-do-banco'),
    ...overrides.userService,
  };
  const aiApiClient = {
    getIndexFile: jest.fn(async () => ({
      repoId: 'acme/back',
      sha: 'sha-abc',
      path: 'src/a.ts',
      content: 'conteudo do grafo',
    })),
    listIndexFiles: jest.fn(async () => ({
      repoId: 'acme/back',
      sha: 'sha-abc',
      paths: ['src/a.ts', 'src/b.ts'],
    })),
    runChat: jest.fn(),
    ...overrides.aiApiClient,
  };
  const logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  const catalogGrantService = {
    issue: jest.fn(() => 'catalog-grant'),
    ...overrides.catalogGrantService,
  };

  const service = new ChatService(
    threads as any,
    messages as any,
    repositoriesService as any,
    userService as any,
    aiApiClient as any,
    catalogGrantService as any,
    logger as any,
  );

  return {
    service,
    threads,
    messages,
    repositoriesService,
    userService,
    aiApiClient,
    catalogGrantService,
  };
}

function seedThread(overrides: any = {}) {
  return {
    id: 'thread-1',
    userId: 'user-1',
    active: true,
    title: 'Nova conversa',
    scopeType: 'repository',
    repoId: 'acme/back',
    projectId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    scope: {
      mode: 'repository',
      repositories: [
        {
          repoId: 'acme/back',
          sha: 'sha-abc',
          included: true,
          omissionReason: null,
        },
      ],
    },
    ...overrides,
  };
}

describe('ChatService.create', () => {
  it('cria uma thread global sem congelar o catálogo', async () => {
    const { service, threads, repositoriesService } = buildService();

    const thread = await service.create(
      { scope: { mode: 'global' } },
      currentUser,
    );

    expect(thread.scope).toEqual({ mode: 'global', repositories: [] });
    expect(thread.repoId).toBeNull();
    expect(threads.save).toHaveBeenCalled();
    expect(repositoriesService.getRepositoryIndexStatus).not.toHaveBeenCalled();
  });

  it('congela o sha indexado no escopo do repositório', async () => {
    const { service, threads } = buildService();

    const thread = await service.create(
      { scope: { mode: 'repository', repoId: 'acme/back' } },
      currentUser,
    );

    expect(thread.scope.repositories).toEqual([
      {
        repoId: 'acme/back',
        sha: 'sha-abc',
        included: true,
        omissionReason: null,
      },
    ]);
    expect(threads.save).toHaveBeenCalled();
  });

  it('rejeita repoId fora do formato owner/repo', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        { scope: { mode: 'repository', repoId: 'semBarra' } },
        currentUser,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita escopo sem nenhum repositório indexado', async () => {
    const { service } = buildService({
      repositoriesService: {
        getRepositoryIndexStatus: jest.fn(async () => ({
          status: 'not_indexed',
          sha: null,
          stale: false,
        })),
      },
    });

    await expect(
      service.create(
        { scope: { mode: 'repository', repoId: 'acme/back' } },
        currentUser,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita modo desconhecido', async () => {
    const { service } = buildService();

    await expect(
      service.create({ scope: { mode: 'galaxia' } } as any, currentUser),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ChatService.list', () => {
  it('omite threads históricas de projeto', async () => {
    const threads = threadRepository([
      seedThread(),
      seedThread({ id: 'project-thread', scopeType: 'project' }),
      seedThread({
        id: 'global-thread',
        scopeType: 'global',
        repoId: null,
        scope: { mode: 'global', repositories: [] },
      }),
    ]);
    const { service } = buildService({ threads });

    const result = await service.list(currentUser, {});

    expect(result.map((thread) => thread.id)).toEqual([
      'thread-1',
      'global-thread',
    ]);
  });
});

describe('ChatService.get', () => {
  it('não encontra thread de outro usuário', async () => {
    const threads = threadRepository([seedThread({ userId: 'outro' })]);
    const { service } = buildService({ threads });

    await expect(service.get('thread-1', currentUser)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('aponta repositório cujo índice avançou desde a criação da thread', async () => {
    const threads = threadRepository([seedThread()]);
    const { service } = buildService({
      threads,
      repositoriesService: {
        getRepositoryIndexStatus: jest.fn(async () => ({
          status: 'indexed',
          sha: 'sha-nova',
          stale: false,
        })),
      },
    });

    const thread = await service.get('thread-1', currentUser);
    expect(thread.staleRepositories).toEqual(['acme/back']);
  });

  it('não marca como stale quando o sha continua o mesmo', async () => {
    const threads = threadRepository([seedThread()]);
    const { service } = buildService({ threads });

    const thread = await service.get('thread-1', currentUser);
    expect(thread.staleRepositories).toEqual([]);
  });
});

describe('ChatService.listFiles', () => {
  it('lista arquivos do índice de cada repositório incluído', async () => {
    const threads = threadRepository([seedThread()]);
    const { service, aiApiClient } = buildService({ threads });

    const files = await service.listFiles('thread-1', currentUser, 'src', 50);

    expect(aiApiClient.listIndexFiles).toHaveBeenCalledWith(
      'acme/back',
      'sha-abc',
      'src',
      50,
    );
    expect(files).toEqual([
      { repoId: 'acme/back', path: 'src/a.ts' },
      { repoId: 'acme/back', path: 'src/b.ts' },
    ]);
  });
});

describe('ChatService.sendMessage', () => {
  function httpDoubles() {
    const written: string[] = [];
    const req: any = { on: jest.fn() };
    const res: any = {
      writeHead: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn((chunk: string) => written.push(chunk)),
      end: jest.fn(),
    };
    return { req, res, written };
  }

  function events(list: any[]) {
    return jest.fn(async function* () {
      for (const event of list) yield event;
    });
  }

  it('grava a pergunta antes de chamar o ai-api e persiste a resposta', async () => {
    const threads = threadRepository([seedThread()]);
    const { service, messages, aiApiClient } = buildService({
      threads,
      aiApiClient: {
        runChat: events([
          { type: 'tool_call', payload: { name: 'search_symbols' } },
          {
            type: 'message_done',
            payload: {
              content: 'login está em src/a.ts:4',
              citations: [{ repoId: 'acme/back', path: 'src/a.ts', line: 4 }],
              toolCalls: [{ name: 'search_symbols' }],
              usage: {
                promptTokens: 10,
                completionTokens: 4,
                cachedTokens: 0,
                costUsd: 0.01,
              },
              truncated: false,
            },
          },
        ]),
      },
    });
    const { req, res, written } = httpDoubles();

    await service.sendMessage(
      'thread-1',
      {
        content: 'quem faz login?',
        mentions: [],
        model: 'gpt-4o',
      },
      currentUser,
      req,
      res,
    );

    expect(messages.rows[0].role).toBe('user');
    expect(messages.rows[0].content).toBe('quem faz login?');
    expect(messages.rows[0].model).toBe('gpt-4o');
    expect(messages.rows[1].role).toBe('assistant');
    expect(messages.rows[1].model).toBe('gpt-4o');
    expect(messages.rows[1].citations).toHaveLength(1);
    expect(messages.rows[1].usage.costUsd).toBe(0.01);
    expect(written).toHaveLength(2);
    expect(res.end).toHaveBeenCalled();
    expect(aiApiClient.runChat).toHaveBeenCalled();
  });

  it('envia uma thread global com grant e sem catálogo pré-carregado', async () => {
    const threads = threadRepository([
      seedThread({
        scopeType: 'global',
        repoId: null,
        scope: { mode: 'global', repositories: [] },
      }),
    ]);
    const { service, aiApiClient, catalogGrantService } = buildService({
      threads,
      aiApiClient: { runChat: events([]) },
    });
    const { req, res } = httpDoubles();

    await service.sendMessage(
      'thread-1',
      { content: 'quais repositórios existem?', model: 'gpt-5.4-mini' },
      currentUser,
      req,
      res,
    );

    const payload = (aiApiClient.runChat as jest.Mock).mock.calls[0][0];
    expect(payload.mode).toBe('global');
    expect(payload.repositories).toEqual([]);
    expect(payload.catalog.grant).toBe('catalog-grant');
    expect(payload.catalog.url).toContain('/internal/chat/catalog');
    expect(catalogGrantService.issue).toHaveBeenCalledWith(
      currentUser,
      'thread-1',
    );
  });

  it('valida a pista de repositório antes de enviá-la ao agente global', async () => {
    const threads = threadRepository([
      seedThread({
        scopeType: 'global',
        repoId: null,
        scope: { mode: 'global', repositories: [] },
      }),
    ]);
    const { service, aiApiClient, repositoriesService } = buildService({
      threads,
      aiApiClient: { runChat: events([]) },
    });
    const { req, res } = httpDoubles();

    await service.sendMessage(
      'thread-1',
      {
        content: 'como funciona?',
        model: 'gpt-5.4-mini',
        repositoryHint: 'acme/back',
      },
      currentUser,
      req,
      res,
    );

    expect(repositoriesService.getRepositoryIndexStatus).toHaveBeenCalledWith(
      'back',
      currentUser,
      'acme',
    );
    const payload = (aiApiClient.runChat as jest.Mock).mock.calls[0][0];
    expect(payload.repositoryHint).toEqual({
      repoId: 'acme/back',
      sha: 'sha-abc',
    });
  });

  it('resolve menção pelo grafo antes de tentar o GitHub', async () => {
    const threads = threadRepository([seedThread()]);
    const { service, aiApiClient, repositoriesService } = buildService({
      threads,
      aiApiClient: { runChat: events([]) },
    });
    const { req, res } = httpDoubles();

    await service.sendMessage(
      'thread-1',
      {
        content: 'e esse arquivo?',
        mentions: [{ repoId: 'acme/back', path: 'src/a.ts' }],
        model: 'gpt-4o',
      },
      currentUser,
      req,
      res,
    );

    expect(aiApiClient.getIndexFile).toHaveBeenCalledWith(
      'acme/back',
      'sha-abc',
      'src/a.ts',
    );
    expect(repositoriesService.getFileContent).not.toHaveBeenCalled();
    const payload = (aiApiClient.runChat as jest.Mock).mock.calls[0][0];
    expect(payload.mentions).toEqual([
      { repoId: 'acme/back', path: 'src/a.ts', content: 'conteudo do grafo' },
    ]);
  });

  it('cai no GitHub quando o arquivo não tem símbolo indexado', async () => {
    const threads = threadRepository([seedThread()]);
    const { service, aiApiClient, repositoriesService } = buildService({
      threads,
      aiApiClient: {
        getIndexFile: jest.fn(async () => null),
        runChat: events([]),
      },
    });
    const { req, res } = httpDoubles();

    await service.sendMessage(
      'thread-1',
      {
        content: 'e o readme?',
        mentions: [{ repoId: 'acme/back', path: 'README.md' }],
        model: 'gpt-4o',
      },
      currentUser,
      req,
      res,
    );

    expect(repositoriesService.getFileContent).toHaveBeenCalledWith(
      'back',
      'README.md',
      'sha-abc',
      currentUser,
      'acme',
    );
    const payload = (aiApiClient.runChat as jest.Mock).mock.calls[0][0];
    expect(payload.mentions[0].content).toBe('conteudo do github');
  });

  it('ignora menção a repositório fora do escopo', async () => {
    const threads = threadRepository([seedThread()]);
    const { service, aiApiClient } = buildService({
      threads,
      aiApiClient: { runChat: events([]) },
    });
    const { req, res } = httpDoubles();

    await service.sendMessage(
      'thread-1',
      {
        content: 'e isso?',
        mentions: [{ repoId: 'outro/repo', path: 'src/x.ts' }],
        model: 'gpt-4o',
      },
      currentUser,
      req,
      res,
    );

    const payload = (aiApiClient.runChat as jest.Mock).mock.calls[0][0];
    expect(payload.mentions).toEqual([]);
    expect(aiApiClient.getIndexFile).not.toHaveBeenCalled();
  });

  it('manda o histórico anterior junto da pergunta', async () => {
    const threads = threadRepository([seedThread()]);
    const messages = messageRepository([
      {
        id: 'm1',
        threadId: 'thread-1',
        role: 'user',
        content: 'antes',
        active: true,
      },
      {
        id: 'm2',
        threadId: 'thread-1',
        role: 'assistant',
        content: 'resposta',
        active: true,
      },
    ]);
    const { service, aiApiClient } = buildService({
      threads,
      messages,
      aiApiClient: { runChat: events([]) },
    });
    const { req, res } = httpDoubles();

    await service.sendMessage(
      'thread-1',
      { content: 'depois', mentions: [], model: 'gpt-4o' },
      currentUser,
      req,
      res,
    );

    const payload = (aiApiClient.runChat as jest.Mock).mock.calls[0][0];
    expect(payload.history).toEqual([
      { role: 'user', content: 'antes' },
      { role: 'assistant', content: 'resposta' },
    ]);
  });

  it('renomeia a thread com a primeira pergunta', async () => {
    const threads = threadRepository([seedThread()]);
    const { service } = buildService({
      threads,
      aiApiClient: { runChat: events([]) },
    });
    const { req, res } = httpDoubles();

    await service.sendMessage(
      'thread-1',
      { content: 'como funciona o login?', mentions: [], model: 'gpt-4o' },
      currentUser,
      req,
      res,
    );

    expect(threads.rows[0].title).toBe('como funciona o login?');
  });

  it('emite evento de erro sem derrubar a requisição quando o ai-api falha', async () => {
    const threads = threadRepository([seedThread()]);
    const { service, written, ...rest } = {
      ...buildService({
        threads,
        aiApiClient: {
          runChat: jest.fn(() => {
            throw new Error('ai-api indisponível (status 500)');
          }),
        },
      }),
      written: [] as string[],
    };
    const doubles = httpDoubles();

    await service.sendMessage(
      'thread-1',
      { content: 'oi', mentions: [], model: 'gpt-4o' },
      currentUser,
      doubles.req,
      doubles.res,
    );

    expect(doubles.written[0]).toContain('"type":"error"');
    expect(doubles.res.end).toHaveBeenCalled();
  });

  it('recusa thread cujo escopo perdeu todos os índices', async () => {
    const threads = threadRepository([
      seedThread({
        scope: {
          mode: 'repository',
          repositories: [
            {
              repoId: 'acme/back',
              sha: null,
              included: false,
              omissionReason: 'not_indexed',
            },
          ],
        },
      }),
    ]);
    const { service } = buildService({ threads });
    const { req, res } = httpDoubles();

    await expect(
      service.sendMessage(
        'thread-1',
        { content: 'oi', mentions: [], model: 'gpt-4o' },
        currentUser,
        req,
        res,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ChatService e a chave da OpenAI', () => {
  function httpDoubles() {
    const req: any = { on: jest.fn() };
    const res: any = {
      writeHead: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    };
    return { req, res };
  }

  it('manda ao ai-api a chave guardada no banco do dono da thread', async () => {
    const threads = threadRepository([seedThread()]);
    const { service, aiApiClient, userService } = buildService({
      threads,
      aiApiClient: {
        runChat: jest.fn(async function* () {}),
      },
    });
    const { req, res } = httpDoubles();

    await service.sendMessage(
      'thread-1',
      { content: 'oi', mentions: [], model: 'gpt-4o' },
      currentUser,
      req,
      res,
    );

    expect(userService.getOpenaiKey).toHaveBeenCalledWith('user-1');
    const payload = (aiApiClient.runChat as jest.Mock).mock.calls[0][0];
    expect(payload.apiKeys).toEqual({ openai: 'sk-do-banco' });
  });

  it('nem abre o stream quando o usuário não configurou a chave', async () => {
    const threads = threadRepository([seedThread()]);
    const { service, aiApiClient } = buildService({
      threads,
      userService: {
        getOpenaiKey: jest.fn(async () => {
          throw new BadRequestException('Configure sua chave da OpenAI');
        }),
      },
      aiApiClient: { runChat: jest.fn() },
    });
    const { req, res } = httpDoubles();

    await expect(
      service.sendMessage(
        'thread-1',
        { content: 'oi', mentions: [], model: 'gpt-4o' },
        currentUser,
        req,
        res,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(res.writeHead).not.toHaveBeenCalled();
    expect(aiApiClient.runChat).not.toHaveBeenCalled();
  });
});
