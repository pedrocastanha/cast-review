# SPEC: Custo e tokens da análise

- **Status:** Implementado (sem commit)
- **Data:** 2026-08-13
- **Escopo:** `apps/ai-api` (usage do LLM + tabela de preço) + persistência no Nest + `apps/frontend` (run ao vivo, relatório, histórico)

## Problema

A análise chama OpenAI várias vezes (PRD, spec, test reviewer, architecture reviewer) e o usuário **não vê o que pagou**. O stream hoje lê só `delta.content` e joga fora o `usage`. O front mostra veredito e nota, mas não tokens, modelo por etapa, nem dólar.

Quem roda a própria PR (gpt-4o nos dois reviewers) não consegue responder: “essa run saiu por quanto?” nem “qual etapa comeu o orçamento?”.

## Objetivo

Toda análise — ao vivo e salva — mostra **tokens e custo estimado em USD**, no total e **por etapa**, com o modelo que de fato rodou. Cálculo em código, reproduzível, sem rede extra. O front trata custo como dado de instrumento (mono, tabular), não como marketing.

## Decisões travadas

| # | Decisão | Por quê |
|---|---------|---------|
| D1 | Tokens vêm do `usage` da OpenAI no próprio stream (`stream_options.include_usage: true`). Nunca estimar por caractere. | A fatura do usuário é essa. Estimativa mente. |
| D2 | Preço é tabela versionada **no código** do `ai-api` (USD / 1M tokens: input, **cached input**, output). Sem chamada a API de pricing. | Testável sem rede. Mesma run = mesmo número. |
| D3 | Custo vive em `report.usage` (jsonb que já existe). Sem coluna nova, sem migration. | Igual veredito/`overallScore`. Hidrata junto. |
| D4 | Sem evento SSE novo. Cada evento de etapa já carrega o `usage` daquela etapa; `report_ready` carrega o agregado. | Front atualiza o stepper com o que já chega. |
| D5 | Etapas sem LLM (change analyzer, report builder, atalho do test reviewer) entram no breakdown com tokens 0 e `skipped: true`. | O usuário vê a etapa; não some da conta. |
| D6 | Modelo desconhecido: tokens gravados, `costUsd: null`, total marca `costComplete: false`. | Não inventar preço. Ainda dá pra ver volume. |
| D7 | Tokens em cache (`usage.prompt_tokens_details.cached_tokens`) saem no preço de **cached input**. O restante do prompt sai no preço cheio. Sem cache na resposta ⇒ `cachedTokens: 0`. | A fatura da OpenAI já desconta cache; sem isso o Cast Review infla o custo. |
| D8 | Front desta feature é só superfície de análise (run, relatório, histórico, registro salvo). Login/repos/PRs ficam iguais. | “Melhorar o front” aqui = tornar custo legível, não redesenhar o app. |

## Quem chama LLM hoje

| Etapa | Node | Modelo atual | Sempre LLM? |
|-------|------|--------------|-------------|
| Change Analyzer | `change_analyzer` | — | Não |
| PRD | `prd` | `models.testReviewer` | Sim |
| Implementation Spec | `implementation_spec` | `models.testReviewer` | Sim |
| Test Reviewer | `test_reviewer` | `models.testReviewer` | Não, se não há `businessRules` ou não há testes na PR |
| Architecture | `architecture_reviewer` | `models.architectureReviewer` | Sim (com convenções do repo ou default) |
| Relatório | `report_builder` | — | Não |

Isso **não muda**. O spec só passa a medir o que já acontece.

## Requisitos funcionais

| # | Requisito |
|---|-----------|
| RF1 | `complete_json` pede `stream_options.include_usage` e devolve o payload JSON **e** o `usage` do chunk final da OpenAI (`prompt_tokens`, `completion_tokens`, `total_tokens`). |
| RF2 | Se o chunk de usage não vier, a chamada conta 0 tokens, `source: "missing"`. A análise **não** falha por isso. |
| RF3 | Existe `estimate_cost_usd(model, prompt_tokens, completion_tokens, cached_tokens=0)` puro: uncached×input + cached×cachedInput + completion×output, tudo / 1e6. Sem I/O. |
| RF4 | Tabela cobre 4o, 4.1, 5, 5.4 (incl. mini/nano), 5.5 (incl. pro) e 5.6 (sol/terra/luna/cyber + alias `gpt-5.6`). Alias com data (`gpt-5.4-mini-2026-03-17`) resolve pela família do **prefixo mais longo**. |
| RF5 | Cada node LLM anexa `usage` no próprio payload do evento (`prd_generated`, `spec_generated`, `test_reviewer_done`, `architecture_reviewer_done`). |
| RF6 | Nodes sem LLM (e o atalho do test reviewer) anexam `usage` com tokens 0, `costUsd: 0`, `skipped: true`, `model: null` se não houve chamada. |
| RF7 | `report_ready.usage` agrega: soma de tokens, soma de custos conhecidos, `steps[]` na ordem do pipeline, `pricingAsOf`, `costComplete`. |
| RF8 | Nest persiste `report.usage` via `applyReviewEvent` / `hydrateReview`. Análise interrompida no meio **guarda o que já chegou**. |
| RF9 | Markdown do relatório ganha um bloco curto **Custo** (total USD ou “preço não tabelado”, total de tokens, N etapas com LLM). Sem tabela enorme. |
| RF10 | Durante o run, o stepper mostra tokens + custo da etapa quando ela termina; uma faixa acima do stepper mostra o acumulado. |
| RF11 | `ReportView` mostra o custo total no herói do veredito (ao lado da nota). Abaixo, breakdown por etapa (nome, modelo, tokens in/out, USD). |
| RF12 | `AnalysisHistoryList` e a página da análise salva mostram o custo total (ou “tokens só”, se `costComplete` for false). |

## Requisitos não funcionais

| # | Requisito |
|---|-----------|
| RNF1 | Custo é 100% determinístico a partir de `(model, promptTokens, completionTokens, tabela)`. Testável sem OpenAI. |
| RNF2 | `apiKeys` nunca entram em `usage`, log ou markdown. |
| RNF3 | Edges do grafo, fórmula de score e veredito **não mudam**. |
| RNF4 | Análises antigas sem `usage` renderizam sem bloco de custo — sem quebrar o front. |
| RNF5 | Moeda é USD. Interno com no máximo 8 casas. Display segue a tabela de formatação abaixo. Tokens com `tabular-nums`. |

## Contratos

### `TokenUsage` (uma chamada)

```json
{
  "promptTokens": 1200,
  "cachedTokens": 800,
  "completionTokens": 400,
  "totalTokens": 1600,
  "source": "openai"
}
```

`source`: `"openai"` | `"missing"`.  
`cachedTokens` ⊆ `promptTokens` (a OpenAI já inclui o cache dentro de `prompt_tokens`). Se vier maior, clamp para `promptTokens`.

### `StepUsage` (uma etapa do pipeline)

```json
{
  "step": "prd",
  "label": "PRD",
  "model": "gpt-4o",
  "promptTokens": 1200,
  "cachedTokens": 800,
  "completionTokens": 400,
  "totalTokens": 1600,
  "costUsd": 0.007,
  "skipped": false,
  "source": "openai"
}
```

`step` (enum fechado):

`change_analyzer` | `prd` | `implementation_spec` | `test_reviewer` | `architecture_reviewer` | `report_builder`

- `skipped: true` ⇒ `promptTokens`, `completionTokens`, `totalTokens`, `costUsd` são 0; `model` pode ser `null`.
- Modelo fora da tabela ⇒ `costUsd: null`, tokens preenchidos.

### `AnalysisUsage` (agregado — vai em `report.usage` e no `report_ready`)

```json
{
  "currency": "USD",
  "promptTokens": 8400,
  "cachedTokens": 3200,
  "completionTokens": 2100,
  "totalTokens": 10500,
  "costUsd": 0.042,
  "costComplete": true,
  "pricingAsOf": "2026-08-13",
  "steps": ["…StepUsage na ordem do pipeline…"]
}
```

Regras do agregado:

- Tokens (prompt, cached, completion, total) = soma das etapas.
- `costUsd` = soma das etapas com preço conhecido. Etapas `null` não entram na soma.
- `costComplete` é `false` se **qualquer** etapa com `skipped: false` tiver `costUsd === null` **ou** `source === "missing"`.
- Pipeline que quebra no meio: `steps` só com o que rodou; `costComplete: false`.

### Eventos SSE (campos novos, o resto igual)

```json
{ "type": "prd_generated", "payload": { "title": "…", "usage": { "…StepUsage…" } } }
```

O mesmo `usage` (um `StepUsage`) em:

- `prd_generated`
- `spec_generated`
- `test_reviewer_done`
- `architecture_reviewer_done`
- `change_analysis_done` (`skipped: true`)
- `report_ready` além do agregado:

```json
{
  "type": "report_ready",
  "payload": {
    "verdict": "comment",
    "overallScore": 85,
    "usage": { "…AnalysisUsage…" }
  }
}
```

### `complete_json` (Python)

Deixa de devolver só `dict`. Devolve um resultado:

```python
@dataclass(frozen=True)
class LlmResult:
    data: dict
    usage: TokenUsage
```

Callers usam `result.data` como hoje e `result.usage` para montar o `StepUsage`.

Pedido HTTP extra:

```json
{ "stream": true, "stream_options": { "include_usage": true } }
```

O chunk final da OpenAI vem com `usage` e `choices` vazio — o parser **não** trata isso como “resposta vazia”.

## Tabela de preço (v1)

Arquivo: `apps/ai-api/app/infrastructure/llm/pricing.py`

USD por **1_000_000** tokens, short context, standard. `pricingAsOf = 2026-08-13`.

A lista abaixo já está na ordem de match (**prefixo mais longo primeiro**). `gpt-5.4-mini` tem que bater antes de `gpt-5.4` e de `gpt-5`, senão a run do usuário cai no preço errado (ou em `n/d`).

| Prefixo | Input | Cached | Output | Nota |
|---------|------:|-------:|-------:|------|
| `gpt-4o-mini` | 0.15 | 0.075 | 0.60 | cache ~50% |
| `gpt-4o` | 2.50 | 1.25 | 10.00 | cache ~50% |
| `gpt-4.1-nano` | 0.10 | 0.025 | 0.40 | cache ~75% |
| `gpt-4.1-mini` | 0.40 | 0.10 | 1.60 | cache ~75% |
| `gpt-4.1` | 2.00 | 0.50 | 8.00 | cache ~75% |
| `gpt-5.6-cyber` | 12.50 | 1.25 | 75.00 | cache 90% |
| `gpt-5.6-luna` | 0.20 | 0.02 | 1.20 | cache 90% |
| `gpt-5.6-terra` | 2.00 | 0.20 | 12.00 | cache 90% |
| `gpt-5.6-sol` | 5.00 | 0.50 | 30.00 | cache 90% |
| `gpt-5.6` | 2.00 | 0.20 | 12.00 | alias = terra |
| `gpt-5.5-pro` | 30.00 | 30.00 | 180.00 | cache não publicado → preço cheio |
| `gpt-5.5` | 5.00 | 0.50 | 30.00 | cache 90% |
| `gpt-5.4-nano` | 0.20 | 0.02 | 1.25 | cache 90% |
| `gpt-5.4-mini` | 0.75 | 0.075 | 4.50 | o que você rodou |
| `gpt-5.4` | 2.50 | 0.25 | 15.00 | cache 90% |
| `gpt-5-mini` | 0.25 | 0.025 | 2.00 | cache 90% |
| `gpt-5` | 1.25 | 0.125 | 10.00 | cache 90% |

Resolução: `model.lower().startswith(prefix)` no **primeiro** prefixo que casar (tabela já ordenada do mais específico ao mais genérico). Sem match → `costUsd: null`.

`gpt-5.4-mini-2026-03-17` → `gpt-5.4-mini`. `gpt-5.6-terra` → terra, não o alias `gpt-5.6`.

Atualizar a tabela é mudança de código + bump de `pricingAsOf`. Runs antigas **não** se recalculam.

Fórmula:

```
cached = min(cachedTokens, promptTokens)
uncached = promptTokens - cached
costUsd = (uncached * inputPer1M + cached * cachedPer1M + completionTokens * outputPer1M) / 1_000_000
```

## Persistência (Nest)

`applyReviewEvent`:

- Em cada evento de etapa, se `payload.usage` for um `StepUsage` válido, faz upsert em `report.usage.steps` pela chave `step` e **recompõe** o agregado **só somando** os campos já preenchidos pelo Python (`promptTokens`, `completionTokens`, `totalTokens`, `costUsd` conhecido). Nest **não** tem tabela de preço.
- Em `report_ready`, se vier `payload.usage` completo, substitui o agregado (fonte de verdade do Python).
- `hydrateReview` devolve `usage` ou `undefined`. Lixo/ausente → sem usage.
- `assemble-report.ts` no front faz o mesmo upsert/soma a partir dos eventos SSE, para a faixa ao vivo não esperar o `GET` da análise.

Análises `error` no meio do grafo: o que já foi `applyReviewEvent` fica no jsonb. O front lê `status === 'error'` + `usage.costComplete === false` e rotula **parcial**.

## Frontend

Escopo visual: páginas/componentes de análise. Tokens do design atual (mono JetBrains, `ink-faint`, `surface-1`, `tabular-nums`). Sem gráfico, sem gauge, sem cor nova de “dinheiro”.

### Run (`AnalysisPage`)

1. **Faixa de custo** entre o stepper e o thought log, visível assim que a primeira etapa com `usage` chega.
   - Esquerda: `US$ 0.0423` (ou `tokens · preço n/d` se `!costComplete`).
   - Direita: `10.5k tokens` + quantas etapas LLM já fecharam.
   - Enquanto `phase === 'running'`, o número atualiza a cada evento.
2. **`AgentStepper`**: no estado `done`, no lugar do `ok`, mostra `1.2k · $0.007` (ou `sem LLM` se `skipped`). Modelo em `title`/hint, não na linha — a grade já é apertada.
3. Form de key/modelos permanece; sem terceiro seletor de modelo.

### Relatório (`ReportView`)

- Herói do veredito: à direita da nota, uma linha mono `US$ 0.0423 · 10.5k tok`. Se não houver `usage`, some.
- Nova seção **Custo por etapa** (depois dos cards de score, antes do PRD): uma linha por `steps[]` — label, modelo ou `—`, in/out, USD ou `n/d`. Etapas `skipped` em `ink-faint` com `sem LLM`.
- Markdown continua abaixo; o bloco Custo do markdown não precisa de UI extra se a seção já existe.

### Histórico e registro salvo

- `AnalysisHistoryList`: chip mono com `US$ 0.04` (2–4 casas, o menor que não vire `$0.00` se o valor for ≥ $0.0001). Sem usage → não mostra chip.
- `AnalysisRecordPage`: no `<dl>` de metadados, linha **Custo** (total + tokens + `parcial` se couber) e a mesma `ReportView`.

### Formatação

| Caso | Display |
|------|---------|
| `costUsd === 0` e skipped | `sem LLM` |
| `0 < costUsd < 0.01` | `$0.0042` (4 casas) |
| `costUsd ≥ 0.01` | `$0.04` (2 casas) |
| `costUsd === null` | `n/d` |
| tokens | `1.2k` se ≥ 1000, senão inteiro |

Helper puro em `apps/frontend/src/lib/format-usage.ts` — sem React.

## Edge cases

- WHEN o stream não trouxer `usage` THEN a etapa grava `source: "missing"`, tokens 0, `costComplete: false`; o pipeline segue.
- WHEN o test reviewer atalha (sem regras / sem testes) THEN a etapa entra `skipped: true` e **não** chama OpenAI.
- WHEN o modelo do form não está na tabela THEN tokens preenchidos, `costUsd: null` nessa etapa e no total `costComplete: false`.
- WHEN a análise falha depois do PRD THEN `report.usage.steps` tem change_analyzer + prd (e o que mais tiver fechado); UI diz parcial.
- WHEN o cliente aborta o SSE THEN o Nest já persistiu os eventos aplicados; o GET da análise mostra o parcial.
- WHEN uma análise antiga não tem `usage` THEN herói, stepper, histórico e registro **omitam** custo. Sem placeholder “$0.00”.
- WHEN `prompt_tokens + completion_tokens !== total_tokens` THEN gravar os três como a API mandou; o agregado soma o que cada etapa reportou, sem “consertar”.
- WHEN `cached_tokens` vier maior que `prompt_tokens` THEN clamp para `prompt_tokens`.
- WHEN o chunk não trouxer `prompt_tokens_details.cached_tokens` THEN `cachedTokens: 0` (tudo no preço de input).

## Arquivos

| Peça | Onde |
|------|------|
| Extrair usage do SSE | `apps/ai-api/app/infrastructure/llm/client.py` |
| Tabela + `estimate_cost_usd` | `apps/ai-api/app/infrastructure/llm/pricing.py` |
| Montar `StepUsage` | `apps/ai-api/app/graph/utils/usage.py` |
| Nodes (anexar usage) | `prd`, `implementation_spec`, `test_reviewer`, `architecture_reviewer`, `change_analyzer`, `report_builder` |
| Estado do grafo | `apps/ai-api/app/graph/state.py` (`usage_steps`) |
| Persistência | `apply-review-event.ts`, `analyses.types.ts` |
| Tipos front | `apps/frontend/src/types/index.ts` |
| Formatação | `apps/frontend/src/lib/format-usage.ts` |
| UI | `AgentStepper.tsx`, `ReportView.tsx`, `AnalysisPage.tsx`, `AnalysisHistoryList.tsx`, `AnalysisRecordPage.tsx` |
| Assemble do report ao vivo | `apps/frontend/src/lib/assemble-report.ts` |

## Testes

Python (sem rede):

- `test_llm_client.py` — request inclui `stream_options.include_usage`; chunk final `{usage, choices: []}` não é tratado como vazio; devolve `LlmResult.usage`.
- `test_pricing.py` — tabela da família, prefixo mais longo (`gpt-4o-mini` ≠ `gpt-4o`), modelo desconhecido → `None`, fórmula.
- `test_usage.py` — soma de steps; `costComplete`; skipped; parcial.
- `test_reviewers.py` / `test_prd.py` — atalho do test reviewer emite `skipped`; PRD anexa usage do fake client.
- `test_agent_run.py` — `report_ready.usage.steps` tem as 6 etapas; total = soma.

Nest:

- `apply-review-event.spec.ts` — hidrata `usage`; evento de etapa faz upsert; `report_ready` substitui; payload sem usage não inventa zero.

Front:

- `format-usage` — faixas de display (`$0.0042`, `$0.04`, `1.2k`, `n/d`, omitir ausente).

## Critérios de aceite

- [ ] Run completa mostra no herói o USD total e no stepper o custo/tokens de cada etapa.
- [ ] Breakdown lista as 6 etapas; change analyzer e report builder aparecem como `sem LLM`.
- [ ] Atalho do test reviewer (PR sem testes) não chama OpenAI e a etapa vai `skipped`.
- [ ] Modelo fora da tabela: tokens visíveis, USD `n/d`, `costComplete: false`.
- [ ] Análise antiga sem `usage` não mostra `$0.00` em lugar nenhum.
- [ ] Histórico e página salva repetem o custo da run.
- [ ] Testes de pricing e agregação passam sem OpenAI.
- [ ] `apiKeys` não aparecem em usage, log ou markdown.

## Fora de escopo

| Item | Motivo |
|------|--------|
| API ao vivo de preços da OpenAI | Irreproduzível; quebra teste. |
| Recalcular runs antigas quando a tabela muda | Snapshot da run é a verdade. |
| Teto de gasto / recusar run cara | Não foi pedido; muda o fluxo de start. |
| Dashboard de custo entre análises | Outra feature. |
| Estimativa *antes* de rodar | Sem tokens ainda; seria chute. |
| Long-context (2× input) e Batch/Flex | Só short-context standard. |
| Novo seletor de modelo (PRD/spec separados) | Os dois já reutilizam `testReviewer`. |
| Redesenho de login, repos, lista de PRs | D8. |
| Cobrar o usuário / billing | A key é dele. |
| Outro provider (Anthropic, etc.) | Um provedor no payload. |

## Rastreio

| ID | História | RF |
|----|----------|-----|
| COST-01 | Extrair usage do stream | RF1, RF2 |
| COST-02 | Tabela + fórmula | RF3, RF4 |
| COST-03 | Usage por etapa no grafo | RF5, RF6 |
| COST-04 | Agregado no `report_ready` | RF7, RF9 |
| COST-05 | Persistência Nest + parcial | RF8 |
| COST-06 | UI ao vivo (faixa + stepper) | RF10 |
| COST-07 | Relatório + histórico + registro | RF11, RF12 |

## Dimensões implícitas

| Dimensão | Resolução |
|----------|-----------|
| Validação | `StepUsage` / `AnalysisUsage` com tipos fechados; lixo é ignorado na hidratação. |
| Falha parcial | Persiste o que já chegou; `costComplete: false`. |
| Idempotência | Upsert por `step`; `report_ready` substitui. |
| Auth | Igual à análise. Usage não é endpoint novo. |
| Concorrência | Reviewers em paralelo: cada um manda seu evento; upsert por chave `step`. |
| Lifecycle | Usage morre com o jsonb da análise. Sem TTL extra. |
| Observabilidade | Sem métrica nova. Custo é dado de produto, não de infra. |
| Dependência externa | Usage vem da mesma chamada OpenAI. Sem endpoint extra. Tabela fica stale até commit — aceito, `pricingAsOf` visível. |
| Transição de estado | `running → completed/error` inalterado. Usage não cria status. |
| N/A | Rate limit próprio, paginação, multi-moeda. |
