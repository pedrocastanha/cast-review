# PRD 03 — Observabilidade com OpenTelemetry GenAI Semantic Conventions

**Status:** Proposta
**Prioridade:** 3
**Área:** `apps/ai-api` + `apps/backend` + `docker-compose.yml`
**Esforço:** P/M (~2–4 dias)

---

## Problema

Quando um run demora 90s ou custa $0.40, hoje não dá pra dizer **onde**. O que existe:

- `AppLogger` no Nest (log estruturado, bom);
- `usage.py` agrega tokens/custo por etapa **no fim**, dentro do report;
- `thoughts` acumula texto do stream por step.

O que falta: latência por nó, latência do time-to-first-token, chamada de GitHub como span, correlação entre o run no Nest e o run no Python, e histórico entre execuções. Não dá pra responder "o `architecture_reviewer` está mais lento desde ontem?".

## Objetivo

Instrumentar o pipeline inteiro com OpenTelemetry usando as **GenAI Semantic Conventions** (`gen_ai.*`), propagando trace context de ponta a ponta (front → Nest → Python → OpenAI), com um stack local de visualização subindo pelo `docker-compose`.

## Por que é bom pro portfólio

As convenções GenAI da OTel (CNCF) padronizaram o vocabulário de telemetria de IA — span de LangGraph fica idêntico a span de chamada crua da OpenAI, e Datadog/Google Cloud/AWS/Azure já consomem nativamente. Instrumentar com o padrão (em vez de inventar log próprio, ou acoplar num SDK proprietário) é o sinal de "esse cara já operou IA em produção". Bônus: as convenções ainda estão em *Development*, então saber disso e citar a versão fixada no README mostra que você lê a fonte, não o tutorial.

---

## Escopo

**Dentro:**
- SDK OTel no FastAPI e no NestJS, exportador OTLP.
- Spans nas 4 categorias da convenção: **orquestração** (grafo), **LLM** (inference), **tool** (GitHub API), **memória/contexto** (context builder).
- Propagação de `traceparent` do Nest pro Python (header no `POST /agent/run`).
- Métricas: `gen_ai.client.token.usage`, `gen_ai.client.operation.duration`, contadores próprios de finding por severidade.
- `docker-compose` com OTel Collector + Jaeger (traces) + Prometheus + Grafana (métricas).
- Link "ver trace" na tela de análise, apontando pro Jaeger local.

**Fora:**
- Vendor SaaS (Datadog/Langfuse). Documenta-se que o mesmo OTLP aponta pra lá trocando uma env var — esse é o argumento.
- Log de conteúdo de prompt/resposta por padrão (ver seção de privacidade).
- Alerting/SLO.

---

## Design técnico

### Spans e atributos

Convenção fixada: `gen_ai` semconv **v1.37** (anotar a versão no README; a spec ainda está em Development).

| Span | Nome | Atributos-chave |
|---|---|---|
| Run inteiro | `invoke_agent cast_review` | `gen_ai.operation.name=invoke_agent`, `gen_ai.agent.name`, `cast.run_id`, `cast.repo`, `cast.pull_number` |
| Nó do grafo | `invoke_agent test_reviewer` | `gen_ai.agent.name=test_reviewer`, `cast.step` |
| Chamada LLM | `chat {model}` | `gen_ai.provider.name=openai`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.request.max_tokens`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `cast.cached_tokens`, `cast.cost_usd` |
| Tool GitHub | `execute_tool github.get_pull_diff` | `gen_ai.tool.name`, `gen_ai.tool.type=extension`, `http.response.status_code` |
| Contexto | `execute_tool context_builder` | `cast.changed_files`, `cast.related_files`, `cast.prompt_chars` |

Erros: `LlmError` vira span com `status=ERROR` + `error.type`, sem vazar a mensagem crua da OpenAI (a sanitização de `sk-...` em `sanitize_openai_error` já existe e deve ser reusada).

### Pontos de instrumentação

- `app/infrastructure/llm/client.py::complete_json` — um único ponto cobre **todas** as chamadas LLM. `parse_openai_usage` já devolve o usage; vira atributo de span e métrica.
  - Extra valioso: registrar **TTFT** (time to first token) no primeiro `on_delta`. É a métrica que explica a percepção de "travou" na UI, e quase ninguém mede.
- `app/graph/pipeline.py::run_pipeline` — abre o span raiz, extrai `traceparent` do header.
- `app/graph/graph.py` — wrapper por nó, ou callback do LangGraph.
- `apps/backend/.../analyses.service.ts::run` — span do SSE, injeta `traceparent` no `AiApiClient.runAgent`.
- `repositories.service.ts` — spans das chamadas GitHub (hoje invisíveis e provavelmente responsáveis por boa parte da latência: `buildAgentRunRequest` faz N chamadas `getFileContent` em paralelo).

### Métricas

```
gen_ai.client.token.usage          histogram  {gen_ai.request.model, gen_ai.token.type}
gen_ai.client.operation.duration   histogram  {gen_ai.operation.name, gen_ai.request.model}
cast.review.findings               counter    {reviewer, status}
cast.review.cost_usd               histogram  {model}
cast.llm.ttft                      histogram  {model, step}
cast.github.api.calls              counter    {operation, status}
```

Dashboard Grafana provisionado no repo (`ops/grafana/dashboards/cast-review.json`): custo por review, p95 por nó, TTFT, taxa de erro, distribuição de findings. **Screenshot desse dashboard no README** é o entregável visual da feature.

### Privacidade

`gen_ai.input.messages` / `gen_ai.output.messages` ficam **desligados** por padrão (`OTEL_GENAI_CAPTURE_CONTENT=false`). Diff de repositório privado não vai pra telemetria sem opt-in explícito. Quando ligado, a API key nunca entra — o `sanitize` do client já cobre isso e ganha teste.

## Regras de negócio

1. Falha de exportação de telemetria **nunca** derruba um run. Exporter em modo fire-and-forget, com `BatchSpanProcessor`.
2. Todo run tem `trace_id` persistido em `analyses` (coluna nova, migration) — é o que liga o registro histórico ao trace.
3. Custo aparece em dois lugares com o **mesmo** número: report (`usage.py`) e métrica OTel. Um teste garante a igualdade, senão viram duas verdades.

## Métricas de sucesso

- Um trace completo do run visível no Jaeger, com breakdown GitHub vs LLM vs overhead.
- Responder "onde vai o tempo de uma review" com número, no README. (Hipótese a confirmar: a maior fatia é o fan-in de `getFileContent` do GitHub, não o LLM.)
- p95 por nó e custo por review em dashboard versionado.

## Riscos

| Risco | Mitigação |
|---|---|
| Semconv GenAI ainda instável (Development) | Versão fixada e anotada; atributos custom sob prefixo `cast.*` |
| Overhead de instrumentação no stream SSE | Span por chunk é proibido; só TTFT + agregado no fim |
| docker-compose pesado pra quem só quer rodar o app | Stack de observabilidade em `docker-compose.observability.yml` separado, opcional |
