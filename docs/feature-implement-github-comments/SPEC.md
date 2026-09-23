# SPEC: Comentários inline na PR do GitHub

- **Status:** Implementado
- **Data:** 2026-08-13
- **Implementa:** `docs/feature-implement-github-comments/ADR.md`

## Problema

Findings ruins ficam presos no Cast Review. O revisor no GitHub não vê o fail no hunk. Hoje o finding não tem arquivo nem linha, então postar “no trecho certo” é impossível.

## Objetivo

Ao terminar uma análise, o Nest publica **um** review `COMMENT` na PR, com um comentário inline por fail/warning que ancorar num hunk do diff. O autor do comentário é o dono do PAT. Reexecutar substitui, não empilha.

## Decisões (ver ADR)

D1 Nest posta / Python deriva localização por citação literal · D2 um review, evento sempre `COMMENT` · D3 só fail/warning ancoráveis · D4 âncora exata no patch · D5 PAT do usuário + marcador · D6 GitHub down ≠ análise error.

## Requisitos funcionais

| # | Requisito |
|---|-----------|
| RF1 | `Finding` inclui `path` e uma citação `evidence` opcional. A API deriva `line` e `endLine` do arquivo completo. `pass` pode omitir localização. |
| RF2 | Prompts de Test Reviewer e Architecture Reviewer pedem `path` + linhas completas de código copiadas literalmente em `evidence`. Sem citação verificável, o finding **continua no relatório** e no score, sem localização ou comentário inline. |
| RF3 | Atalho “PR sem testes” pode indicar o arquivo source, mas não inventa uma linha: sem trecho específico, não gera comentário inline. |
| RF4 | `normalize_findings` valida se `path` é arquivo alterado e se `evidence` ocorre uma única vez em `fullContent`. A linha vem dessa ocorrência; `line` e `endLine` do modelo são ignoradas. Path inválido, citação ausente, ambígua ou inexistente deixa o finding sem localização. |
| RF5 | Depois do `report_ready` persistido, o Nest: (a) lista patches da PR, (b) seleciona fail/warning, (c) resolve âncora e confere cada linha de `evidence` com o texto do patch atual, (d) apaga inlines antigos `<!-- cast-review:`, (e) `createReview`. |
| RF6 | `createReview` usa `commit_id = headSha`, `event: "COMMENT"`, `body` com veredito + contagem, `comments[]` com `{ path, line, side: "RIGHT", body }`. |
| RF7 | Máximo **20** inlines por review, fails primeiro, depois warnings. Dedupe `(path, line, title)`. |
| RF8 | Sem nenhum inline resolvido: ainda cria o review **só com body** (parecer na conversa da PR), sem comments. |
| RF9 | Análise `completed` mesmo se o GitHub falhar. Snapshot ganha `githubComments`. SSE emite `github_comments_done` depois do `report_ready`. |
| RF10 | Front mostra `path:line` no finding. Na análise (ao vivo e salva) um status: postado (N), nada a postar, ou erro. Sem botão extra — posta sempre. |

## Requisitos não funcionais

| # | Requisito |
|---|-----------|
| RNF1 | `ai-api` não importa Octokit, não recebe PAT GitHub, não chama `api.github.com`. |
| RNF2 | Validação da citação e parse exato do patch são funções puras, testáveis sem rede. |
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
  "evidence": "linha(s) completa(s) e literal(is) do arquivo"
}
```

- `path`: relativo à raiz do repo, igual a `filename` do `pulls.listFiles`. Sem `..`, sem `/` inicial obrigatório — normalizar tirando `./` e `/` inicial.
- `evidence`: uma ou mais linhas completas copiadas do conteúdo do arquivo. Deve ocorrer exatamente uma vez; a API deriva `line`/`endLine`. Sem citação única e verificável, o finding não recebe localização.
- `line` / `endLine`: posições derivadas do arquivo, não valores confiados ao modelo.

### Resolução de âncora (Nest, puro)

Entrada: `path`, `evidence`, linha inicial/final derivadas da citação, `files: { filename, status, patch }[]`.

```
1. Achar file onde filename === path (após normalizar).
2. Se status === "removed" ou patch vazio → skip.
3. Parsear hunks do patch (@@ -a,b +c,d @@).
4. Percorrer linhas do hunk:
   - ' ' ou '+' → entra em rightLines (número no arquivo novo)
   - '-' → só avança o old; não é âncora no v1
5. Se a linha inicial não estiver em rightLines, não há âncora.
6. Comparar as linhas completas de `evidence` com o texto do patch RIGHT começando em `line`; se alguma diferir ou faltar, não há âncora.
7. Para citação com várias linhas, deriva o fim pela quantidade de linhas e publica intervalo apenas quando a citação inteira está no RIGHT; nunca usa `endLine` fornecido pelo modelo nem desloca a âncora.
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
- Inclui as linhas do trecho `evidence` verificado pelo ai-api.

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
- WHEN a localização exata não está no hunk ou o texto do patch atual difere de `evidence` THEN o finding é contado como skipped; não é deslocado para outra linha.
- WHEN `evidence` aparece zero ou mais de uma vez no arquivo THEN o finding continua no relatório sem localização e não recebe comentário inline.
- WHEN um finding tem `path`/`line` sem citação verificada THEN permanece no relatório, mas não pode ser publicado inline.
- WHEN o arquivo é `removed` ou o patch veio vazio THEN skipped.
- WHEN só há `pass` THEN `status=empty`, nenhum `createReview`.
- WHEN a PR é do próprio usuário THEN o review ainda sai (`COMMENT`). Nunca `REQUEST_CHANGES`.
- WHEN o usuário roda de novo THEN inlines antigos com marcador somem; entra um review novo.
- WHEN o GitHub devolve 422/403 THEN análise `completed`, `githubComments.status=error`.
- WHEN o cliente fecha o SSE no `report_ready` THEN o post **ainda roda** (não está no `abortController` do browser). Persistência + best-effort log.
- WHEN dois findings caem na mesma `(path, line)` THEN um comentário, títulos concatenados com `---` ou o de maior severidade (`fail` ganha). Dedupe RF7.
- WHEN a citação cobre várias linhas THEN o intervalo é derivado da citação e só sai quando cada linha está no RIGHT.

## Arquivos

| Peça | Onde |
|------|------|
| Finding + serialize | `apps/ai-api/app/domain/agents/entities.py` |
| Normalize path/line | `apps/ai-api/app/graph/utils/findings.py` |
| Prompts | `test_reviewer/prompt.md`, `architecture_reviewer/prompt.md` |
| Atalho sem testes + path | `apps/ai-api/app/graph/agents/test_reviewer/agent.py` |
| `headSha` | `repositories.service.ts` `toPullSummary` |
| Parse exato do patch, sem deslocar âncora | `apps/backend/src/modules/analyses/helpers/patch-anchor.helper.ts` |
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

- `patch-anchor.helper.spec.ts` — hunk `@@ -1,3 +1,4 @@` com uma linha `+`; linha e texto exatos; localização fora do hunk ou citação divergente é recusada; arquivo removido; patch vazio.
- `github-review.helper.spec.ts` — só fail/warning; exige evidence no patch; cap 20; dedupe; marcador no body; `event === "COMMENT"`; body do review traz o veredito.
- `apply-review-event.spec.ts` — hidrata `githubComments`; tipo desconhecido não quebra.

Integração opcional: mock Octokit `createReview` / `listReviewComments` / `deleteReviewComment` no service.

## Critérios de aceite

- [ ] Fail com `path`+`evidence` único vira review comment no arquivo e linha exata do hunk.
- [ ] Citação ausente, ambígua ou fora do hunk permanece no relatório sem comentário inline.
- [ ] Warning idem. Pass não aparece na PR.
- [ ] Finding sem path ou em arquivo fora da PR não gera inline; relatório interno intacto.
- [ ] Autor da PR consegue receber o review (evento `COMMENT`).
- [ ] Segunda análise na mesma PR remove inlines `cast-review` anteriores e posta de novo.
- [ ] `createReview` falhando deixa a análise `completed` e mostra erro no front.
- [ ] Python tests de finding/atalho passam sem Octokit.
- [ ] Parse exato do patch coberto por teste de tabela (patch fixture).

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
| GHCM-03 | Derivar localização e validar patch exato | RF5 |
| GHCM-04 | createReview COMMENT + limpeza | RF5–RF8 |
| GHCM-05 | Persistência + SSE + análise não falha | RF9 |
| GHCM-06 | Front path:line + status | RF10 |

## Dimensões implícitas

| Dimensão | Resolução |
|----------|-----------|
| Validação | path normalizado; citação única no arquivo alterado; linha derivada ∈ RIGHT e conteúdo igual à citação; sem deslocamento para linha próxima. |
| Falha parcial | Alguns inlines skip, o resto posta. GitHub 422 no review inteiro → error, análise completed. |
| Idempotência | Delete por marcador + analysis nova. |
| Auth | Mesmo PAT; escopo `repo` já exigido. |
| Concorrência | Uma análise por request. Duas runs paralelas na mesma PR podem intercalar deletes — aceito no MVP. |
| Lifecycle | Comentário vive no GitHub. Apagar análise no Cast Review **não** apaga o review. |
| Observabilidade | `githubComments` no jsonb + log de falha já existente. Sem métrica nova. |
| Dependência externa | GitHub. Timeout/403/422 → error sanitizado. |
| Transição | `running → completed` inalterado. `githubComments` é anexo, não status da análise. |
