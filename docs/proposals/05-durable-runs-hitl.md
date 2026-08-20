\# PRD 05 — Runs duráveis, retomada e human-in-the-loop

**Status:** Proposta
**Prioridade:** 5
**Área:** `apps/ai-api` (LangGraph checkpointer) + `apps/backend` + front
**Esforço:** M (~4–6 dias)

---

## Problema

O grafo é compilado sem checkpointer (`build_graph()` → `graph.compile()` sem `checkpointer`), e o `run_pipeline` mantém estado em `asyncio.Queue` na memória do processo. Consequências reais:

- fechou a aba / caiu a conexão → `req.on('close')` aborta o `AbortController`, o run morre no meio e a análise fica `running` pra sempre no banco;
- erro em um reviewer no final do pipeline → perde-se o PRD e a Spec já pagos em token; retentar = pagar tudo de novo;
- restart do container Python durante um run → mesma coisa;
- não existe ponto de aprovação humana antes de o bot escrever na PR do usuário — `publishGithubComments` roda automático logo após `report_ready`.

O último ponto é o mais grave em produto: uma ferramenta que comenta sozinha em PR alheia com base em output de LLM precisa de gate humano, ou de opt-in explícito.

## Objetivo

Tornar o run **durável** (checkpoint por nó, retomada de onde parou) e adicionar um **interrupt de aprovação humana** antes de qualquer escrita no GitHub.

## Por que é bom pro portfólio

É a diferença entre "usei LangGraph como sequência de funções" e "usei LangGraph pelo que ele existe": checkpointer, `interrupt`, `Command(resume=...)`, thread_id. Durabilidade + HITL é o par que aparece em toda arquitetura séria de agente em produção, e mostra que você pensou no caminho infeliz — que é onde mora a engenharia.

---

## Escopo

**Dentro:**
- `AsyncPostgresSaver` como checkpointer do grafo, no Postgres que já sobe no compose.
- `thread_id = analysis.id` — o registro que já existe vira a identidade do run.
- Endpoint `POST /agent/resume` e ação "retomar" na UI, para runs `running`/`error`.
- Reconexão do SSE: reabrir a stream de um run em andamento sem reiniciá-lo.
- Nó `human_approval` com `interrupt()` antes da publicação no GitHub, com política configurável.
- Estados novos: `awaiting_approval` além de `running | completed | error`.

**Fora:**
- Fila de jobs distribuída (Celery/Arq). Um processo com checkpoint resolve o caso do MVP.
- Multi-tenant / concorrência entre múltiplos workers no mesmo `thread_id`.
- Time-travel / branching de checkpoint (mencionar como capacidade ganha de graça).

---

## Design técnico

### Checkpointer

```python
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

async def build_graph(checkpointer):
    ...
    return graph.compile(checkpointer=checkpointer)
```

Impacto no desenho atual: `_graph = build_graph()` hoje é módulo-level e síncrono. Passa a ser criado no lifespan do FastAPI (`app/main.py`) com pool de conexão, e injetado. O Python **continua stateless em regra de negócio** — ele ganha persistência de execução, não conhecimento de domínio. Vale registrar isso num ADR pra não parecer contradição com a decisão de arquitetura original.

Cada nó do grafo passa a ter checkpoint automático. Retomar = `astream(None, config={"configurable": {"thread_id": analysis_id}})`, que reexecuta apenas do último nó incompleto.

### Retomada

```
POST /agent/resume  { threadId, apiKeys, models }   -> SSE (mesmo formato de eventos)
```

Regras:
- API keys **não** são checkpointadas (segredo em banco de checkpoint é vazamento); são reinjetadas no resume. Exige separar segredos do `GraphState` — hoje `api_keys` está dentro do state e seria persistido. **Refactor obrigatório**: mover para `configurable` do runtime, fora do checkpoint.
- Resume idempotente: nó já concluído não reexecuta, não recobra token. É aqui que a economia aparece.
- Nest ganha `POST /analyses/:id/resume` e a UI mostra "Retomar" em análises `running` paradas ou `error`.

### Human-in-the-loop

Novo nó entre `report_builder` e a publicação:

```python
async def human_approval(state: GraphState):
    if state["publish_policy"] == "auto":
        return {"approval": {"decision": "approved", "by": "policy"}}
    decision = interrupt({
        "kind": "publish_github_review",
        "verdict": state["report"]["verdict"],
        "commentCount": len(state["report"]["comments"]),
        "preview": state["report"]["markdown"][:2000],
    })
    return {"approval": decision}
```

Política em 3 modos, escolhida na tela de run:

| Modo | Comportamento |
|---|---|
| `manual` (default) | sempre pede aprovação antes de publicar |
| `auto_safe` | publica sozinho se `verdict != request_changes` **e** nenhum guardrail `high` ([PRD 04](./04-prompt-injection-guardrails.md)) |
| `auto` | publica sempre (para demo/CI) |

Fluxo: run interrompe → evento SSE `awaiting_approval` com o preview → status vai pra `awaiting_approval` no banco → usuário aprova/rejeita/edita na UI → `POST /analyses/:id/approve { decision, comments? }` → `Command(resume=decision)`.

Nota de arquitetura: a publicação em si continua no Nest (é ele que tem GitHub e token). O nó `human_approval` decide; quem executa é o `AnalysesService`, que hoje já faz isso após `report_ready`. O Python nunca fala com o GitHub — fronteira preservada.

### Modelo de dados

Migration em `analyses`:
- `status` ganha `awaiting_approval`;
- `+ thread_id` (== id, mas explícito), `+ approval jsonb`, `+ publish_policy varchar`, `+ resumed_count int`.

Tabelas de checkpoint do LangGraph ficam em schema separado (`langgraph`) pra não misturar com o schema de domínio do TypeORM.

## Regras de negócio

1. Segredo (API key, PAT) **nunca** é persistido em checkpoint. Reinjetado a cada resume.
2. Resume não recobra etapa já concluída — verificável comparando `usage` antes/depois.
3. Sem aprovação, não há escrita no GitHub em modo `manual`.
4. Run em `awaiting_approval` expira em 24h (job de limpeza) e vira `error` com mensagem clara.
5. Aprovar é uma ação irreversível (publica em PR real) → UI exige confirmação e mostra o preview exato do que será postado.

## Métricas de sucesso

- Matar o container Python no meio de um run e retomar sem perder o PRD/Spec já gerados — GIF disso no README.
- Custo de um resume após falha no último reviewer ≈ custo só do reviewer, não do pipeline inteiro (número medido).
- Zero comentários publicados sem aprovação em modo `manual` (teste e2e).

## Riscos

| Risco | Mitigação |
|---|---|
| Estado grande (fullContent de N arquivos) inchando a tabela de checkpoint | Contexto pesado sai do state e vira referência a cache/artefato; guardar só path+hash |
| Chave no checkpoint (vazamento) | Refactor obrigatório para `configurable`; teste que falha se `api_keys` aparecer em checkpoint serializado |
| Complexidade de SSE reconectável | v1: reconexão só relê o registro persistido e retoma o stream a partir dali (os `thoughts` já são persistidos incrementalmente) |
| LangGraph API de `interrupt` mudar | Fixar versão no `pyproject`, cobrir com teste de integração |
