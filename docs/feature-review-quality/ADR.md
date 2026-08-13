# ADR: Convenções padrão da casa + veredito calculado

- **Status:** Aceito
- **Data:** 2026-08-13
- **Branch:** `feature/start-ai-integration`
- **Escopo:** `apps/ai-api` + espelho no Nest/front

## Contexto

A regra original "sem conventions.md o Architecture Reviewer não chama LLM e devolve 100" protegia contra opinião genérica. Na prática, a maioria dos repos de portfólio **não tem** `conventions.md`. O reviewer de arquitetura sumia e o relatório parecia um carimbo de 100.

Na mesma run da PR #9, dois 100 sem veredito não comunicam "pode mergear" vs "olha isso".

## Decisão 1 — Fallback para convenções Cast Review, em vez de pular o reviewer

**O quê:** `resolve_conventions(raw)` devolve o texto do repo se existir; senão lê `graph/conventions/default.md` e marca `source=default`.

**Por quê:** o padrão da casa (controller fino, domain sem infra, score em código, chave fora do banco) é exatamente o que queremos cobrar neste monorepo. Pular o reviewer porque o arquivo não existe joga fora o valor do produto.

**Alternativa descartada:** gerar convenções via LLM a cada run. Irreproduzível e sem âncora para `conventionRef`.

## Decisão 2 — Veredito e nota geral em código, não no LLM

**O quê:** `decide_verdict(results)` deriva `approve | comment | request_changes` e `overallScore = min(scores)`.

**Por quê:** a mesma razão do score por reviewer — o modelo não pode maquiar o parecer. O markdown só rotula o que o código já decidiu.

## Decisão 3 — UI destaca veredito e esconde o dump

**O quê:** herói com veredito + nota; arquivos limitados a 12; fails/warnings acima dos passes.

**Por quê:** 113 paths na PR #9 afogam o parecer. O humano precisa do veredito em 2 segundos.

## Consequências

- Testes que esperavam "conventions vazio ⇒ skip LLM ⇒ 100" foram atualizados.
- Repos sem `conventions.md` passam a pagar 1 chamada extra de LLM (architecture). Aceito.
- O padrão da casa precisa evoluir junto com o produto — é código, versionado.
