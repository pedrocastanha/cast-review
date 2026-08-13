# SPEC: Comentários inline na PR do GitHub

- **Status:** Implementado
- **Data:** 2026-08-13
- **Implementa:** `docs/feature-implement-github-comments/ADR.md`

## Problema

Findings ruins ficam presos no Cast Review. O revisor no GitHub não vê o fail no hunk. Hoje o finding não tem arquivo nem linha, então postar “no trecho certo” é impossível.

## Objetivo

Ao terminar uma análise, o Nest publica **um** review `COMMENT` na PR, com um comentário inline por fail/warning que ancorar num hunk do diff. O autor do comentário é o dono do PAT. Reexecutar substitui, não empilha.

## Decisões (ver ADR)

D1 Nest posta / Python localiza · D2 um review, evento sempre `COMMENT` · D3 só fail/warning ancoráveis · D4 snap pelo patch · D5 PAT do usuário + marcador · D6 GitHub down ≠ análise error.

## Requisitos funcionais

| # | Requisito |
|---|-----------|
| RF1 | `Finding` ganha `path` (string) e `line` (int 1-based, arquivo novo). `endLine` opcional. `pass` pode omitir. |
| RF2 | Prompts de Test Reviewer e Architecture Reviewer exigem `path` + `line` em todo fail/warning. Sem path, o finding **continua no relatório** e no score; só não vai ao GitHub. |
| RF3 | Atalho “PR sem testes” preenche `path` com o primeiro arquivo `kind=source` da análise (senão o primeiro changed file). `line` pode ser `1` — o Nest estala no hunk. |
| RF4 | `normalize_findings` aceita `path` / `line` / `endLine`. `line` inválido (≤0, não int) vira ausente. Path com `..` ou absoluto é descartado. |
| RF5 | Depois do `report_ready` persistido, o Nest: (a) lista patches da PR, (b) seleciona fail/warning, (c) resolve âncora, (d) apaga inlines antigos `<!-- cast-review:`, (e) `createReview`. |
| RF6 | `createReview` usa `commit_id = headSha`, `event: "COMMENT"`, `body` com veredito + contagem, `comments[]` com `{ path, line, side: "RIGHT", body }`. |
| RF7 | Máximo **20** inlines por review, fails primeiro, depois warnings. Dedupe `(path, line, title)`. |
| RF8 | Sem nenhum inline resolvido: ainda cria o review **só com body** (parecer na conversa da PR), sem comments. |
| RF9 | Análise `completed` mesmo se o GitHub falhar. Snapshot ganha `githubComments`. SSE emite `github_comments_done` depois do `report_ready`. |
| RF10 | Front mostra `path:line` no finding. Na análise (ao vivo e salva) um status: postado (N), nada a postar, ou erro. Sem botão extra — posta sempre. |

## Requisitos não funcionais

| # | Requisito |
|---|-----------|
| RNF1 | `ai-api` não importa Octokit, não recebe PAT GitHub, não chama `api.github.com`. |
| RNF2 | Parse de patch + snap são funções puras, testáveis sem rede. |
| RNF3 | Body nunca inclui `apiKeys`, PAT nem o token. |
| RNF4 | Score, veredito, usage e edges do grafo **não mudam**. |
| RNF5 | Análises antigas sem `path`/`githubComments` renderizam como hoje. |

## Contratos

### Finding (campos novos)

```json
{
  "status": "fail",
  "title": "Controller gordo",
  "detail": "validação no controller",
  "conventionRef": "Controller HTTP é porta fina",
  "path": "apps/backend/src/modules/analyses/analyses.controller.ts",
  "line": 24,
  "endLine": 31
}
```

- `path`: relativo à raiz do repo, igual a `filename` do `pulls.listFiles`. Sem `..`, sem `/` inicial obrigatório — normalizar tirando `./` e `/` inicial.
- `line`: linha no arquivo **depois** do merge do head (lado RIGHT). Não é índice no patch.
- `endLine`: se presente, `endLine >= line`. Os dois precisam estar no conjunto RIGHT; senão cai para comentário de linha única em `line` (já snappada).

### Resolução de âncora (Nest, puro)

Entrada: `path`, `line`, `endLine?`, `files: { filename, status, patch }[]`.

```
1. Achar file onde filename === path (após normalizar).
2. Se status === "removed" ou patch vazio → skip.
3. Parsear hunks do patch (@@ -a,b +c,d @@).
4. Percorrer linhas do hunk:
   - ' ' ou '+' → entra em rightLines (número no arquivo novo)
   - '-' → só avança o old; não é âncora no v1
5. Se line ∈ rightLines → âncora = line.
   Senão âncora = argmin |r - line| em rightLines.
6. endLine: se ambos ∈ rightLines e endLine > âncora, manda start_line/line.
   Senão só `line`.
```

Parser de hunk é o formato unificado do GitHub (`patch` do listFiles). Sem dependência extra.

### Body de cada inline

```
<!-- cast-review:{analysisId} -->
**fail** · Architecture
Controller gordo

validação no controller

`Controller HTTP é porta fina`
```

- Primeira linha = marcador (HTML comment, invisível no GitHub).
- Reviewer: `Architecture` ou `Test Reviewer`.
- Sem `suggestion` block no v1.

### Body do review

```
<!-- cast-review:{analysisId} -->
Cast Review · **Pedir mudanças** · nota 85

3 comentário(s) no diff (2 fail, 1 warning).
Análise: {analysisId}
```

Veredito em português, igual ao herói do front. Sem link obrigatório (app é local).

### `report.githubComments`

```json
{
  "status": "posted" | "empty" | "error",
  "posted": 3,
  "skipped": 1,
  "reviewId": 123456789,
  "htmlUrl": "https://github.com/owner/repo/pull/9#pullrequestreview-123",
  "errorMessage": null
}
```

- `posted`: inlines aceitos no `createReview`.
- `skipped`: fail/warning que não ancoraram.
- `empty`: zero fail/warning no relatório (não chama createReview).
- `error`: Octokit falhou; `errorMessage` sanitizado (sem token).

### Evento SSE `github_comments_done`

```json
{
  "type": "github_comments_done",
  "payload": { "…githubComments…" }
}
```

`AgentEventType` no Nest e no front ganha esse valor. `applyReviewEvent` grava em `report.githubComments`. Front que não conhece o tipo ignora.

### `getPull` / sessão GitHub

`toPullSummary` inclui `headSha: pull.head.sha`. `createReview` usa esse SHA (o da head no momento do post — refetch do pull imediatamente antes de postar, não o SHA cacheado do início da análise, para não 422 se o branch andou).

## Fluxo

```
report_ready persistido
        │
        ▼
collect fail+warning (máx 20, fail primeiro)
        │
        ▼
listPullFiles (patches) + pulls.get (headSha fresco)
        │
        ▼
resolveAnchor(path, line) por finding
        │
        ▼
delete review comments do user com marcador cast-review
        │
        ▼
createReview(COMMENT, body, comments[])
        │
        ├─ ok  → githubComments.status=posted + SSE
        └─ err → githubComments.status=error  + SSE
                 análise continua completed
```

Apagar comentários: `pulls.listReviewComments` paginado, filtra `user.login === session.owner` **e** `body` contém `<!-- cast-review:`, depois `pulls.deleteReviewComment`. Não apaga review em si (o GitHub deixa o review vazio; aceitável). Não toca em comentário sem o marcador.

## Front

- `Finding` / `ReviewComment` ganham `path?`, `line?`.
- `CommentRow`: se tem path, mostra `apps/…/foo.ts:24` em mono.
- Após o stepper / no registro salvo: linha de status
  - `Postado na PR · 3 comentários` (link `htmlUrl` se existir)
  - `Nada a comentar na PR`
  - `Não deu pra comentar na PR` + `errorMessage`
- Sem toggle. Sem redesign fora da superfície de análise.

## Edge cases

- WHEN o finding não tem path THEN não entra em `comments[]`; incrementa `skipped`.
- WHEN o path não é arquivo da PR THEN skipped.
- WHEN `line` não está no hunk THEN usa a RIGHT mais próxima; ainda conta como posted.
- WHEN o arquivo é `removed` ou o patch veio vazio THEN skipped.
- WHEN só há `pass` THEN `status=empty`, nenhum `createReview`.
- WHEN a PR é do próprio usuário THEN o review ainda sai (`COMMENT`). Nunca `REQUEST_CHANGES`.
- WHEN o usuário roda de novo THEN inlines antigos com marcador somem; entra um review novo.
- WHEN o GitHub devolve 422/403 THEN análise `completed`, `githubComments.status=error`.
- WHEN o cliente fecha o SSE no `report_ready` THEN o post **ainda roda** (não está no `abortController` do browser). Persistência + best-effort log.
- WHEN dois findings caem na mesma `(path, line)` THEN um comentário, títulos concatenados com `---` ou o de maior severidade (`fail` ganha). Dedupe RF7.
- WHEN `endLine` não está no hunk THEN publica só `line`.

## Arquivos

| Peça | Onde |
|------|------|
| Finding + serialize | `apps/ai-api/app/domain/agents/entities.py` |
| Normalize path/line | `apps/ai-api/app/graph/utils/findings.py` |
| Prompts | `test_reviewer/prompt.md`, `architecture_reviewer/prompt.md` |
| Atalho sem testes + path | `apps/ai-api/app/graph/agents/test_reviewer/agent.py` |
| `headSha` | `repositories.service.ts` `toPullSummary` |
| Parse de patch + snap | `apps/backend/src/modules/analyses/helpers/patch-anchor.helper.ts` |
| Montar bodies + postar | `apps/backend/src/modules/analyses/helpers/github-review.helper.ts` |
| Orquestrar após report | `analyses.service.ts` |
| Tipos | `analyses.types.ts`, `apps/frontend/src/types/index.ts` |
| Hidratar evento | `apply-review-event.ts` |
| UI | `ReportView.tsx`, `AnalysisPage.tsx`, `AnalysisRecordPage.tsx` |

## Testes

Python (sem GitHub):

- `test_findings.py` — path/line entram no payload; path com `..` some; line ≤0 some; pass sem location ok.
- `test_reviewers.py` — atalho sem testes preenche `path` de um source file.

Nest (sem rede):

- `patch-anchor.helper.spec.ts` — hunk `@@ -1,3 +1,4 @@` com uma linha `+`; line exata; snap; arquivo removido; patch vazio.
- `github-review.helper.spec.ts` — só fail/warning; cap 20; dedupe; marcador no body; `event === "COMMENT"`; body do review traz o veredito.
- `apply-review-event.spec.ts` — hidrata `githubComments`; tipo desconhecido não quebra.

Integração opcional: mock Octokit `createReview` / `listReviewComments` / `deleteReviewComment` no service.

## Critérios de aceite

- [ ] Fail com `path`+`line` válidos vira review comment no arquivo e numa linha do hunk (exata ou snap).
- [ ] Warning idem. Pass não aparece na PR.
- [ ] Finding sem path ou em arquivo fora da PR não gera inline; relatório interno intacto.
- [ ] Autor da PR consegue receber o review (evento `COMMENT`).
- [ ] Segunda análise na mesma PR remove inlines `cast-review` anteriores e posta de novo.
- [ ] `createReview` falhando deixa a análise `completed` e mostra erro no front.
- [ ] Python tests de finding/atalho passam sem Octokit.
- [ ] Parse/snap cobertos por teste de tabela (patch fixture).

## Fora de escopo

| Item | Motivo |
|------|--------|
| GitHub App / bot | PAT do usuário é o produto. |
| `REQUEST_CHANGES` / `APPROVE` | Autor não pode na própria PR; sem gate automático (PRD). |
| Comentário só na conversa quando falha a âncora | D3 — sem trecho, não posta inline solto além do body do review. |
| `suggestion` / commit automático | Outro produto. |
| Comentar lado LEFT (remoções) | v1 só RIGHT. |
| Webhook a cada push | Run é manual. |
| Toggle no front para não postar | Sempre posta; desligar é feature à parte. |
| Responder thread existente | Sempre review novo. |

## Rastreio

| ID | História | RF |
|----|----------|-----|
| GHCM-01 | Location no finding + prompts | RF1, RF2, RF4 |
| GHCM-02 | Atalho test reviewer com path | RF3 |
| GHCM-03 | Parse de patch + snap | RF5 |
| GHCM-04 | createReview COMMENT + limpeza | RF5–RF8 |
| GHCM-05 | Persistência + SSE + análise não falha | RF9 |
| GHCM-06 | Front path:line + status | RF10 |

## Dimensões implícitas

| Dimensão | Resolução |
|----------|-----------|
| Validação | path normalizado; line > 0; path ∈ files da PR; line ∈ RIGHT ou snap. |
| Falha parcial | Alguns inlines skip, o resto posta. GitHub 422 no review inteiro → error, análise completed. |
| Idempotência | Delete por marcador + analysis nova. |
| Auth | Mesmo PAT; escopo `repo` já exigido. |
| Concorrência | Uma análise por request. Duas runs paralelas na mesma PR podem intercalar deletes — aceito no MVP. |
| Lifecycle | Comentário vive no GitHub. Apagar análise no Cast Review **não** apaga o review. |
| Observabilidade | `githubComments` no jsonb + log de falha já existente. Sem métrica nova. |
| Dependência externa | GitHub. Timeout/403/422 → error sanitizado. |
| Transição | `running → completed` inalterado. `githubComments` é anexo, não status da análise. |
