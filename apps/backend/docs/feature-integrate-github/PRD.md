# PRD: Integração com o GitHub

- **Status:** Implementado
- **Data:** 2026-08-09
- **Escopo:** `apps/backend` (módulos `users`, `repositories`) + consumo em `apps/frontend`

## Problema

O Cast Review revisa código de repositórios do GitHub. Pra isso, precisa: saber quais repositórios o usuário pode acessar, e listar/inspecionar pull requests desses repositórios — usando a identidade do próprio usuário (não uma conta de serviço genérica), respeitando permissão privado/público exatamente como o GitHub já decide.

## Objetivo

Deixar um usuário cadastrado no Cast Review conectar sua conta do GitHub (via token) e, a partir disso, listar seus repositórios e as pull requests de qualquer um deles — sem o Cast Review guardar cópia desses dados.

## Usuários e contexto de uso

Desenvolvedor já com conta no Cast Review (email/senha), que quer usar a ferramenta pra revisar PRs dos próprios repositórios (pessoais ou de organizações às quais tem acesso). Uso pontual — conecta o token uma vez, revisita a lista de repos/PRs quando quiser.

## Requisitos funcionais

| # | Requisito | Onde |
|---|-----------|------|
| RF1 | Usuário autenticado pode salvar um Personal Access Token do GitHub associado à própria conta. | `PATCH /users/:id { githubToken }` |
| RF2 | Token é validado antes de salvar: precisa ser aceito pelo GitHub e ter permissão de leitura de repositório (`repo`/`public_repo`, ou capacidade equivalente pra fine-grained token). | `UserService.validateGithubToken` |
| RF3 | Usuário pode remover o token conectado a qualquer momento. | `DELETE /users/:id/github-token` |
| RF4 | Usuário autenticado pode listar todos os repositórios aos quais tem acesso (próprios, colaborador, organização). | `GET /repositories` |
| RF5 | Usuário autenticado pode listar as pull requests (abertas e fechadas) de um repositório específico. | `GET /repositories/:repo/pulls` |
| RF6 | Usuário autenticado pode ver o detalhe de uma pull request específica pelo número. | `GET /repositories/:repo/pulls/:pullNumber` |
| RF7 | Por padrão, `owner` do repositório/PR é o próprio usuário logado; pode ser sobrescrito via `?owner=` pra acessar repositório de terceiro/organização ao qual o token tenha acesso. | Query param `owner` em RF5/RF6 |
| RF8 | Resposta do perfil do usuário (`GET/PATCH /users/:id`) informa se há GitHub conectado (`githubConnected`) e qual o login (`githubLogin`), sem nunca expor o token em si. | `UserResponseDto` |

## Requisitos não funcionais

| # | Requisito |
|---|-----------|
| RNF1 | Token do GitHub nunca fica em texto puro em disco — cifrado em repouso (AES-256-GCM). |
| RNF2 | Token nunca aparece em resposta HTTP nem em log (`select: false` na coluna; `handleGithubError` loga a exceção do Octokit, não o token). |
| RNF3 | Cada usuário só acessa dados do GitHub com o próprio token — sem client Octokit compartilhado entre usuários. |
| RNF4 | Falha de autenticação/permissão do GitHub (401/403/404/429) vira erro HTTP claro em PT-BR, nunca um 500 opaco. |
| RNF5 | Toda operação de leitura (repos/PRs) é protegida por JWT do Cast Review — sem endpoint público expondo dado do GitHub de terceiro. |

## Fluxo principal

1. Usuário já logado no Cast Review (JWT) abre a tela de repositórios sem GitHub conectado.
2. Cola um PAT (gerado manualmente no GitHub, escopo `repo`) → `PATCH /users/:id`.
3. Backend valida o token contra a API do GitHub; se inválido/sem escopo, devolve erro específico e nada é salvo.
4. Token válido → cifrado e salvo; `githubLogin` é descoberto e cacheado.
5. Frontend rebusca o perfil (`githubConnected: true`) e chama `GET /repositories`.
6. Usuário escolhe um repositório → `GET /repositories/:repo/pulls?owner=...` lista as PRs.
7. Usuário abre uma PR → dado já obtido na listagem é exibido (ou, se necessário, `GET .../pulls/:pullNumber` busca individualmente).

## Fora de escopo (deste PRD)

- Login via GitHub OAuth ("Sign in with GitHub") — hoje a conta do Cast Review é email/senha; o GitHub é só uma integração de dados, não identidade. Ver Decisão 1 do ADR.
- Qualquer ação de escrita no GitHub (comentar PR, aprovar, merge). A integração hoje é somente leitura.
- Cache/persistência de repositórios ou PRs no Postgres. Ver Decisão 6 do ADR.
- Webhooks do GitHub (notificação de novo PR/commit em tempo real).
- Revisão automática por IA do conteúdo da PR — este PRD cobre só a integração de *dados* com o GitHub, não o pipeline de review (que não existe no backend ainda).

## Critérios de aceite

- [x] Conectar um PAT válido com escopo `repo` marca o usuário como `githubConnected: true` e popula `githubLogin`.
- [x] Conectar um token inválido ou sem escopo suficiente retorna erro e não altera o estado salvo do usuário.
- [x] Remover o token limpa `githubToken` e `githubLogin`; `githubConnected` volta a `false`.
- [x] `GET /repositories` sem token conectado retorna erro claro ("configure o token primeiro"), não 500.
- [x] `GET /repositories/:repo/pulls` aceita `owner` custom e usa o `githubLogin` do usuário como default quando omitido.
- [x] Erros do GitHub (401/403/404/429) chegam ao cliente como status HTTP equivalente com mensagem em português, não como stack trace.

## Riscos conhecidos / dívida aceita

- **Rate limit do GitHub (5000 req/h por token):** sem cache, uso intenso simultâneo por um usuário pode esgotar o limite do próprio token dele. Aceito no volume atual de uso.
- **`SECRET_ENCRYPTION_KEY` é um ponto único de falha:** perdê-la torna todo token salvo irrecuperável (usuários precisariam reconectar). Não há rotação de chave implementada.
- **PAT clássico expira/é revogado sem o Cast Review saber até a próxima chamada:** só descobrimos que o token morreu quando uma chamada real falha com 401 — não há verificação periódica em background.
