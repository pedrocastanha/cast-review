# Arquitetura — Backend Cast Review (Nest + Python)

Documento de varredura do **backend completo**: o monólito modular Nest (`apps/backend`) e o motor de agentes Python (`apps/ai-api`).  
Espelha o PRD (`PRD-cast-review-mvp-final.md`) e a SPEC (`SPEC-cast-review-mvp-hybrid.md`).

---

## 1. Visão em uma frase

O **NestJS** autentica o PAT, fala com o GitHub, monta contexto rico da PR e expõe WebSocket ao front.  
O **Python** só recebe esse pacote, roda o pipeline de agentes e devolve eventos via **SSE**.  
O Nest **repassa 1:1** esses eventos ao browser. O Python **nunca** fala com o front.

```
Browser ──REST/WS──► Nest (apps/backend) ──HTTP SSE──► Python (apps/ai-api)
                          │                                │
                          ├─ Auth (PAT)                    ├─ Change Analyzer
                          ├─ GitHub (Octokit)              ├─ Implementation Spec
                          ├─ Context Builder               ├─ Test Reviewer
                          └─ Run Gateway/Service           ├─ Architecture Reviewer
                                                           └─ Report Builder + score
```

---

## 2. Ordem de execução do sistema (ponta a ponta)

### Fase A — Conexão (REST)

| # | Quem | O quê |
|---|------|--------|
| 1 | Front | Usuário cola PAT |
| 2 | `POST /auth/validate` | Nest `AuthService` chama GitHub `GET /user` |
| 3 | Front | Guarda PAT em memória/session (não fica no Nest) |
| 4 | `GET /repos` + `Authorization: Bearer <pat>` | Nest lista repos via Octokit |
| 5 | `GET /repos/:owner/:repo/pulls` | Nest lista PRs |
| 6 | Front | Usuário escolhe modelos + cola API key do LLM |

### Fase B — Run (WebSocket + SSE)

| # | Quem | O quê |
|---|------|--------|
| 7 | Front | Conecta Socket.IO no Nest e emite `start_run` |
| 8 | `RunGateway` | Valida payload mínimo |
| 9 | `RunService.startRun` | Gera `runId` (UUID) |
| 10 | `ContextBuilderService` | Busca diff, files, headSha, conventions, fullContent, relatedFiles |
| 11 | `RunService` | `POST {AI_API_URL}/agent/run` com body JSON |
| 12 | Python `run_pipeline` | Etapas 1→5 (abaixo), cada uma vira linha SSE `data: {...}` |
| 13 | `RunService` | Parseia cada evento e chama callback |
| 14 | `RunGateway` | `client.emit('agent_event', event)` |
| 15 | Front | Atualiza stepper / relatório |
| 16 | Nest | Se `report_ready`, grava em `Map<runId, Report>` em memória |
| 17 | Gateway | Emite `run_finished` |

### Fase C — Pipeline Python (dentro do passo 12)

| Ordem | Módulo | Evento SSE | LLM? |
|------:|--------|------------|------|
| 1 | `pipeline/change_analyzer.py` | `change_analysis_done` | Não |
| 2 | `pipeline/implementation_spec.py` | `spec_generated` | Sim (1 call) |
| 3 | `pipeline/reviewers/test_reviewer.py` | `test_reviewer_done` | Sim* |
| 4 | `pipeline/reviewers/architecture_reviewer.py` | `architecture_reviewer_done` | Sim* |
| 5 | `pipeline/report_builder.py` | `report_ready` | Não |

\* Atalhos determinísticos evitam LLM (ex.: sem `conventions.md`, sem testes na PR).

Em falha irrecuperável: evento `error` com `{ step, message }` e **fim do stream**.

---

## 3. Mapa de pastas

```
apps/
├── backend/                     # Nest — orquestrador
│   └── src/
│       ├── main.ts
│       ├── app.module.ts
│       ├── app.controller.ts
│       ├── app.service.ts
│       ├── shared/types.ts
│       └── modules/
│           ├── auth/
│           ├── github/
│           ├── context-builder/
│           └── run/
│
└── ai-api/                      # Python — agentes
    ├── main.py
    ├── schemas.py
    ├── requirements.txt
    ├── pytest.ini
    ├── llm/client.py
    ├── pipeline/
    │   ├── scoring.py
    │   ├── change_analyzer.py
    │   ├── implementation_spec.py
    │   ├── report_builder.py
    │   └── reviewers/
    │       ├── base.py
    │       ├── test_reviewer.py
    │       └── architecture_reviewer.py
    └── tests/
```

---

## 4. Cada arquivo — o que faz e com quem se relaciona

### 4.1 NestJS (`apps/backend`)

| Arquivo | Responsabilidade | Relaciona-se com |
|---------|------------------|------------------|
| `main.ts` | Bootstrap, CORS, `ValidationPipe` global, porta | `AppModule` |
| `app.module.ts` | Wiring dos módulos de domínio + Throttler | Auth, Github, ContextBuilder, Run |
| `app.controller.ts` | `GET /` e `GET /health` | `AppService` |
| `app.service.ts` | Hello string do health | — |
| `shared/types.ts` | Tipos TS compartilhados (eventos, run, context) | Todos os módulos Nest |
| **auth/** | | |
| `auth.module.ts` | Fronteira do domínio auth | Controller + Service |
| `auth.controller.ts` | `POST /auth/validate` (throttle 5/min) | `AuthService` |
| `auth.service.ts` | Valida PAT via Octokit `users.getAuthenticated` | GitHub API |
| `dtos/validate-pat.dto.ts` | Validação class-validator do body | Controller |
| **github/** | | |
| `github.module.ts` | Fronteira GitHub; exporta service | ContextBuilder, Run (indireto) |
| `github.controller.ts` | `GET /repos`, pulls, detalhe PR; Bearer token | `GithubService` |
| `github.service.ts` | Octokit: repos, PRs, diff, files, content, conventions | Só API GitHub |
| **context-builder/** | | |
| `context-builder.module.ts` | Importa `GithubModule` | `RunModule` |
| `context-builder.service.ts` | fullContent + relatedFiles (regex de imports) | `GithubService` |
| `context-builder.service.spec.ts` | Testes da heurística de imports/paths | — |
| **run/** | | |
| `run.module.ts` | Único módulo que conhece o Python | ContextBuilder |
| `run.gateway.ts` | Socket.IO: `start_run` → eventos | `RunService`, front |
| `run.service.ts` | Monta payload, consome SSE, cache de reports | ai-api HTTP, ContextBuilder |
| `run.controller.ts` | `GET /runs`, `GET /runs/:runId` | `RunService` Map |

**Regra de dependência (importante):**

```
Auth ──x──► Run
Github ──x──► Run / Python
ContextBuilder ──► Github   (ok)
Run ──► ContextBuilder ──► Github   (ok)
Run ──► Python HTTP   (única ponte Nest→IA)
```

Ninguém exceto `RunModule` sabe que o Python existe.

---

### 4.2 Python (`apps/ai-api`)

| Arquivo | Responsabilidade | Relaciona-se com |
|---------|------------------|------------------|
| `main.py` | FastAPI, `POST /agent/run` SSE, `GET /health`, orquestra pipeline | Todos os `pipeline/*`, `schemas` |
| `schemas.py` | Contratos Pydantic (request, findings, eventos) | Todo o serviço |
| `requirements.txt` | Deps: fastapi, pydantic, httpx, pytest… | — |
| `pytest.ini` | `pythonpath = .` para imports `pipeline.*` | testes |
| `llm/client.py` | Anthropic/OpenAI via httpx, retry, parse JSON seguro | Spec + reviewers |
| `llm/__init__.py` | Pacote llm | — |
| `pipeline/scoring.py` | **Regra 1:** score 100 + pesos fail/warning/pass | `reviewers/base.py` |
| `pipeline/change_analyzer.py` | Heurística de paths/testes/migrations | `main.py` |
| `pipeline/implementation_spec.py` | Spec estruturada (1× LLM) | `llm/client`, schemas |
| `pipeline/report_builder.py` | Markdown + aggregate scores | `main.py` |
| `pipeline/reviewers/base.py` | Normaliza findings + `calculate_score` | test + architecture |
| `pipeline/reviewers/test_reviewer.py` | **Regra 2:** coverage por businessRule | spec + scoring |
| `pipeline/reviewers/architecture_reviewer.py` | **Regra 3:** só com `conventionRef` | conventions + scoring |
| `tests/*` | Unitários sem rede (scoring, analyzer, parse, report) | pipeline/llm |

---

## 5. Contratos de comunicação

### 5.1 Front → Nest (REST)

```http
POST /auth/validate
{ "token": "ghp_..." }

GET /repos
Authorization: Bearer ghp_...

GET /repos/:owner/:repo/pulls?state=open
Authorization: Bearer ghp_...
```

### 5.2 Front → Nest (WebSocket / Socket.IO)

```js
// emit
socket.emit('start_run', {
  githubToken: 'ghp_...',
  owner: 'acme',
  repo: 'api',
  pullNumber: 42,
  models: {
    testReviewer: 'claude-sonnet-4-6',
    architectureReviewer: 'claude-sonnet-4-6',
  },
  apiKeys: { anthropic: 'sk-...' },
})

// on
socket.on('run_started', ({ runId }) => {})
socket.on('agent_event', (event) => {})  // mesmo shape do SSE Python + runId
socket.on('run_finished', ({ runId }) => {})
socket.on('run_error', ({ message }) => {})
```

### 5.3 Nest → Python (HTTP SSE)

```http
POST /agent/run
Content-Type: application/json
Accept: text/event-stream

{
  "diff": "...",
  "changedFiles": [
    {
      "path": "src/x.ts",
      "diff": "...",
      "fullContent": "...",
      "relatedFiles": [{ "path": "src/y.ts", "content": "..." }]
    }
  ],
  "conventions": "...",
  "models": { "testReviewer": "...", "architectureReviewer": "..." },
  "apiKeys": { "anthropic": "..." }
}
```

Resposta (stream):

```
data: {"type":"change_analysis_done","payload":{...}}

data: {"type":"spec_generated","payload":{...}}

data: {"type":"test_reviewer_done","payload":{"score":85,"findings":[...]}}

data: {"type":"architecture_reviewer_done","payload":{...}}

data: {"type":"report_ready","payload":{"spec":{...},"results":[...],"markdown":"..."}}
```

---

## 6. Regras de negócio (onde vivem no código)

| # | Regra | Onde |
|---|--------|------|
| 1 | Score calculado (fail −15, warning −5, pass 0), clamp 0–100 | `pipeline/scoring.py` + `reviewers/base.py` |
| 2 | Test Reviewer: cada `businessRule` precisa de teste | `reviewers/test_reviewer.py` |
| 3 | Architecture: só finding com `conventionRef` | `reviewers/architecture_reviewer.py` |
| 4 | Sem gate de merge — relatório informativo | `report_builder.py` (texto) + ausência de endpoint de block |

---

## 7. Segurança das API keys (decisão consciente)

- PAT GitHub e keys de LLM trafegam **só em memória de request** (REST body / WS message / POST ao Python).
- **Não** são gravadas em log, banco ou arquivo.
- Throttle em `/auth/validate` reduz abuso.
- PAT vai no header `Authorization` nas rotas GitHub (não em query string).

---

## 8. Como rodar local

### Python (ai-api)

```bash
cd apps/ai-api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
# testes:
pytest -v
```

### Nest (backend)

```bash
cd apps/backend
npm install
# opcional: export AI_API_URL=http://localhost:8000
npm run start:dev
# testes:
npm test
```

Portas default: Nest **3000**, Python **8000**, front (ainda a fazer) **5173**.

---

## 9. O que ainda não é este documento

- Frontend React (`apps/web`) — próximo bloco do roadmap da SPEC.
- Persistência real / OAuth / filas — fora do MVP (ver PRD).
- Docker Compose — opcional; os dois processos sobem com os comandos acima.

---

## 10. Diagrama de sequência (run)

```
Front          RunGateway       RunService      ContextBuilder    Github      ai-api
  | start_run       |               |                 |              |           |
  |---------------->|               |                 |              |           |
  |                 | startRun()    |                 |              |           |
  |                 |-------------->|                 |              |           |
  |                 |               | buildForPR()    |              |           |
  |                 |               |---------------->|              |           |
  |                 |               |                 |-- pulls.* -->|           |
  |                 |               |                 |-- contents ->|           |
  |                 |               |<----------------|              |           |
  |                 |               | POST /agent/run (SSE) -------------------->|
  |                 |               |                 |              |    pipeline
  |                 |               |<---- data: change_analysis_done -----------|
  |                 | agent_event   |                 |              |           |
  |<----------------|<--------------|                 |              |           |
  |                 |               |<---- data: spec_generated ----------------|
  |<----------------|<--------------|                 |              |           |
  |                 |               |<---- data: *_reviewer_done ---------------|
  |<----------------|<--------------|                 |              |           |
  |                 |               |<---- data: report_ready ------------------|
  |<----------------|<--------------| (salva Map)     |              |           |
  | run_finished    |               |                 |              |           |
  |<----------------|               |                 |              |           |
```

---

*Gerado para estudo do portfólio Cast Review. Comentários no código reforçam o “porquê” de cada método; este `.md` amarra o grafo e a ordem de execução.*
