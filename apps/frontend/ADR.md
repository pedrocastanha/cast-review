# ADR: Frontend do Cast Review — stack, design system, interfaces, modais e componentização

- **Status:** Aceito
- **Data:** 2026-08-09
- **Branch:** `main`
- **Escopo:** `apps/frontend`

## Contexto

O backend (`apps/backend`) já expõe três módulos reais: `auth` (JWT via email/senha, sem OAuth), `users` (perfil + token do GitHub cifrado) e `repositories` (proxy pro octokit — listar repos, listar/ver PRs). Não existe (ainda) pipeline de review por IA nem WebSocket no backend — só CRUD + integração GitHub read-only. O frontend foi desenhado pra cobrir exatamente essa superfície, sem antecipar telas de um fluxo que não existe no servidor.

Havia um documento antigo (`docs/ARCHITECTURE-frontend.md`, `apps/web`) descrevendo um fluxo de review com PAT direto e WebSocket. Ele descreve um escopo que o backend atual não implementa — não foi usado como base. Este ADR documenta o app novo, em `apps/frontend`, construído contra a API real.

## Decisão 1 — React + Vite + TypeScript + react-router-dom, sem framework de estado

**O quê:** SPA client-side, roteada por `react-router-dom`. Sem Redux/Zustand/React Query — estado de sessão vive em `AuthContext` (React Context + `localStorage`), estado de dado remoto vive em hooks locais (`useRepositories`, `usePullRequests`) com `useState`/`useEffect`.

**Por quê:** a superfície de dados é pequena (3 recursos: user, repos, PRs) e não há cache cross-page nem mutação otimista complexa que justifique uma lib de data-fetching. Introduzir React Query pra três `GET`s seria peso sem ganho.

**Trade-off aceito:** sem cache automático entre navegações — trocar de repo e voltar refaz o fetch. Aceitável no tamanho atual; se a superfície crescer (mais recursos, mutações concorrentes), React Query volta a fazer sentido.

## Decisão 2 — Tailwind CSS v4 (`@theme`) em vez de CSS module/CSS-in-JS

**O quê:** tokens de design (cor, tipografia, espaço, raio, easing) definidos uma vez em `src/index.css` via `@theme` do Tailwind v4, consumidos como classes utilitárias direto no JSX. Sem `tailwind.config.js` (v4 dispensa) e sem biblioteca de componentes (nenhum MUI/Radix/shadcn).

**Por quê:** um único arquivo de tokens vira a fonte de verdade (`--color-accent`, `--font-display`, etc.) e qualquer componente usa essa paleta sem reimportar nada — sem risco de duas cores "quase iguais" coexistindo. Classe utilitária inline mantém componente e estilo no mesmo lugar, sem arquivo `.module.css` irmão pra cada componente.

**Trade-off aceito:** JSX fica mais verboso (muitas classes por elemento). Aceito porque o projeto é pequeno o bastante pra isso não virar ilegível, e a alternativa (CSS solto) tende a acumular classe morta com o tempo.

## Decisão 3 — Interfaces TypeScript centralizadas em `types/`, espelhando os DTOs do backend

**O quê:** `src/types/index.ts` define `User`, `Repository`, `PullRequest`, `AuthTokens`, `LoginPayload`, `RegisterPayload`, `UpdateUserPayload` — um a um, no mesmo formato que os `*ResponseDto`/entidades do Nest devolvem. Todo `api/*.ts` retorna esses tipos; todo componente recebe esses tipos como prop.

**Por quê:**
- O contrato HTTP vira código, não convenção verbal — um campo renomeado no backend (ex.: `githubConnected`) quebra o build do frontend em vez de quebrar em produção silenciosamente.
- Autocomplete e refactor seguro: mudar `Repository.defaultBranch` de nome propaga erro de compilação pra todo lugar que usa.
- Um único lugar (`types/`) pra auditar o que o frontend realmente consome da API, sem caçar `any` espalhado.

**Trade-off aceito:** exige manter `types/` sincronizado manualmente com os DTOs do Nest (não há geração automática de tipos a partir do backend). Aceitável no tamanho atual do time (uma pessoa, um repo); geração automática (ex. OpenAPI) fica pra quando a superfície crescer.

## Decisão 4 — Modais só onde a navegação por página perderia contexto

**O quê:** dois modais no app, nenhum a mais:
1. `GithubTokenModal` — conectar/trocar/remover o PAT do GitHub.
2. `PullRequestDetailModal` — ver detalhe de uma PR sem sair da lista.

Ambos implementados sobre um `Modal` genérico (`components/ui/Modal.tsx`): portal pro `document.body`, fecha em Esc ou clique fora, `role="dialog"` + `aria-modal`.

**Por quê:** modal é a exceção, não o padrão — inclusive o guia de design usado nesse projeto (impeccable) marca "modal" como recurso preguiçoso por padrão. Os dois casos aqui passam num teste específico: a ação é curta, não merece URL própria, e voltar pra lista sem perder scroll/estado importa mais do que ter uma rota dedicada. Token do GitHub não é um "recurso" que se navega — é uma configuração pontual da conta. Detalhe de PR reaproveita o dado que a lista *já buscou* (nenhum fetch novo é feito ao abrir o modal — ver Decisão 5), então criar uma rota `/pulls/:number` só pra rehidratar o que já está em mãos seria trabalho sem ganho.

**Alternativa descartada:** rota própria (`/repos/:owner/:repo/pulls/:number`) pro detalhe da PR. Descartada porque duplicaria o fetch (a lista já tem o dado) e adicionaria guard de navegação sem necessidade real — o usuário nunca precisa linkar direto pra essa URL (o link pra PR de verdade é o botão "Abrir no GitHub").

## Decisão 5 — Detalhe de PR não refaz fetch; API client cobre o endpoint mesmo assim

**O quê:** `GET /repositories/:repo/pulls/:pullNumber` existe no backend e está espelhado em `repositoriesApi.getPull`, mas `PullRequestDetailModal` recebe a `PullRequest` já carregada pela listagem — não chama esse endpoint.

**Por quê:** `toPullSummary` no backend usa exatamente os mesmos campos pra lista e pra detalhe — não há dado adicional ganho ao buscar de novo. Refazer o fetch seria uma requisição de rede sem propósito. O client mantém a função porque é uma rota real da API (cobertura 1:1 com o backend), mesmo sem uso hoje — é diferente de expor um método especulativo que o backend nunca teve.

## Decisão 6 — Sessão: token em `localStorage`, sem endpoint `/auth/me`

**O quê:** `accessToken`/`refreshToken` em `localStorage`. Como o login (`POST /auth/login`) devolve só os tokens (não o usuário, e o backend não tem `/auth/me`), o frontend decodifica o `sub` do JWT (payload base64, sem lib externa) e busca `GET /users/:id` pra hidratar o usuário. Em qualquer 401 de uma chamada autenticada, tenta `POST /auth/refresh` uma vez; se falhar, limpa tokens e dispara um evento (`auth:logout`) que o `AuthContext` escuta pra deslogar.

**Por quê:** dado o backend não expor "quem sou eu", decodificar o JWT no client é a única forma de saber o `id` sem pedir login/senha de novo. É leitura local do payload (não valida assinatura) — aceitável porque o token só é usado pra extrair um id que o próprio backend vai validar em toda chamada seguinte via `JwtAccessGuard`.

**Trade-off aceito:** token em `localStorage` (não `httpOnly` cookie) fica exposto a XSS caso o app tenha uma falha de injeção. Aceito porque é o mesmo modelo que o backend já expõe (Bearer token em header, sem suporte a cookie) — mudar exigiria alterar o backend (CORS + cookie), fora do escopo deste ADR.

## Decisão 7 — Organização por feature, não por tipo de arquivo

**O quê:**
```
src/
├── types/            # contratos
├── api/              # 1 arquivo por recurso do backend (auth, users, repositories) + http.ts
├── context/           # AuthContext
├── hooks/              # data-fetching (useRepositories, usePullRequests)
├── components/
│   ├── ui/            # Button, Modal, Field, Spinner, EmptyState — sem conhecimento de domínio
│   ├── layout/         # Navbar, Layout, ProtectedRoute, GuestRoute
│   ├── github/         # GithubTokenModal
│   ├── repos/          # RepositoryCard
│   └── pulls/          # PullRequestCard, PullRequestDetailModal, PullRequestStatusBadge
└── pages/              # LoginPage, RegisterPage, ReposPage, PullRequestsPage
```

**Por quê:** `components/ui/` nunca importa nada de domínio (não sabe o que é um "repositório" ou uma "PR") — é reutilizável em qualquer tela nova. `components/<feature>/` só existe se a feature tiver componente próprio; senão a página é o componente. Isso espelha a organização por módulo que o backend já usa (`modules/auth`, `modules/users`, `modules/repositories`) — mesma lógica de "cada pasta é uma fronteira de domínio", só que do lado do cliente.

## Consequências gerais

- Todo novo endpoint do backend que o frontend precisar consumir ganha: tipo em `types/`, função em `api/<recurso>.api.ts`, e (se precisar de loading/error state) um hook em `hooks/`.
- Modal só entra como opção quando a alternativa (rota própria) não teria ganho real — não é o padrão default pra "mostrar mais detalhe".
- `.impeccable.md` na raiz do monorepo guarda o contexto de design (paleta, tipografia, personalidade de marca) usado por esse app — qualquer novo componente visual deve seguir esses tokens em vez de introduzir cor/fonte nova.
