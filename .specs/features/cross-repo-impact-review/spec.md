# Cross-Repo Impact Review Specification

**Status:** Implemented — validation in progress

**Data:** 2026-08-25

**PRD:** `docs/feature-cross-repo-impact-review/PRD.md`
**Base:** `.specs/features/cross-repo-core/spec.md`

## Problem Statement

O pipeline de análise recebe diff, arquivos alterados e contexto de um único repositório. Embora o Cross-Repo Core já materialize relações HTTP entre membros de um projeto, esse conhecimento ainda não participa da revisão de PR. O novo comportamento precisa ser opt-in, auditável e incapaz de degradar a disponibilidade do fluxo local.

## Goals

- Permitir escolher entre análise local e análise com impacto de projeto por execução.
- Preservar integralmente o caminho atual quando o modo multi-repo estiver desligado.
- Comparar contratos HTTP base/head e atravessar relações autorizadas entre repositórios.
- Entregar evidências cross-repo limitadas por orçamento aos reviewers.
- Persistir um snapshot imutável e reproduzível do contexto efetivamente usado.
- Degradar com transparência para análise local diante de falhas ou índices incompletos.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Ativação automática | A decisão de custo e escopo pertence ao usuário nesta release |
| Auto-indexação | Não deve existir mutação ou latência surpresa ao iniciar review |
| Matching semântico/LLM | O primeiro slice exige evidência determinística |
| Outros protocolos | Reutilizar primeiro os contratos HTTP já suportados |
| Inline comment cross-repo | GitHub só aceita âncoras válidas no diff da PR analisada |
| Chat, Cast toggle e roles | Permanecem nas releases seguintes |

## Definitions

- **Source repository:** repositório que contém a PR.
- **Project repository:** membro ativo do projeto selecionado.
- **Repository mode:** execução atual, sem consulta ao Project Graph.
- **Project mode:** execução que solicita contexto cross-repo.
- **Exact:** todos os artefatos selecionados possuem SHA válido e evidência utilizável.
- **Degraded:** somente parte do escopo solicitado pôde ser usada.
- **Fallback:** nenhum contexto cross-repo utilizável; execução efetiva volta ao repository mode.
- **Contract delta:** diferença determinística entre contratos extraídos no base e no head da PR.
- **Impact candidate:** possível efeito sustentado por uma relação; não equivale a quebra comprovada.

## Input Contract

O comando de nova análise SHALL aceitar um escopo discriminado:

```ts
type ImpactScope =
  | { mode: 'repository' }
  | { mode: 'project'; projectId: string };
```

Regras:

- Ausência de `impactScope` SHALL ser tratada como `{ mode: 'repository' }` para compatibilidade.
- `projectId` SHALL ser rejeitado quando `mode = repository`.
- `projectId` SHALL ser obrigatório e UUID válido quando `mode = project`.
- O backend SHALL validar o escopo antes de persistir ou iniciar a execução.

## User Stories

### P1: Escolher escopo da análise ⭐ MVP

**User Story:** Como autor da PR, quero ativar impacto multi-repo somente quando ele trouxer valor, para controlar custo, latência e ruído.

**Why P1:** É o contrato que torna a feature opcional de verdade e protege o fluxo atual.

**Acceptance Criteria:**

1. WHEN a tela de uma nova execução abrir THEN o sistema SHALL selecionar `Apenas esta PR`.
2. WHEN o usuário não alterar o escopo THEN o frontend SHALL enviar repository mode ou omitir `impactScope`.
3. WHEN repository mode for executado THEN backend e AI API SHALL NOT consultar projeto, status de membros ou Project Graph.
4. WHEN o source repository não pertencer a projeto elegível THEN a UI SHALL desabilitar o toggle e explicar como associá-lo a um projeto.
5. WHEN existir exatamente um projeto elegível THEN a UI SHALL pré-selecioná-lo após o toggle ser ativado.
6. WHEN existirem múltiplos projetos elegíveis THEN a UI SHALL exigir seleção explícita antes de habilitar a execução.
7. WHEN o usuário iniciar outra execução THEN o toggle SHALL voltar ao estado desligado.

**Independent Test:** Abrir uma PR elegível, executar uma review sem tocar no toggle e provar que nenhum endpoint de Projects/Project Graph foi chamado.

### P1: Validar elegibilidade e autorização ⭐ MVP

**User Story:** Como usuário, quero usar somente projetos próprios e entender a prontidão dos índices antes da execução.

**Why P1:** Evita vazamento entre usuários e expectativas falsas sobre cobertura.

**Acceptance Criteria:**

1. WHEN a elegibilidade for consultada THEN o sistema SHALL retornar somente projetos próprios, ativos, com o source repository como membro ativo e ao menos dois membros ativos.
2. WHEN um projeto elegível for exibido THEN a resposta SHALL incluir nome, quantidade de membros e estado resumido dos índices sem incluir código-fonte.
3. WHEN project mode for solicitado com projeto inexistente, inativo, de outro usuário ou sem o source repository THEN o backend SHALL responder not found sem revelar qual condição falhou.
4. WHEN um membro estiver não indexado, stale ou com erro THEN a UI SHALL mostrar o estado e um caminho para abrir o projeto.
5. WHEN o usuário ativar project mode THEN o sistema SHALL NOT enfileirar indexações automaticamente.

**Independent Test:** Usar dois usuários e provar que o segundo não descobre nem executa uma análise com o projectId do primeiro.

### P1: Congelar o escopo efetivo ⭐ MVP

**User Story:** Como auditor, quero saber quais repositórios e versões realmente entraram na review.

**Why P1:** Sem um conjunto de SHAs congelado, o resultado não é reproduzível.

**Acceptance Criteria:**

1. WHEN project mode iniciar THEN o backend SHALL resolver os membros ativos e seus SHAs antes de chamar a AI API.
2. WHEN o source repository for resolvido THEN o snapshot SHALL registrar base SHA e head SHA da PR.
3. WHEN um repositório secundário possuir índice utilizável THEN o snapshot SHALL registrar repoId, indexed SHA, status e inclusão.
4. WHEN um repositório secundário for omitido THEN o snapshot SHALL registrar repoId, status e omission reason.
5. WHEN o projeto ou seus índices mudarem após o início THEN a execução SHALL continuar usando o escopo congelado.

**Independent Test:** Iniciar uma execução, reindexar um membro durante o pipeline e provar que o snapshot e as queries continuam referenciando o SHA original.

### P1: Calcular delta de contratos ⭐ MVP

**User Story:** Como revisor, quero distinguir contratos adicionados, removidos, modificados e apenas tocados para avaliar o risco correto.

**Why P1:** Extrair somente o head perde rotas removidas, que são o principal caso de breaking change.

**Acceptance Criteria:**

1. WHEN um arquivo alterado existir no base e no head THEN o sistema SHALL extrair contratos das duas versões.
2. WHEN um arquivo for removido THEN o sistema SHALL extrair os contratos do conteúdo base.
3. WHEN um arquivo for adicionado THEN o sistema SHALL extrair os contratos do conteúdo head.
4. WHEN método ou rota mudar dentro da mesma evidência identificável THEN o sistema SHALL classificar o delta como `modified` e preservar before/after.
5. WHEN um contrato existir apenas no base THEN SHALL ser `removed`.
6. WHEN um contrato existir apenas no head THEN SHALL ser `added`.
7. WHEN o contrato permanecer igual em um arquivo alterado THEN SHALL ser `touched`.
8. WHEN uma modificação não puder ser pareada com segurança THEN o sistema SHALL emitir `removed` + `added`, nunca inventar um par.

**Independent Test:** Uma fixture altera `DELETE /v1/projects/:id` para `DELETE /v2/projects/:id` e produz um delta reproduzível com before e after.

### P1: Resolver blast radius cross-repo ⭐ MVP

**User Story:** Como revisor, quero encontrar consumidores e provedores externos relacionados aos contratos alterados.

**Why P1:** É o valor central da feature.

**Acceptance Criteria:**

1. WHEN um provider for `removed`, `modified` ou `touched` THEN o sistema SHALL buscar consumers confirmados nos outros repositórios congelados.
2. WHEN um consumer for `added` ou `modified` THEN o sistema SHALL buscar provider confirmado nos outros repositórios congelados.
3. WHEN método e rota normalizada não coincidirem THEN o sistema SHALL NOT produzir relação confirmada.
4. WHEN consumer e provider pertencerem ao mesmo repositório THEN a relação SHALL NOT ser classificada como cross-repo.
5. WHEN múltiplos providers ou consumers coincidirem THEN cada evidência SHALL permanecer identificável.
6. WHEN nenhum provider for encontrado para consumer novo/modificado THEN o sistema MAY produzir `integration_gap`, marcado como unresolved e sem fabricar provider.
7. WHEN um provider removido/modificado tiver consumers confirmados THEN o impacto SHALL ser `breaking_candidate`.
8. WHEN um provider touched preservar o contrato e possuir consumers THEN o impacto SHALL ser `behavioral_candidate`.

**Independent Test:** Uma PR fixture no backend remove uma rota consumida pelo frontend e retorna consumer path, line, symbol, framework e SHA.

### P1: Entregar contexto verificável aos agentes ⭐ MVP

**User Story:** Como Tech Lead, quero que o agente use somente relações visíveis e cite o que sustentou cada finding.

**Why P1:** Impede que o grafo vire justificativa opaca para alucinações.

**Acceptance Criteria:**

1. WHEN impactos forem selecionados THEN o bloco enviado aos reviewers SHALL separar fatos determinísticos, classificação de risco e lacunas.
2. WHEN um reviewer gerar finding cross-repo THEN o finding SHALL referenciar um evidenceId existente no snapshot.
3. WHEN um finding mencionar repositório, path, linha, método ou rota THEN os valores SHALL coincidir com a evidência referenciada.
4. WHEN não houver evidência cross-repo THEN o agente SHALL NOT afirmar que outro repositório será afetado.
5. WHEN a relação estiver stale ou unresolved THEN o prompt e o resultado SHALL comunicar a limitação.
6. WHEN o orçamento for excedido THEN a seleção SHALL priorizar breaking candidates confirmados, depois behavioral candidates, integration gaps e informational.

**Independent Test:** Forçar uma saída com path inexistente e provar que a validação a rejeita ou remove antes do relatório final.

### P1: Persistir e exibir o snapshot ⭐ MVP

**User Story:** Como dono da PR, quero ver exatamente o que o agente viu.

**Why P1:** Auditabilidade é parte do produto, não ferramenta interna.

**Acceptance Criteria:**

1. WHEN project mode produzir contexto THEN o sistema SHALL persistir snapshot schema v2 com escopo, contract deltas, impactos e evidências.
2. WHEN project mode degradar ou cair em fallback THEN o snapshot SHALL persistir requested mode, effective mode, status e fallback reason.
3. WHEN o snapshot for serializado THEN seu hash SHALL excluir somente campos voláteis explicitamente definidos e cobrir todo o conteúdo de evidência.
4. WHEN uma análise histórica for aberta THEN a UI SHALL carregar o snapshot persistido, nunca rematerializar a partir do grafo vivo.
5. WHEN a UI exibir um impacto THEN SHALL mostrar projeto, SHAs, direção, método, rota, arquivos, linhas, confiança e risco.
6. WHEN o snapshot for truncado THEN SHALL mostrar contagem e motivo das omissões.
7. WHEN uma análise v1 single-repo for aberta THEN a UI SHALL continuar funcionando sem migração destrutiva.

**Independent Test:** Concluir a análise, reindexar ambos os repositórios e provar que o replay e o snapshotHash permanecem inalterados.

### P1: Degradar sem derrubar a review ⭐ MVP

**User Story:** Como usuário, quero receber a análise local mesmo se o contexto multi-repo estiver indisponível.

**Why P1:** A feature opcional não pode reduzir a confiabilidade do produto principal.

**Acceptance Criteria:**

1. WHEN somente parte dos repositórios estiver utilizável THEN effective mode SHALL ser `project`, status SHALL ser `degraded` e os demais SHALL ser omitidos com motivo.
2. WHEN nenhum repositório secundário estiver utilizável THEN effective mode SHALL ser `repository`, status SHALL ser `fallback` e a análise local SHALL continuar.
3. WHEN Neo4j, Redis ou a query cross-repo falhar THEN a análise local SHALL continuar e o erro SHALL ser registrado como fallback reason seguro.
4. WHEN contract delta extraction falhar para um arquivo THEN os demais arquivos SHALL continuar e a omissão SHALL ser registrada.
5. WHEN a UI receber degraded/fallback THEN SHALL mostrar aviso persistente sem apresentar o contexto como completo.
6. WHEN repository mode for escolhido THEN a ausência de Project Graph SHALL NOT ser tratada como degraded ou fallback.

**Independent Test:** Derrubar Neo4j durante project mode e verificar que os reviewers locais e o relatório continuam disponíveis.

### P1: Preservar escopo em retomada e publicação ⭐ MVP

**User Story:** Como usuário, quero que aprovações, retomadas e publicação respeitem o contexto original.

**Why P1:** Alterar o escopo no meio da execução quebraria a auditabilidade.

**Acceptance Criteria:**

1. WHEN uma análise for retomada THEN o sistema SHALL reutilizar o snapshot/escopo congelado e SHALL NOT aceitar novo projectId.
2. WHEN PRD ou spec forem rejeitados e regenerados THEN os agentes SHALL reutilizar o mesmo contexto congelado.
3. WHEN um finding apontar arquivo de outro repositório THEN o publicador SHALL NOT criar comentário inline para esse finding.
4. WHEN a publicação incluir resumo geral THEN impactos cross-repo MAY aparecer com repo/path/linha e aviso de evidência externa.
5. WHEN o histórico listar uma análise THEN SHALL indicar repository, project exact, project degraded ou repository fallback.

**Independent Test:** Retomar uma análise após alterar o projeto e provar que nenhum membro ou SHA novo entra no contexto.

### P2: Executar benchmark multi-repo

**User Story:** Como engenheiro de IA, quero comparar modelos sobre o mesmo contexto cross-repo congelado.

**Why P2:** É essencial para avaliação de qualidade/custo, mas não bloqueia o valor da review opt-in.

**Acceptance Criteria:**

1. WHEN uma análise multi-repo elegível for salva como benchmark THEN o caso SHALL copiar input e snapshot v2 imutáveis.
2. WHEN modelos diferentes executarem o caso THEN SHALL usar exatamente o mesmo snapshotHash e SHALL NOT consultar o grafo vivo.
3. WHEN o resultado for exibido THEN SHALL separar findings cross-repo corretos, omitidos e sem evidência, além de tokens, custo e latência.

**Independent Test:** Rodar dois modelos no mesmo caso e verificar snapshotHash idêntico nas duas execuções.

## Snapshot v2 — Required Shape

O schema final pode variar no design, mas SHALL representar os seguintes campos sem perda:

```ts
interface CrossRepoAnalysisContextSnapshotV2 {
  schemaVersion: '2';
  snapshotHash: string;
  createdAt: string;
  analysisId: string | null;
  scope: {
    requestedMode: 'repository' | 'project';
    effectiveMode: 'repository' | 'project';
    status: 'exact' | 'degraded' | 'fallback';
    projectId: string | null;
    projectName: string | null;
    fallbackReason: string | null;
  };
  source: {
    repoId: string;
    pullNumber: number;
    baseSha: string;
    headSha: string;
  };
  repositories: Array<{
    repoId: string;
    indexedSha: string | null;
    indexStatus: string;
    included: boolean;
    omissionReason: string | null;
  }>;
  contractChanges: ContractChange[];
  impacts: CrossRepoImpact[];
  evidence: CrossRepoEvidence[];
  budget: {
    tokenBudget: number;
    budgetUsed: number;
    truncated: boolean;
    omittedImpacts: number;
    omittedEvidence: number;
  };
  versions: {
    indexerVersion: string;
    graphSchemaVersion: string;
    queryVersion: string;
    contractExtractorVersion: string;
  };
  rendered: {
    graphContextBlock: string;
    relatedContext: Record<string, unknown>;
  };
}
```

Segredos, tokens de autenticação e chaves de modelo SHALL NOT aparecer em nenhum campo.

## Edge Cases

- Source repository pertence a zero, um ou vários projetos.
- Projeto possui somente um membro ativo após edição concorrente.
- Projeto é removido depois do preflight e antes do start.
- Índice secundário está stale, em fila, falhou ou desapareceu.
- PR adiciona, remove ou renomeia arquivo com controller.
- Rota muda somente o nome do parâmetro (`:id` → `:projectId`) e normaliza para a mesma identidade.
- Método muda com rota igual.
- Um arquivo contém múltiplos controllers ou múltiplos routers.
- Existem múltiplos providers confirmados para método + rota.
- O diff é truncado pelo GitHub, mas conteúdos base/head estão disponíveis.
- O source head ainda não possui índice completo.
- Budget inclui menos evidências do que o grafo encontrou.
- Usuário perde acesso ao GitHub depois do snapshot ser persistido.
- Snapshot histórico v1 é aberto em frontend que suporta v2.
- A conexão SSE cai e a análise é retomada.

## Non-Functional Requirements

1. Repository mode SHALL preserve current external-call count and SHALL add zero cross-repo prompt tokens.
2. Preflight SHALL NOT call LLM or carregar conteúdo de arquivos.
3. Project traversal SHALL be bounded by an explicit token/evidence budget and deterministic ordering.
4. Snapshot hashing SHALL be canonical and covered by regression tests.
5. Authorization SHALL occur in backend control plane before any repoId/SHA reach the AI API.
6. Cross-repo failures SHALL produce structured telemetry without source code or secrets.
7. Existing analysis snapshots v1 and benchmark cases SHALL remain readable.

## Requirement Traceability

| Requirement ID | Story | Priority | Status |
| --- | --- | --- | --- |
| CRIR-01 | Default repository mode | P1 | Pending |
| CRIR-02 | Eligibility discovery | P1 | Pending |
| CRIR-03 | Project ownership and membership | P1 | Pending |
| CRIR-04 | Zero cross-repo work when disabled | P1 | Pending |
| CRIR-05 | Frozen repository/SHA scope | P1 | Pending |
| CRIR-06 | Base/head contract delta | P1 | Pending |
| CRIR-07 | Directional cross-repo traversal | P1 | Pending |
| CRIR-08 | Risk and confidence classification | P1 | Pending |
| CRIR-09 | Evidence-bound agent context | P1 | Pending |
| CRIR-10 | Immutable snapshot v2 | P1 | Pending |
| CRIR-11 | Cross-repo result UI | P1 | Pending |
| CRIR-12 | Degraded and fallback execution | P1 | Pending |
| CRIR-13 | Authorization and secret exclusion | P1 | Pending |
| CRIR-14 | Deterministic budget/truncation | P1 | Pending |
| CRIR-15 | Resume and history consistency | P1 | Pending |
| CRIR-16 | Safe GitHub publication | P1 | Pending |
| CRIR-17 | Frozen multi-repo benchmark | P2 | Pending |

**Coverage:** 17 requirements, 17 mapped to user stories, 0 unmapped.

## Success Criteria

- [ ] Analysis without `impactScope` remains backward compatible and performs no Project Graph call.
- [ ] Opt-in dogfood identifies `cast-frontend` consumers from a backend contract change.
- [ ] Every surfaced cross-repo finding resolves to persisted evidence.
- [ ] Neo4j/Redis/index failures preserve completion of repository-only reviewers.
- [ ] Replay remains identical after project edits and reindexing.
- [ ] Unauthorized project IDs return not found without leaking metadata.
