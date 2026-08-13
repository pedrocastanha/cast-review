# ADR: Comentários inline na PR do GitHub

- **Status:** Aceito
- **Data:** 2026-08-13
- **Escopo:** `apps/ai-api` (localização no finding) + `apps/backend` (validar hunk + postar) + espelho no front

## Contexto

O Cast Review já produz findings `fail` / `warning` / `pass` e um veredito. Tudo isso mora só na UI e no jsonb. Quem revisa no GitHub não vê o parecer no diff.

O pedido: os comentários **ruins** (`fail` e `warning`) vão para a PR, no **arquivo certo** e no **trecho certo**. Pode ser o dono do repo comentando com o próprio PAT — é o fluxo local do produto.

Dois fatos do código atual bloqueiam um “só postar”:

1. `Finding` não tem `path` nem `line`. Sem isso o GitHub não aceita review comment inline.
2. A regra de arquitetura do MVP continua válida: **Python não conhece GitHub**. Postar é I/O do Nest.

E um fato da API do GitHub: o **autor da PR não pode** `REQUEST_CHANGES` nem `APPROVE` a própria PR. Como o usuário roda o Cast Review nas PRs dele, o evento do review **não pode** ser `REQUEST_CHANGES`.

## Decisão 1 — Nest posta; Python só localiza

**O quê:** reviewers passam a emitir `path` + `line` em fail/warning. O Nest, depois do `report_ready`, valida contra o patch da PR e chama `POST /repos/{owner}/{repo}/pulls/{n}/reviews`.

**Por quê:** mantém o `ai-api` stateless e testável sem Octokit. O Nest já tem PAT, owner, repo, pull number e os patches (`listPullFiles`).

**Alternativa descartada:** Python chama a API do GitHub. Quebra a fronteira do MVP e mistura chave GitHub no serviço de agentes.

## Decisão 2 — Um Review por análise, evento sempre `COMMENT`

**O quê:** um único `pulls.createReview` com `comments[]` (os inlines) e `body` (resumo + veredito). `event` é sempre `"COMMENT"`.

**Por quê:** um review agrupa os comentários, aparece como uma revisão só e funciona no PR do próprio dono. O veredito Cast Review (`approve | comment | request_changes`) vai **no texto** do body, não no evento da API.

**Alternativa descartada:** `REQUEST_CHANGES` quando o veredito pede mudanças. Falha 422 na PR do autor — o caso de uso principal.

## Decisão 3 — Só fail e warning, e só se ancorar no diff

**O quê:** `pass` não vai para o GitHub. Finding sem `path` válido, ou cujo `line` não dá para mapear a uma linha do **lado RIGHT** do patch, **não** vira comentário de conversa genérico. Fica só no relatório.

**Por quê:** o pedido é “no trecho certo”. Comentário solto no fim da PR sem arquivo é ruído. Linha que não está no hunk o GitHub recusa (422).

## Decisão 4 — O LLM sugere a linha; o patch manda

**O quê:** o modelo devolve `path` (path do arquivo na PR) e `line` (1-based no arquivo **novo**). O Nest parseia o `patch` daquele arquivo, monta o conjunto de linhas RIGHT (` ` e `+`) e:

- se `line` ∈ conjunto → usa;
- senão → **snap** para a linha RIGHT mais próxima;
- se o arquivo não está na PR, foi deletado, ou não tem hunk (binário) → descarta o inline.

**Por quê:** o modelo inventa linha. Confiar nela crua quebra o post. O patch é a única fonte que o GitHub aceita.

**Alternativa descartada:** mandar o conjunto de linhas válidas no prompt. Infla o contexto e ainda não impede alucinação; o snap no Nest é barato e testável sem LLM.

## Decisão 5 — Sempre o PAT do usuário; reexecução substitui

**O quê:** o comentário aparece como o usuário autenticado (mesmo dono). Cada body inline e o body do review levam o marcador `<!-- cast-review:${analysisId} -->`. Antes de postar, o Nest apaga review comments anteriores desse usuário na PR cujo body contém `<!-- cast-review:`.

**Por quê:** rodar de novo não empilha 3 reviews iguais. O marcador evita apagar comentário humano.

## Decisão 6 — Falha no GitHub não falha a análise

**O quê:** se o `createReview` quebrar, a análise permanece `completed`. O snapshot ganha `githubComments: { status: "error", message }`. O SSE emite um evento extra `github_comments_done` (sucesso ou erro) **depois** do `report_ready`.

**Por quê:** o review já está salvo. Perder o post no GitHub não pode apagar o relatório.

## Consequências

- `Finding` cresce `path` / `line` / `endLine?`. Score e veredito **não mudam**.
- Prompts de Test e Architecture passam a exigir localização em fail/warning.
- Atalho determinístico do test reviewer (PR sem testes) ancora no primeiro arquivo source da PR; o Nest faz o snap.
- `getPull` passa a expor `headSha` — o `createReview` exige `commit_id`.
- Front mostra `path:line` no finding e um estado “postado / falhou / nada a postar”.
- Escopo `repo` do PAT (já exigido) cobre criar e apagar review comments.
