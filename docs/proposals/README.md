# Propostas de features — Cast Review

Objetivo destas propostas: transformar o Cast Review de "app fullstack que chama LLM" em **peça de portfólio de AI Engineer**, que é uma categoria diferente. O que separa as duas, segundo o mercado de 2026:

- quem constrói **eval** consegue provar que o sistema melhorou; quem não constrói só tem opinião;
- quem faz **context engineering** (grafo de código, blast radius, budget de token) resolve o problema real de review; quem manda diff cru reproduz a limitação que todo mundo já tem;
- quem instrumenta **observabilidade padronizada** (OTel GenAI semconv) fala a língua de produção;
- quem trata **prompt injection vindo do input** entende que agente que lê código não confia no código.

## Estado atual (baseline lido no código)

| Peça | Onde | Situação |
|---|---|---|
| Pipeline de agentes | `apps/ai-api/app/graph/graph.py` | LangGraph com 6 nós, fan-out nos 2 reviewers, sem checkpointer |
| Scoring determinístico | `app/domain/agents/scoring.py` | 100 − 15×fail − 5×warning, testado sem rede |
| Contexto além do diff | `apps/backend/src/modules/analyses/helpers/import-resolver.helper.ts` | regex de import relativo, máx. 3 arquivos, só JS/TS |
| Custo/token | `app/infrastructure/llm/pricing.py` + `utils/usage.py` | por etapa, agregado no report |
| Streaming | SSE Python → SSE Nest → front | 1:1, com persistência incremental |
| Testes | `apps/ai-api/tests/` com `llm_fakes.py` | agentes testáveis sem rede — **base pronta pra eval** |
| Publicação na PR | `helpers/github-review.helper.ts` | review inline com âncora de patch |

Lacunas que as propostas atacam: **não existe eval, nem trace, nem defesa de injection, nem resume de run, nem grafo de código.**

## Ranking (impacto de portfólio ÷ esforço)

| # | Feature | Sinal que transmite | Esforço | PRD |
|---|---|---|---|---|
| 1 | Eval Harness + Golden Dataset + LLM-as-judge | "sei provar que meu agente melhorou" | M | [01](./01-eval-harness.md) |
| 2 | Code Graph / Repo Map (tree-sitter + PageRank + budget) | context engineering, não prompt engineering | M/G | [02](./02-code-graph-context.md) |
| 3 | Observabilidade OTel GenAI semconv | maturidade de produção | P/M | [03](./03-otel-genai-observability.md) |
| 4 | Guardrails contra prompt injection no diff | segurança de agente, tema quente e raro em portfólio | P/M | [04](./04-prompt-injection-guardrails.md) |
| 5 | Runs duráveis + human-in-the-loop | LangGraph de verdade (checkpoint, interrupt, resume) | M | [05](./05-durable-runs-hitl.md) |
| 6 | Servidor MCP do Cast Review | integração com o ecossistema de agentes de 2026 | P | [06](./06-mcp-server.md) |
| 7 | Roteador de modelo consciente de custo + cache | otimização de custo mensurável, com número no README | P/M | [07](./07-cost-aware-router.md) |

Ordem sugerida de execução: **1 → 3 → 4 → 2 → 5 → 7 → 6**.
Eval primeiro porque é o que mede todas as outras (a 2 e a 7 só provam valor se existir eval). Observabilidade em segundo porque paga dívida em toda feature seguinte.

## Referências

- [5 AI Portfolio Projects That Actually Get You Hired in 2026](https://dev.to/klement_gunndu/5-ai-portfolio-projects-that-actually-get-you-hired-in-2026-5bpl)
- [AI Evals Engineer: Career Guide 2026](https://jobsbyculture.com/blog/ai-evals-engineer-career-guide-2026)
- [Code Intelligence & Code-Graph Indexing for AI Agents](https://anthonywest.co.uk/research/code-intelligence-indexing-2026-openai)
- [code-review-graph — Token-Efficient AI Code Review](https://explainx.ai/blog/code-review-graph-token-efficient-ai-code-review-2026)
- [OpenTelemetry GenAI Semantic Conventions](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/genai-semconv/)
- [How OpenTelemetry Traces LLM Calls, Agent Reasoning, and MCP Tools](https://greptime.com/blogs/2026-05-09-opentelemetry-genai-semantic-conventions)
- [LAURA: Context-Enriched Retrieval-Augmented LLM for Code Review](https://arxiv.org/pdf/2512.01356)
- [How to Build a Golden Dataset for LLM Evaluation](https://qaskills.sh/blog/golden-dataset-llm-evaluation-guide)
