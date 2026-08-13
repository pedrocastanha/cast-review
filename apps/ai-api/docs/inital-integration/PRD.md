# PRD: Motor de Agentes (ai-api) — integração inicial com o backend

- **Status:** Draft
- **Data:** 2026-08-10
- **Escopo:** `apps/ai-api` (novo serviço) + contrato consumido por `apps/backend`

## Problema

O Cast Review precisa rodar o pipeline de revisão (Change Analyzer → Implementation Spec → Reviewers → Report) fora do Nest, num serviço isolado que evolui sozinho (troca de modelo, novo reviewer, ajuste de prompt) sem mexer em autenticação/GitHub/WebSocket. Hoje esse serviço não existe — só o skeleton de pastas (`apps/ai-api/app/`).

O requisito difícil não é "chamar um LLM": é rodar isso de forma **determinística o suficiente pra ser confiável** — score não pode variar por causa do LLM decidindo um caminho diferente a cada execução, e um reviewer não pode "opinar" fora do que foi pedido (regra 3 do PRD original do produto).

## Objetivo

Expor um serviço HTTP stateless que recebe diff + contexto (já montado pelo Nest) e devolve, via streaming, os eventos de cada etapa do pipeline até o relatório final com score.

## Usuários e contexto de uso

Único consumidor: `apps/backend` (Nest), via `RunService`. Nenhum outro cliente chama esse serviço diretamente — o front nunca fala com o Python.

## Requisitos funcionais

| # | Requisito | Onde |
|---|-----------|------|
| RF1 | Serviço expõe `POST /agent/run`, recebe diff + arquivos alterados + conteúdo relacionado + conventions + models + api keys num único payload. | `api/routes` |
| RF2 | Resposta é um stream (SSE) — cada etapa concluída do pipeline emite um evento antes da próxima começar. | `api/routes` + orquestrador do grafo |
| RF3 | Change Analyzer roda primeiro, sem LLM — heurística sobre paths/extensões/testes/migrations. | node `change_analyzer` |
| RF4 | Implementation Spec traduz o diff numa especificação estruturada (`summary` + `businessRules`), 1 chamada de LLM. | node `implementation_spec` |
| RF5 | Test Reviewer e Architecture Reviewer rodam em paralelo, cada um consumindo a spec gerada. | nodes `reviewers/*` |
| RF6 | Test Reviewer só falha uma `businessRule` sem teste correspondente — não avalia qualidade do teste. | node `reviewers/test_reviewer` |
| RF7 | Architecture Reviewer só reporta finding com `conventionRef` (linha do `conventions.md`); sem isso, não reporta nada. | node `reviewers/architecture_reviewer` |
| RF8 | Score de cada reviewer é calculado em código (100 − 15×fail − 5×warning), nunca pelo LLM. | `domain/agents` (scoring) |
| RF9 | Report Builder agrega os resultados dos reviewers + spec num Markdown final, sem LLM. | node `report_builder` |
| RF10 | `GET /health` pra checagem de disponibilidade. | `api/routes` |
| RF11 | Falha irrecuperável em qualquer etapa emite evento `error` com `{ step, message }` e encerra o stream. | orquestrador do grafo |

## Requisitos não funcionais

| # | Requisito |
|---|-----------|
| RNF1 | Serviço é **stateless** — nenhuma persistência (sem banco, sem cache, sem sessão). Estado do run vive só no Nest. |
| RNF2 | API keys (LLM) trafegam só em memória de request — nunca logadas, nunca gravadas em disco. |
| RNF3 | Grafo de execução tem **edges fixos** (change_analyzer → spec → reviewers em paralelo → report). Nenhum node decide dinamicamente o próximo passo. |
| RNF4 | Cada node/reviewer tem tool surface mínimo — só o que já veio no payload da requisição. Sem acesso a filesystem real, sem tool de delegação livre. |
| RNF5 | Score é 100% reproduzível a partir dos findings — testável sem chamar LLM nenhum. |
| RNF6 | Serviço não conhece GitHub nem autenticação — só recebe dado já pronto. |

## Fluxo principal

1. Nest monta o payload (diff, changed files com `fullContent` + `relatedFiles`, `conventions.md`, modelos escolhidos, API keys).
2. Nest chama `POST /agent/run` com `Accept: text/event-stream`.
3. Serviço monta o estado inicial do grafo e começa a execução.
4. Cada node concluído emite `data: {"type": "...", "payload": {...}}` na mesma conexão.
5. `test_reviewer` e `architecture_reviewer` rodam em paralelo após a spec.
6. `report_builder` agrega os dois resultados e emite `report_ready` — fim do stream.
7. Se qualquer node falhar de forma irrecuperável, emite `error` e encerra.

## Fora de escopo (deste PRD)

- Persistência de runs/histórico (fica só em memória no Nest).
- Cache (Redis) — nenhum dado é reaproveitado entre runs.
- Vectorstore / Knowledge Graph — sem indexação estrutural nesta integração inicial.
- Múltiplos provedores de LLM — só o modelo passado no payload (Anthropic).
- Planner autônomo / deep-agents completo (todo list dinâmico, filesystem virtual, delegação livre) — ver ADR, Decisão 1.
- Mais reviewers além de Test e Architecture.
- Autenticação e integração com GitHub — responsabilidade do Nest.

## Critérios de aceite

- [ ] `POST /agent/run` com payload válido devolve os 5 eventos na ordem esperada, terminando em `report_ready`.
- [ ] Payload sem `conventions.md` preenchido faz `architecture_reviewer` devolver score 100 sem chamar LLM (atalho determinístico).
- [ ] Payload sem arquivos de teste faz `test_reviewer` reprovar toda `businessRule`, sem chamar LLM.
- [ ] Score de cada reviewer bate com a fórmula (100 − 15×fails − 5×warnings, clamp 0–100) em teste unitário sem mock de LLM.
- [ ] Erro de LLM (timeout, resposta inválida) em qualquer node emite `error` e encerra o stream, sem travar a conexão.
- [ ] `GET /health` responde 200 sem depender de nenhuma API externa.

## Riscos conhecidos / dívida aceita

- **Latência do LLM sem cache:** cada run paga o custo total de rede/tempo, sem reaproveitar chamadas entre runs. Aceito no volume de uso do MVP (demo, um run por vez).
- **Único provedor de LLM (Anthropic):** trocar de provedor exige mudar `infrastructure/llm`. Aceito pra reduzir superfície do MVP.
- **Sem retry automático em falha de LLM:** falha vira evento `error` direto, sem tentativa nova. Reavaliar se falhas transitórias forem frequentes em uso real.
