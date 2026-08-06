# Arquitetura — Frontend Cast Review (`apps/web`)

Documento de varredura do **frontend React**. Complementa `ARCHITECTURE-backend.md`.

---

## 1. Visão

SPA React + Vite + TypeScript que guia o usuário no fluxo:

```
Connect (PAT) → Repos → Pull Requests → Run (WS + relatório)
```

O browser **só fala com o Nest** (REST + Socket.IO). Nunca chama o Python (`ai-api`) nem a API do GitHub diretamente.

---

## 2. Stack

| Peça | Escolha |
|------|---------|
| Bundler | Vite 8 |
| UI | React 19 + TypeScript |
| Rotas | react-router-dom 7 |
| Tempo real | socket.io-client (RunGateway) |
| Estado | sessionStorage + React state local |
| Estilo | CSS global com design tokens (sem Tailwind no MVP) |

---

## 3. Estrutura de arquivos

```
apps/web/
├── index.html                 # fonts + title
├── vite.config.ts             # proxy /api e /socket.io → Nest :3000
├── package.json
└── src/
    ├── main.tsx               # createRoot + StrictMode
    ├── App.tsx                # BrowserRouter + rotas
    ├── index.css              # design system “mission control”
    ├── types.ts               # contratos TS do front
    ├── api/
    │   └── client.ts          # fetch REST → Nest
    ├── store/
    │   └── session-cache.ts   # sessionStorage (token, seleção, report)
    ├── hooks/
    │   └── useRunSocket.ts    # Socket.IO start_run + eventos
    ├── components/
    │   ├── Layout.tsx         # topbar, nav, footer
    │   ├── AgentStepper.tsx   # progresso do pipeline
    │   ├── ModelSelector.tsx  # modelos + API keys
    │   └── ReportView.tsx     # scores + markdown
    └── pages/
        ├── Connect.tsx
        ├── Repos.tsx
        ├── PullRequests.tsx
        └── Run.tsx
```

---

## 4. Cada arquivo — o que faz e relações

| Arquivo | Responsabilidade | Relaciona-se com |
|---------|------------------|------------------|
| `main.tsx` | Bootstrap React | `App`, `index.css` |
| `App.tsx` | Rotas do fluxo | pages + `Layout` |
| `index.css` | Tokens, layout, componentes | todas as pages/components |
| `types.ts` | Tipos wire-format | api, store, hooks, components |
| `api/client.ts` | `validatePat`, `listRepos`, `listPulls` | Nest REST via `/api` |
| `store/session-cache.ts` | Persistência de sessão | pages (load/save) |
| `hooks/useRunSocket.ts` | Conexão WS + estado da run | Nest `RunGateway`, `Run.tsx` |
| `Layout.tsx` | Shell + nav + disconnect | `session-cache`, router |
| `AgentStepper.tsx` | UI dos 5 passos do pipeline | `PIPELINE_STEPS`, events |
| `ModelSelector.tsx` | Form de models/keys | `Run.tsx` |
| `ReportView.tsx` | Relatório final | `report_ready` payload |
| `Connect.tsx` | PAT → `POST /auth/validate` | api + store |
| `Repos.tsx` | Lista repos | api + store |
| `PullRequests.tsx` | Lista PRs | api + store |
| `Run.tsx` | Orquestra config + WS + report | hook + components |
| `vite.config.ts` | Proxy dev | Nest :3000 |

---

## 5. Ordem de execução no browser

### 5.1 Connect

1. Usuário cola PAT.
2. `validatePat` → `POST /api/auth/validate` (proxy → Nest).
3. Sucesso → `setAuth(token, user)` no sessionStorage.
4. Navigate `/repos`.

### 5.2 Repos

1. Guard: sem token → `/`.
2. `listRepos(token)` → `GET /api/repos` + `Authorization: Bearer`.
3. Clique no repo → `setSelectedRepo` → `/pulls`.

### 5.3 Pulls

1. Guard: sem repo → `/repos`.
2. `listPulls` → `GET /api/repos/:owner/:repo/pulls`.
3. Clique na PR → `setSelectedPull` → `/run`.

### 5.4 Run

1. Guard: sem PR → `/pulls`.
2. Usuário escolhe modelos e cola API key(s) (sessionStorage).
3. “Rodar review” → `useRunSocket.start({ githubToken, owner, repo, pullNumber, models, apiKeys })`.
4. Socket.IO conecta (proxy `/socket.io` → Nest).
5. Emit `start_run`.
6. Recebe `run_started` → `agent_event`* → `run_finished`.
7. Em `report_ready`: `ReportView` + `setLastReport` no sessionStorage.
8. `AgentStepper` pinta done/active a cada evento.

### 5.5 Sequência de eventos esperada

```
change_analysis_done
spec_generated
test_reviewer_done
architecture_reviewer_done
report_ready
```

Ou `error` em qualquer ponto (pipeline encerra).

---

## 6. Segurança no front (MVP)

| Dado | Onde fica | Onde NÃO fica |
|------|-----------|---------------|
| GitHub PAT | sessionStorage + headers/body da run | localStorage, URL, logs de console em prod |
| LLM API keys | sessionStorage + body `start_run` | localStorage permanente, Nest disk |
| Relatório | sessionStorage + memória Nest | banco |

`sessionStorage` morre ao fechar a aba — adequado ao demo local do PRD.

---

## 7. Proxy Vite (dev)

```ts
// vite.config.ts
proxy: {
  '/api' → http://localhost:3000  (rewrite tira o prefixo /api)
  '/socket.io' → http://localhost:3000 (ws: true)
}
```

Assim o front usa:

- REST: `/api/auth/validate`, `/api/repos`, …
- WS: same-origin (path `/socket.io`)

Override opcional: `VITE_API_BASE`, `VITE_WS_URL`.

---

## 8. Como rodar

```bash
# Nest :3000 e Python :8000 já de pé
cd apps/web
npm install
npm run dev
# → http://localhost:5173
```

Build de produção:

```bash
npm run build
npm run preview
```

---

## 9. Relação com o backend (diagrama)

```
[Browser apps/web]
    │  REST /api/*
    │  WS  /socket.io
    ▼
[Nest apps/backend]
    │  HTTP SSE POST /agent/run
    ▼
[Python apps/ai-api]
```

Detalhes do Nest/Python: `docs/ARCHITECTURE-backend.md`.

---

## 10. Decisões de UI (portfólio)

- **Tema escuro “mission control”** — cobre + teal + serif display: memorável em demo.
- **Fluxo linear numerado (01–04)** — recrutador entende o produto em 30s.
- **Event log colapsável** — prova técnica do streaming sem poluir o relatório.
- **Sem biblioteca de componentes** — CSS enxuto, zero dependência de UI kit.

---

*Comentários no código explicam o porquê de cada módulo; este doc amarra o grafo e a ordem de execução no browser.*
