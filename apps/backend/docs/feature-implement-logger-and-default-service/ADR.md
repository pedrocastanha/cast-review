# ADR: Logger, conexão Postgres, migrations e padrões default (Entity/Repository/Service)

- **Status:** Aceito
- **Data:** 2026-08-05
- **Branch:** `feature/implement-logger-and-default-service`
- **Escopo:** `apps/backend`

## Contexto

O módulo `users` foi o primeiro a precisar de persistência real no backend. Isso forçou decisão em quatro frentes que afetam todo módulo futuro:

1. Como logar (erros, eventos) de forma estruturada.
2. Como conectar no Postgres a partir do NestJS.
3. Como evoluir o schema do banco ao longo do tempo.
4. Como evitar repetir código de CRUD/erro em cada novo `*.service.ts` e `*.entity.ts`.

Decisões tomadas em conjunto porque se sustentam mutuamente: o `BaseService` depende do `AppLogger`; o `DefaultRepository` depende do `DataSource` cru vindo do `PostgresModule`; migrations dependem da mesma `DataSource`.

## Decisão 1 — Logger: Winston + `AppLogger` global, não o logger padrão do Nest

**O quê:** `winston` + `nest-winston` (`src/shared/logger/`), expostos via `AppLogger` (implementa `LoggerService` do Nest) e injetados globalmente por `LoggerModule` (`@Global()`).

**Por quê:**
- Logger padrão do Nest (`console.log` glorificado) não estrutura output em JSON, não separa formato dev (colorido, legível) de formato produção (JSON parseável por ferramenta de log agregado).
- `AppLogger` centraliza captura de contexto (classe/método de origem via stack trace) em vez de cada service formatar log na mão.
- `LoggerModule` como `@Global()` evita re-importar em cada módulo novo — qualquer service que estenda `BaseService` já ganha logger via DI.

**Trade-off aceito:** mais uma dependência (`winston`, `nest-winston`) e uma camada de indireção sobre o logger nativo. Aceito porque o custo é baixo (2 pacotes) e o ganho (log estruturado, contexto automático) importa desde já para debug em produção.

**Alternativas descartadas:**
- Logger nativo do Nest — insuficiente pra formato estruturado/produção.
- Pino — mais rápido, mas Winston já tinha integração pronta (`nest-winston`) e não há gargalo de performance de log neste projeto.

## Decisão 2 — Postgres: `DataSource` cru via provider `'DATA_SOURCE'`, não `TypeOrmModule.forRoot`

**O quê:** `postgres.datasource.ts` define um `new DataSource(...)` standalone. `postgres.provider.ts` expõe essa instância sob o token `'DATA_SOURCE'` via `useFactory` que chama `.initialize()`. `postgres.module.ts` (`@Global()`) registra e exporta esse provider.

**Por quê:**
- Um único arquivo `DataSource` serve dois propósitos ao mesmo tempo: runtime da aplicação (via `PostgresModule`) **e** CLI de migrations (`typeorm migration:generate/run -d postgres.datasource.ts`). Não há duas fontes de verdade sobre config de conexão.
- `DefaultRepository` (ver Decisão 4) já era desenhado para receber um `DataSource` bruto e chamar `.getRepository(entity)` manualmente — não usa `@InjectRepository`. Isso dá controle explícito sobre quando/como cada repository é criado, sem a "mágica" de `TypeOrmModule.forFeature`.
- Evita ter duas conexões/pools distintas coexistindo (uma do `@nestjs/typeorm`, outra do CLI) com configuração potencialmente divergente.

**Trade-off aceito:** perde-se o açúcar sintático do `@nestjs/typeorm` (`@InjectRepository`, `forFeature`, health checks prontos). Em troca, ganha-se uma única definição de conexão reaproveitada por app e CLI.

**Alternativas descartadas:**
- `TypeOrmModule.forRootAsync` + `ConfigService` — foi a primeira tentativa (registrada e depois revertida nesta branch). Criava uma segunda `DataSource` desconectada da usada pelo CLI de migrations, e não se encaixava no `DefaultRepository` já existente.

## Decisão 3 — Migrations em vez de `synchronize: true`

**O quê:** `synchronize: false` na `DataSource`. Schema evolui via `npm run migration:generate` / `npm run migration:run`, com arquivos em `src/shared/database/postgres/migrations/`.

**Por quê:**
- `synchronize: true` altera o schema automaticamente a partir das entities no boot da aplicação — conveniente em protótipo, mas destrutivo por natureza (pode dropar coluna/tabela sem aviso) e não versiona a evolução do schema.
- Migrations dão histórico auditável (`migrations` table no Postgres) e um caminho seguro para produção, onde autoalteração de schema no boot é inaceitável.

**Trade-off aceito:** todo change de entity exige rodar `migration:generate` manualmente — passo a mais no fluxo de dev. Aceito porque o risco de `synchronize` em qualquer ambiente compartilhado supera essa fricção.

**Nota de implementação:** o glob de migrations (`migrations: [...] '**/*{.ts,.js}'`) precisa cobrir `.ts` porque em dev a `DataSource` roda via `ts-node` (script `typeorm` no `package.json`), não via `.js` compilado.

## Decisão 4 — `DefaultEntity` / `DefaultRepository` / `BaseService`

**O quê:**
- `DefaultEntity<T>` (`shared/database/postgres/default.entity.ts`): campos comuns a toda entity — `id` (uuid gerado no construtor), `createdAt`, `updatedAt`, `deletedAt` (soft delete), `active`. Hooks `@BeforeInsert`/`@BeforeUpdate` cuidam de timestamps automaticamente.
- `DefaultRepository<T>` (`shared/database/postgres/default.database.ts`): wrapper genérico sobre `Repository<T>` do TypeORM (`create`, `save`, `find`, `findOne`, `update`, `delete`, `existsBy`, `createQueryBuilder`), recebendo `DataSource` + `EntityTarget<T>` no construtor.
- `BaseService` (`shared/services/base.service.ts`): `safeExecute` (wrap de chamadas async com tratamento de erro centralizado) e `getOrFail` (lança `NotFoundException` padronizado quando uma busca retorna `null`). `handleError` já reconhece o código de unique constraint do Postgres (`23505`) e converte pra `ConflictException` com mensagem legível.

**Por quê:**
- Sem isso, cada novo módulo (após `users`, o próximo será outro) reescreveria: geração de `id`, timestamps, soft delete, e tratamento de erro de constraint — código repetido e sujeito a divergência (um módulo trata `23505`, outro esquece).
- Centralizar `handleError` garante que toda violação de unique constraint em qualquer entity vira `409 Conflict` com a mesma mensagem, sem cada service reimplementar o parse do erro do Postgres.

**Trade-off aceito:** acopla toda entity/service a essa base — uma mudança na base afeta todos os módulos. Aceito porque o ganho de consistência (erro tratado igual em todo lugar) supera o acoplamento, dado que o backend é um monólito modular único.

## Consequências gerais

- Todo módulo novo que precise de persistência deve: entity estendendo `DefaultEntity<T>`, repository estendendo `DefaultRepository<T>` com `@Inject('DATA_SOURCE')`, service estendendo `BaseService`.
- Mudança de schema sempre passa por `migration:generate` + `migration:run` — nunca `synchronize` fora de ambiente descartável.
- Logs de erro de qualquer service que use `BaseService` já saem estruturados via `AppLogger`, sem setup adicional.
