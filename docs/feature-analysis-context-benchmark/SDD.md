# SDD: Context Snapshot e Benchmark Lab

**Status:** MVP implementado
**Data:** 2026-08-22
**Relacionamento:** implementa `docs/feature-analysis-context-benchmark/PRD.md`

## 1. Objetivo técnico

Adicionar dois artefatos persistentes ao fluxo de análise:

1. `AnalysisContextSnapshot`: fotografia imutável do input e do contexto Graph usado pelo agente;
2. `BenchmarkCase`/`BenchmarkRun`: casos e execuções para comparar modelos com o mesmo input.

O Neo4j continua sendo a fonte operacional do Graph. Ele não será a fonte histórica de uma análise. A análise usará o snapshot persistido para auditoria e a execução de benchmark usará o snapshot materializado para reprodutibilidade.

## 2. Princípios de design

### 2.1 Snapshot, não referência viva

Não persistir apenas `repoId`, `pullNumber` e `sha`. O SHA pode deixar de estar disponível, o índice pode ser substituído e a PR pode receber novos commits.

O snapshot deve conter os dados necessários para responder:

> “O que o agente viu quando produziu este resultado?”

### 2.2 O Graph completo não é copiado para cada análise

O snapshot contém o subgrafo selecionado para o agente, não todos os nós do repositório.

O Graph completo continua no Neo4j para consultas operacionais. O snapshot histórico contém:

- nós usados;
- arestas usadas;
- contexto selecionado;
- metadados de ranking;
- conteúdo dos trechos efetivamente expostos ao agente;
- contadores do que ficou de fora.

### 2.3 Benchmark usa input congelado

Uma execução de benchmark nunca deve refazer fetch da PR ou consultar o Graph vivo como fonte principal. Ela recebe:

- diff congelado;
- arquivos congelados;
- convenções congeladas;
- Graph snapshot congelado;
- versões de prompt e indexador.

### 2.4 Sem ground truth, sem ranking objetivo

Uma comparação sem anotações pode mostrar diferenças, custo e sobreposição. Não pode afirmar que o modelo A está correto e o modelo B está errado.

## 3. Arquitetura atual relevante

- O Nest cria e persiste a entidade `Analysis` antes do run ([`analyses.service.ts`](../../apps/backend/src/modules/analyses/analyses.service.ts:66)).
- O backend envia diff, arquivos, convenções, `repoId` e `sha` ao `ai-api` ([`context-builder.helper.ts`](../../apps/backend/src/modules/analyses/helpers/context-builder.helper.ts:14)).
- O `change_analyzer` consulta o Graph e envia `relatedContext` como parte do evento `change_analysis_done` ([`change_analyzer/agent.py`](../../apps/ai-api/app/graph/nodes/change_analyzer/agent.py:20)).
- O relatório final é persistido em `Analysis.report` como JSONB ([`analysis.entity.ts`](../../apps/backend/src/modules/analyses/analysis.entity.ts:29)).
- O frontend já possui uma visão de análise com uma seção de mudanças e histórico ([`ReportView.tsx`](../../apps/frontend/src/components/analysis/ReportView.tsx:212)).

## 4. Componentes novos e alterados

### 4.1 `ai-api`

Alterar:

- `app/code_graph/models.py`
- `app/code_graph/context.py`
- `app/graph/state.py`
- `app/graph/nodes/change_analyzer/agent.py`
- `app/application/dto/schemas.py`

Responsabilidades:

  - produzir `AnalysisContextSnapshot` determinístico;
- incluir relações, distância, score e confiança;
- aceitar snapshot fornecido por benchmark;
- não consultar Neo4j quando o benchmark estiver usando contexto congelado;
- devolver o snapshot no evento `change_analysis_done`.

### 4.2 Backend

Adicionar:

- `analysis-context-snapshot.entity.ts`
- `analysis-context-snapshot.repository.ts`
- `benchmark-case.entity.ts`
- `benchmark-run.entity.ts`
- `benchmark.controller.ts`
- `benchmark.service.ts`

Alterar:

- `analyses.service.ts`
- `apply-review-event.ts`
- `analyses.types.ts`
- `shared/types.ts`
- `ai-api.client.ts`

Responsabilidades:

- persistir snapshots durante o stream;
- expor snapshot na consulta de análise;
- salvar análise como caso privado;
- carregar casos oficiais e privados;
- executar e persistir comparações.

### 4.3 Frontend

Alterar:

- `AnalysisReview`/`AnalysisRecord`;
- `ReportView`;
- página de análise salva.

Adicionar:

- `GraphContextPanel`;
- `BenchmarkPage`;
- `BenchmarkCaseDetail`;
- `BenchmarkComparison`;
- `GroundTruthEditor` em etapa posterior.

## 5. Modelo do snapshot

### 5.1 `AnalysisContextSnapshot`

```ts
type AnalysisContextSnapshot = {
  schemaVersion: '1';
  snapshotHash: string;
  createdAt: string;
  analysisId: string | null;

  repository: {
    repoId: string;
    owner: string;
    repo: string;
    pullNumber: number;
    baseSha: string | null;
    requestedSha: string | null;
  };

  graph: {
    indexedSha: string | null;
    stale: boolean;
    indexerVersion: string;
    graphSchemaVersion: string;
    queryVersion: string;
  };

  input: {
    diffHash: string;
    changedFiles: Array<{
      path: string;
      diff: string;
      fullContent: string;
    }>;
    conventions: string;
  };

  selected: {
    changedSymbols: GraphSnapshotNode[];
    callers: GraphSnapshotNode[];
    callees: GraphSnapshotNode[];
    tests: GraphSnapshotNode[];
    deadCodeCandidates: GraphSnapshotNode[];
    repoMap: string;
  };

  edges: GraphSnapshotEdge[];

  budget: {
    tokenBudget: number;
    budgetUsed: number;
    truncated: boolean;
    omittedNodes: number;
    omittedEdges: number;
  };

  rendered: {
    graphContextBlock: string;
  };
};

type GraphSnapshotNode = {
  id: string;
  kind: string;
  path: string;
  name: string;
  signature: string;
  body: string | null;
  line: number;
  endLine: number;
  contentHash: string | null;
  relation: 'changed' | 'caller' | 'callee' | 'test' | 'dead_code';
  distance: number | null;
  score: number | null;
  confidence: 'confirmed' | 'inferred' | 'unresolved' | 'stale';
  reason: string;
};

type GraphSnapshotEdge = {
  fromId: string;
  toId: string;
  kind: 'defines' | 'references' | 'imports' | 'tests';
  weight: number;
  confidence: 'confirmed' | 'inferred' | 'stale';
};
```

O `graphContextBlock` é importante: ele permite mostrar ao usuário o bloco textual efetivamente montado para os reviewers, sem depender de reconstrução posterior do prompt.

API keys, tokens GitHub e configurações secretas nunca entram no snapshot.

### 5.2 Hash e imutabilidade

`snapshotHash` é SHA-256 de uma serialização canônica dos campos sem `createdAt` e sem campos voláteis.

O backend não deve atualizar um snapshot existente. Uma nova análise ou nova versão de benchmark cria outro snapshot.

## 6. Persistência

### 6.1 Tabela `analysis_context_snapshots`

```text
id                    UUID primary key
analysis_id           UUID unique, foreign key analyses.id
schema_version        varchar not null
snapshot_hash         varchar not null
graph_snapshot        jsonb not null
created_at            timestamptz not null
```

Separar o snapshot da tabela `analyses` evita aumentar indefinidamente o JSONB do relatório e permite uma política de retenção própria.

O endpoint de análise retorna um resumo e um link/identificador do snapshot. O conteúdo completo pode ser buscado sob demanda.

### 6.2 Tabela `benchmark_cases`

```text
id                    UUID primary key
slug                  varchar nullable
title                 varchar not null
kind                  varchar not null -- curated | private
evaluation_mode       varchar not null -- exploratory | scored
owner_id              UUID nullable
source                jsonb not null
input_snapshot        jsonb not null
graph_snapshot        jsonb not null
ground_truth          jsonb nullable
version               int not null
created_at            timestamptz not null
updated_at            timestamptz not null
```

Casos `curated` são somente leitura para o usuário. Casos `private` pertencem ao `owner_id`.

### 6.3 Tabela `benchmark_runs`

```text
id                    UUID primary key
case_id               UUID foreign key benchmark_cases.id
requested_by          UUID foreign key users.id
status                varchar not null -- queued | running | completed | error
models                jsonb not null
prompt_version        varchar not null
graph_snapshot_hash   varchar not null
results               jsonb nullable
usage                 jsonb nullable
error_message         text nullable
created_at            timestamptz not null
finished_at           timestamptz nullable
```

Uma execução registra a configuração inteira para que o resultado seja interpretável meses depois.

## 7. Fluxo da análise normal

```text
Nest busca PR
    ↓
ai-api recebe diff + arquivos + repoId + sha
    ↓
change_analyzer consulta Graph
    ↓
ai-api monta relatedContext + AnalysisContextSnapshot
    ↓
SSE change_analysis_done inclui snapshot
    ↓
Nest persiste snapshot associado à Analysis
    ↓
frontend exibe relatório e contexto usado
```

O evento atual `change_analysis_done` pode ser estendido com:

```json
{
  "files": [],
  "hasTests": true,
  "hasMigration": false,
  "relatedContext": {},
  "graphSnapshotId": "uuid",
  "graphSnapshotHash": "sha256"
}
```

O payload completo deve ser persistido pelo backend no `analysis_context_snapshots`.

## 8. Fluxo “Salvar como benchmark”

1. Usuário abre uma análise concluída.
2. Clica em “Salvar como benchmark”.
3. Backend valida que a análise pertence ao usuário.
4. Backend copia input snapshot e Graph snapshot.
5. Caso nasce como `private` e `exploratory`.
6. Usuário define nome, categoria e tags.
7. Caso aparece na área Benchmark Lab.

O benchmark não aponta para o registro da análise. Ele recebe uma cópia imutável para preservar o histórico mesmo se a análise original for apagada.

## 9. Fluxo de benchmark

1. Usuário seleciona um caso.
2. Seleciona um ou mais modelos para cada reviewer.
3. Backend cria um `benchmark_run`.
4. Cada combinação de modelo roda contra o mesmo `input_snapshot` e `graph_snapshot`.
5. Backend persiste resultado, custo, tokens, duração e versão do prompt.
6. Frontend apresenta comparação lado a lado.

O `ai-api` recebe um modo de execução com snapshot congelado:

```ts
type AgentRunRequest = ExistingAgentRunRequest & {
  frozenContext?: {
    graphSnapshot: AnalysisContextSnapshot;
    inputSnapshot: AnalysisContextSnapshot['input'];
  };
};
```

Quando `frozenContext` existe, `change_analyzer` não consulta o Neo4j para montar o contexto. Ele usa o snapshot fornecido.

## 10. API proposta

### Análises

```http
GET /analyses/:id/context-snapshot
```

Retorna o `AnalysisContextSnapshot`, respeitando o mesmo controle de acesso da análise.

### Benchmark cases

```http
GET  /benchmarks/cases
POST /benchmarks/cases/from-analysis/:analysisId
GET  /benchmarks/cases/:caseId
PATCH /benchmarks/cases/:caseId
DELETE /benchmarks/cases/:caseId
```

### Benchmark runs

```http
POST /benchmarks/cases/:caseId/runs
GET  /benchmarks/runs/:runId
GET  /benchmarks/cases/:caseId/runs
```

O primeiro MVP pode executar runs de forma síncrona via stream controlado. Para múltiplos modelos e casos, a implementação deve migrar para job assíncrono.

## 11. Casos oficiais

Casos oficiais devem ser mantidos em arquivos versionados, por exemplo:

```text
benchmarks/cases/
  api-contract-001.json
  missing-test-001.json
  stale-caller-001.json
  migration-impact-001.json
```

Cada fixture precisa conter licença/origem e versão. O seed transforma os fixtures em `benchmark_cases` com `kind=curated`.

O campo JSONB `source` também congela `originalTitle` e `body`, ambos obtidos da PR no momento da geração. O frontend usa esses campos para apresentar a intenção declarada pelo autor antes da escolha dos modelos. Comentários HTML de templates são removidos apenas na renderização; o valor persistido permanece íntegro. Arquivos e diff vêm de `input_snapshot`, com o diff completo sob divulgação progressiva.

A migration `AddCuratedBenchmarkPullBody1787586000000` atualiza instalações que já executaram o seed inicial. Novas instalações recebem o mesmo conteúdo diretamente do fixture importado pelo seed, sem chamadas externas durante a migration.

Um caso oficial só entra no ranking se:

- tiver input congelado;
- tiver Graph snapshot;
- tiver ground truth revisado;
- tiver categoria e dificuldade;
- tiver teste automatizado de carregamento.

## 12. Ground truth

```ts
type GroundTruth = {
  annotations: Array<{
    id: string;
    title: string;
    detail: string;
    path: string;
    line: number | null;
    severity: 'critical' | 'high' | 'medium' | 'low';
    category: string;
    source: 'human' | 'accepted-pr-comment' | 'maintainer';
  }>;
  reviewedBy: string | null;
  reviewedAt: string | null;
  version: number;
};
```

Comentários originais da PR podem ser evidência, mas não devem ser automaticamente tratados como verdade. Eles precisam passar por revisão ou rotulagem explícita.

## 13. Comparação entre modelos

Cada finding normalizado deve receber uma chave de comparação baseada em:

```text
caseId + path + line bucket + category + normalized title
```

Para evitar que pequenas diferenças textuais impeçam a comparação, o sistema deve permitir agrupamento por localização e categoria.

O resultado deve separar:

- findings exclusivos do modelo A;
- findings exclusivos do modelo B;
- findings equivalentes encontrados por ambos;
- findings sem localização válida;
- findings duplicados.

## 14. Segurança

- Todas as rotas de análise e benchmark exigem autenticação.
- Caso privado sempre filtra por `owner_id`.
- O backend nunca persiste `apiKeys` no input snapshot.
- Logs não podem incluir diff, corpo de arquivo ou token.
- Casos oficiais devem respeitar licença e origem do código.
- O benchmark não deve enviar o mesmo segredo para múltiplos modelos sem consentimento explícito.
- O usuário deve conseguir apagar casos privados e seus runs.

## 15. Performance e limites

- Snapshot de análise deve ser limitado ao contexto selecionado, não ao Graph completo.
- `graphContextBlock` deve respeitar o limite de caracteres/tokens já usado pelo prompt.
- Casos benchmark devem possuir limite máximo de arquivos e tamanho.
- Comparações com muitos modelos devem ser jobs assíncronos.
- O frontend deve carregar o snapshot completo sob demanda, não junto da lista de todas as análises.

## 16. Testes

### Unitários

- serialização canônica produz hash estável;
- snapshot não contém API key;
- classificação de relação e distância;
- comparação de findings equivalentes;
- métricas com true positive, false positive e false negative;
- autorização de caso privado.

### Integração

- evento `change_analysis_done` persiste snapshot;
- análise salva recupera snapshot depois de reindexação;
- benchmark privado é criado a partir de análise;
- execução benchmark usa snapshot congelado mesmo sem Neo4j;
- casos oficiais são carregados pelos fixtures;
- casos oficiais preservam título e descrição originais da PR;
- dois modelos recebem o mesmo hash de contexto.

### Aceitação

1. Indexar um fixture com caller direto e transitivo.
2. Rodar uma análise.
3. Reindexar o repositório com relações diferentes.
4. Abrir a análise antiga e confirmar que o Graph exibido não mudou.
5. Salvar a análise como benchmark.
6. Rodar com dois modelos.
7. Confirmar que ambos receberam o mesmo `graphSnapshotHash`.
8. Adicionar uma anotação e confirmar métricas scored.

## 17. Migração e rollout

### Fase A

- criar tabela de snapshots;
- persistir snapshot no `change_analysis_done`;
- retornar snapshot na análise;
- exibir contexto no frontend.

### Fase B

- criar casos privados a partir de análise;
- permitir reexecução com um modelo;
- persistir benchmark runs.

### Fase C

- casos oficiais versionados;
- comparação de múltiplos modelos;
- exploração sem ground truth.

### Fase D

- ground truth editor;
- métricas scored;
- ranking e regressão interna.

Análises antigas não terão snapshot. A UI deve mostrar “contexto histórico indisponível” sem quebrar o relatório existente.

## 18. Rastreabilidade

| PRD | Decisão técnica |
|---|---|
| SNAP-01/02/03 | `AnalysisContextSnapshot` + `GraphContextPanel` |
| BENCH-01 | fixtures versionados + seed `curated` |
| BENCH-02 | `POST /benchmarks/cases/from-analysis/:analysisId` |
| BENCH-03 | `BenchmarkRun` com matriz de modelos |
| BENCH-04 | `evaluationMode` + `GroundTruth` |
| RF-S1 a RF-S7 | tabela `analysis_context_snapshots` |
| RF-B1 a RF-B12 | tabelas `benchmark_cases` e `benchmark_runs` + contexto da PR no Lab |

## 19. Notas da implementação

- O evento `change_analysis_done` transporta o snapshot completo. O `Analysis.report` mantém apenas a análise normalizada; o snapshot fica em `analysis_context_snapshots`.
- `frozenContext.graphSnapshot` é propagado no estado do LangGraph. O `change_analyzer` usa o `rendered.relatedContext` congelado e não chama Neo4j.
- O MVP normaliza a seleção também em `selected.nodes`, além das listas por relação, para simplificar filtros e renderização sem reconstruir o conjunto.
- Runs são síncronos e sequenciais, limitados a quatro modelos. A chave OpenAI não é armazenada.
- O catálogo oficial v1 contém oito fixtures exploratórios de repositórios MIT. O gerador fixa o head SHA, materializa input/snapshot e valida hashes; a migration insere os casos de forma idempotente por ID/slug.
- O snapshot oficial v1 declara `graphScope=changed-files`: representa arquivos alterados, testes relacionados e relações de co-change/import detectáveis, sem sugerir uma indexação integral do repositório.
- O Lab apresenta o body original congelado, remove comentários invisíveis de template somente para leitura e mantém lista de arquivos/diff disponíveis mesmo quando um caso privado antigo não possui body.
- `scored` e o ground truth editor continuam fora do MVP entregue.
