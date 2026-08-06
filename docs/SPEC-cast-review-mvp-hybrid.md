# SPEC Técnica — Cast Review (MVP)

**Referência:** implementa `PRD-cast-review-mvp-final.md`

**Arquitetura:** NestJS como monólito modular orquestrador (TypeScript) + Python como serviço isolado, stateless, contendo só a arquitetura de agentes. Comunicação via HTTP com streaming (SSE), Nest repassa pro front via WebSocket próprio.

---

# Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React + TypeScript + Vite |
| Backend (orquestração) | NestJS (TypeScript) |
| Backend (agentes) | Python + FastAPI |
| Comunicação front↔Nest | REST (listagem) + WebSocket (Nest Gateway) |
| Comunicação Nest↔Python | HTTP com streaming (Server-Sent Events) |
| Persistência | In-memory (padrão) — SQLite opcional no Nest via TypeORM/Prisma |
| GitHub | Octokit, só no Nest |
| LLM | SDK Anthropic/OpenAI, só no Python |

---

# Boas práticas de arquitetura para projetos de IA (aplicadas neste MVP)

1. **Monólito modular como padrão, extração pontual só quando um domínio justifica.** O pipeline de agentes é o único domínio aqui com ritmo de mudança e identidade próprios (troca de modelo, novo reviewer, ajuste de prompt) — é o único candidato legítimo a viver fora do monólito Nest.
2. **Fronteiras de módulo estruturais** — no Nest, via `@Module`/`exports`; no Python, o serviço inteiro é a fronteira (só existe um contrato de entrada/saída, sem exposição de estado interno).
3. **O serviço de IA é stateless e sem conhecimento de infraestrutura externa** — Python não sabe o que é GitHub, não autentica ninguém, só recebe dados já prontos. Isso facilita testar o pipeline isoladamente (unit + integração) sem precisar simular GitHub.
4. **Prompts como artefato versionado**, isolados por reviewer, dentro do próprio serviço Python.
5. **Falhas de sistemas de IA vêm de orquestração, não do modelo** — retry e parsing seguro da resposta do LLM (`llm/client.py`), timeout por chamada, tratamento explícito de erro por etapa, propagado como evento `error` no stream.
6. **Comece simples** — sem fila de mensagens, sem service mesh, sem observability completa. Um endpoint HTTP com streaming resolve a comunicação entre os dois serviços sem introduzir infraestrutura extra (broker, WS entre backends).

---

# Estrutura de pastas

```
cast-review/
├── apps/
│   ├── web/                              # frontend React
│   │   └── src/
│   │       ├── pages/
│   │       │   ├── Connect.tsx
│   │       │   ├── Repos.tsx
│   │       │   ├── PullRequests.tsx
│   │       │   └── Run.tsx
│   │       ├── components/
│   │       │   ├── AgentStepper.tsx
│   │       │   ├── ModelSelector.tsx
│   │       │   └── ReportView.tsx
│   │       ├── hooks/
│   │       │   └── useRunSocket.ts
│   │       └── store/
│   │           └── session-cache.ts
│   │
│   ├── api/                              # NestJS — orquestrador
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts
│   │       ├── auth/
│   │       │   ├── auth.module.ts
│   │       │   ├── auth.controller.ts    # POST /auth/validate
│   │       │   └── auth.service.ts
│   │       ├── github/
│   │       │   ├── github.module.ts
│   │       │   ├── github.controller.ts  # GET /repos, GET /repos/:owner/:repo/pulls
│   │       │   └── github.service.ts     # Octokit + busca diff + conventions.md
│   │       ├── context-builder/
│   │       │   ├── context-builder.module.ts
│   │       │   └── context-builder.service.ts  # monta arquivos completos + relacionados
│   │       ├── run/
│   │       │   ├── run.module.ts
│   │       │   ├── run.gateway.ts        # WebSocket com o front
│   │       │   └── run.service.ts        # chama o endpoint SSE do Python e traduz pro WS
│   │       └── shared/
│   │           └── types.ts              # contratos compartilhados com o front
│   │
│   └── ai-agent/                         # Python — só a arquitetura de agentes
│       ├── main.py                       # FastAPI, expõe POST /agent/run (SSE)
│       ├── pipeline/
│       │   ├── change_analyzer.py
│       │   ├── implementation_spec.py
│       │   ├── scoring.py                # regra de negócio 1 (função pura)
│       │   ├── reviewers/
│       │   │   ├── base.py
│       │   │   ├── test_reviewer.py
│       │   │   └── architecture_reviewer.py
│       │   └── report_builder.py
│       ├── llm/
│       │   └── client.py                 # abstrai Claude/GPT; retry + parse seguro
│       ├── schemas.py                    # pydantic: request/response/eventos
│       └── tests/
```

**Regra de fronteira:** `apps/ai-agent` não importa nada de `apps/api` nem vice-versa em nível de código — a única integração é o contrato HTTP do endpoint `POST /agent/run`. Dentro do Nest, `RunModule` é o único módulo que conhece a existência do serviço Python; `GithubModule` e `AuthModule` não sabem que ele existe.

---

# Context Builder (Nest)

Responsável por montar o payload rico enviado ao Python — não é um agente de IA, é lógica determinística de coleta:

```typescript
// context-builder/context-builder.service.ts
interface ChangedFileContext {
  path: string;
  diff: string;
  fullContent: string;
  relatedFiles: { path: string; content: string }[]; // limitado, ex: máx. 5 por arquivo
}
```

Algoritmo:
1. Para cada arquivo alterado na PR → busca conteúdo completo via `GithubService` (Contents API).
2. Extrai imports/requires do arquivo via regex simples (ex: `import .* from ['"](\.\/|\.\.\/)/`) — só resolve caminhos internos do repositório, ignora pacotes de terceiros.
3. Busca o conteúdo de cada import resolvido, até um limite configurável (padrão: 5 por arquivo alterado, corta os demais).
4. Monta o payload final: lista de `ChangedFileContext[]` + diff bruto (mantido também, útil pro Change Analyzer) + conventions.

Isso é uma versão simplificada de indexação estrutural — sem grafo de dependências, sem embeddings, sem call graph — mas já dá ao LLM visão de "o que essa mudança toca e de que depende", que é o cerne do diferencial do produto frente a ferramentas que revisam só diff.

---

# Contrato do endpoint Python (`POST /agent/run`)

**Request:**
```json
{
  "diff": "...",
  "changedFiles": [
    {
      "path": "src/offers/offers.service.ts",
      "diff": "...",
      "fullContent": "...",
      "relatedFiles": [
        { "path": "src/offers/offer.entity.ts", "content": "..." }
      ]
    }
  ],
  "conventions": "nunca usar float para dinheiro, usar Money...",
  "models": { "testReviewer": "claude-sonnet-4-6", "architectureReviewer": "claude-sonnet-4-6" },
  "apiKeys": { "anthropic": "sk-..." }
}
```

**Response:** `text/event-stream`, uma linha JSON por evento:
```
data: {"type":"change_analysis_done","payload":{"files":[...],"hasTests":false,"hasMigration":true}}

data: {"type":"spec_generated","payload":{"summary":"...","newContracts":[...],"businessRules":[...]}}

data: {"type":"test_reviewer_done","payload":{"score":65,"findings":[...]}}

data: {"type":"architecture_reviewer_done","payload":{"score":90,"findings":[...]}}

data: {"type":"report_ready","payload":{"spec":{...},"results":[...]}}
```

Em caso de falha em qualquer etapa: `{"type":"error","payload":{"step":"spec_generated","message":"..."}}` — o Python encerra o stream após um evento de erro; o Nest repassa esse evento ao front e finaliza a run.

---

# Fluxo ponta a ponta

1. **Connect** — front envia PAT → `POST /auth/validate` (Nest) → `AuthService` valida contra GitHub API.
2. **Repos / PRs** — Nest faz proxy via `GithubService` (Octokit).
3. **Configuração** — usuário escolhe modelo por agente + cola API key (fica em memória da sessão do front).
4. **Run** — front abre `WebSocket` com o Nest (`RunGateway`). `RunService`:
   a. busca o diff da PR e o conteúdo de `conventions.md` via `GithubService`, e monta o pacote de contexto rico via `ContextBuilderService` (arquivos completos + relacionados);
   b. faz `POST /agent/run` pro Python com esse payload + models + apiKeys, mantendo a conexão HTTP aberta para leitura do stream;
   c. a cada linha de evento recebida do Python, repassa via `RunGateway` pro front, sem transformar o payload.
5. **Relatório** — evento `report_ready` chega ao front; front guarda no cache da sessão (`localStorage`). Nest também guarda o resultado em memória (`Map<runId, Report>`) enquanto o processo estiver de pé.

---

# Regra de negócio em código (Python, não no prompt)

```python
# pipeline/scoring.py
SEVERITY_WEIGHTS = {"fail": -15, "warning": -5, "pass": 0}

def calculate_score(findings: list[Finding]) -> int:
    score = 100 + sum(SEVERITY_WEIGHTS[f.status] for f in findings)
    return max(0, min(100, score))
```

O LLM só devolve a lista de `findings` com `status`; `calculate_score` é função pura, testável sem chamada de API — cobre a regra de negócio 1 do PRD. Vive no Python porque é parte da arquitetura de agentes, não da orquestração.

---

# Segurança das API keys

- A key trafega só no corpo da requisição `POST /agent/run`, do front até o Nest (em memória de request) e do Nest até o Python (em memória de request) — nunca gravada em log, banco ou arquivo em nenhum dos dois serviços.
- Documentar essa decisão no README como escolha consciente, mesmo em uso local sem exigência de produção.

---

# Testes

**Python (`ai-agent`):**
- `scoring.py` — testes unitários puros.
- `change_analyzer.py`, `report_builder.py` — lógica determinística, testes diretos.
- `implementation_spec.py`, `reviewers/*` — `llm/client.py` mockado (fixtures de resposta válida e inválida, testando o fallback de parse).
- Teste de integração do endpoint `/agent/run` validando a sequência de eventos SSE emitidos, com fixtures de diff.

**NestJS (`api`):**
- `auth`, `github` — testes de controller/service com GitHub API mockada.
- `run.service.ts` — teste com o endpoint Python mockado (stream simulado), validando que os eventos são repassados 1:1 pro gateway.

**Frontend:**
- `AgentStepper` com sequência de eventos mockada; `useRunSocket` com WS mockado.

---

# Ordem de implementação sugerida

1. Python: `schemas.py` + `pipeline/scoring.py` (zero dependência de IA) + testes
2. Python: `change_analyzer.py` + testes
3. Python: `llm/client.py` com parsing seguro (retry + fallback) + testes com fixtures
4. Python: `implementation_spec.py` + `reviewers/*` (LLM mockado)
5. Python: `report_builder.py` + endpoint `POST /agent/run` com SSE, testado isoladamente (`curl`/Postman, sem Nest ainda)
6. Nest: `auth` + `github` (parte simples, sem IA)
7. Nest: `context-builder` (busca arquivos completos + relacionados) + testes
8. Nest: `run` module consumindo o endpoint Python e repassando pro `RunGateway`
9. Frontend: Connect → Repos → PullRequests → Run (`AgentStepper` + `ReportView`)
10. Polimento: README, GIF de demo, `docs/RUNNING.md`
