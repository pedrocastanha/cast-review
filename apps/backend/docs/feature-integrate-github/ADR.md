# ADR: Integração com o GitHub — PAT cifrado, validação de escopo e proxy sem persistência

- **Status:** Aceito
- **Data:** 2026-08-09
- **Branches:** `feature/improve-github-integration` (e antecessoras: token/user/repositories)
- **Escopo:** `apps/backend` — módulos `users` e `repositories`, `shared/crypto`

## Contexto

O Cast Review precisa ler repositórios e pull requests do GitHub em nome do usuário logado, pra listar o que ele pode revisar. Isso exige três coisas: (1) uma credencial do GitHub por usuário, (2) guardar essa credencial com segurança, (3) usá-la pra chamar a API do GitHub sem vazar contexto entre usuários. As decisões abaixo evoluíram em várias iterações (ver histórico de commits `706f5f2` → `8aa402d` → `8cd7d0b` → `e64dba4` → `a380ea6`), incluindo uma correção de modelagem no meio do caminho.

## Decisão 1 — Personal Access Token colado pelo usuário, não GitHub OAuth App

**O quê:** o usuário gera um PAT no GitHub (classic, escopo `repo`/`public_repo`, ou fine-grained) e cola em `PATCH /users/:id { githubToken }`. Não há "Login with GitHub", callback URL, nem client secret de OAuth App.

**Por quê:** um OAuth App/GitHub App exige registro prévio no GitHub, gerenciar `client_id`/`client_secret`, e implementar o fluxo de redirect + troca de código por token — infraestrutura desproporcional pro estágio atual (projeto de portfólio, uso pessoal/demo). PAT colado é uma linha de código a menos e nenhum segredo de aplicação pra proteger além do próprio token do usuário.

**Trade-off aceito:** pior UX que "Login with GitHub" (usuário precisa saber gerar um PAT com o escopo certo). Aceito porque o público-alvo (devs avaliando o projeto) sabe gerar um PAT, e o ADR do frontend (`apps/frontend/ADR.md`) cobre como isso é exposto na UI (modal dedicado, com hint de escopo).

**Alternativa descartada:** GitHub OAuth App. Melhor UX e mais correto pra produto real com múltiplos usuários externos — reavaliar se o projeto sair do estágio de portfólio.

## Decisão 2 — Token cifrado em repouso (AES-256-GCM via `ValueTransformer`)

**O quê:** `User.githubToken` usa `encryptedColumn` (`shared/crypto/secret-crypto.ts`) — todo `save`/`update` cifra, todo `find` decifra, de forma transparente pro resto do código. Formato armazenado: `v1:<iv>:<authTag>:<ciphertext>` (base64), chave de 32 bytes vinda de `SECRET_ENCRYPTION_KEY` (env, `openssl rand -hex 32`).

**Por quê:** um PAT com escopo `repo` equivale a uma senha de acesso a código privado do usuário — nunca deve ficar em texto puro no Postgres. Um `ValueTransformer` no nível da coluna garante que **nenhum** service pode esquecer de cifrar/decifrar; a responsabilidade não depende de disciplina de quem escreve o próximo `service.ts`.

**Nota histórica:** o campo nasceu em texto puro (`706f5f2`) e com `UNIQUE` constraint em `github_token` (`706f5f2`/`02ad223`) — erro de modelagem duplo: (a) segredo em claro no banco, e (b) um token cifrado corretamente muda de valor a cada `save` (IV aleatório por cifragem), o que torna `UNIQUE` sobre o valor cifrado sem sentido. A migration `SecureGithubToken1786202400000` corrigiu os dois: cifrou os tokens existentes em texto puro e **removeu** a constraint `UNIQUE`.

**Trade-off aceito:** `SECRET_ENCRYPTION_KEY` vira um segredo operacional a mais pra gerenciar (perdê-la torna todo `githubToken` armazenado irrecuperável — ver `SecretDecryptionError`). Aceito porque é o preço padrão de qualquer cifragem simétrica; a alternativa (texto puro) não é aceitável.

## Decisão 3 — Token validado (escopo + capacidade real) no momento de salvar

**O quê:** `UserService.validateGithubToken` chama `octokit.users.getAuthenticated()` antes de persistir. Se a resposta trouxer o header `x-oauth-scopes` (PAT clássico), confere se contém `repo` ou `public_repo`. Se não trouxer (fine-grained token não expõe esse header), faz uma chamada real (`repos.listForAuthenticatedUser({ per_page: 1 })`) pra confirmar, na prática, que o token consegue ler repositório.

**Por quê:** falhar na hora de conectar, com mensagem específica ("token inválido/expirado" ou "precisa do escopo repo"), é muito melhor que deixar o usuário só descobrir o problema quando a listagem de repos voltar vazia ou com 401 genérico minutos depois.

**Trade-off aceito:** 1–2 chamadas extras à API do GitHub por operação de "conectar/trocar token" (evento raro, não hot path) — custo desprezível frente ao rate limit de 5000 req/h por token.

## Decisão 4 — `githubLogin` cacheado e usado como `owner` default

**O quê:** o login do GitHub descoberto na validação (ou, se ausente, no primeiro uso via `backfillLogin`) é salvo em `User.githubLogin` (texto puro — não é segredo). `RepositoriesService.session()` usa esse login como `owner` default em toda chamada; o controller aceita `?owner=` opcional pra sobrescrever (repositório de terceiro/organização).

**Por quê:** na esmagadora maioria dos casos o `owner` é o próprio usuário autenticado — obrigar o cliente a sempre informar `owner` seria repetição. Cachear evita uma chamada `users.getAuthenticated()` extra em toda listagem só pra descobrir quem é o usuário.

## Decisão 5 — `Octokit` instanciado por requisição, nunca compartilhado

**O quê:** `RepositoriesService.session()` cria `new Octokit({ auth: token })` a cada chamada, a partir do token daquele usuário especificamente (`userService.getGithubCredentials(currentUser.id)`). Não existe client Octokit singleton nem cache de instância entre requisições.

**Por quê:** cada usuário tem uma credencial diferente; um client compartilhado exigiria trocar a credencial em runtime a cada chamada — sob concorrência (dois usuários batendo no backend ao mesmo tempo), isso arrisca vazar o token/contexto de um usuário pra chamada de outro. Instanciar por requisição é stateless e elimina essa classe de bug por construção, ao custo de recriar um client HTTP leve a cada chamada (não é uma conexão persistente — custo desprezível).

## Decisão 6 — Sem persistência de repositórios/PRs no Postgres: proxy puro e sem cache

**O quê:** `GET /repositories`, `GET /repositories/:repo/pulls` e `GET /repositories/:repo/pulls/:pullNumber` sempre chamam o GitHub ao vivo (via `octokit.paginate`/`octokit.pulls.get`) e devolvem o resultado já achatado (`toPullSummary`). Nada é gravado no banco.

**Por quê:** repositório e PR mudam constantemente (novo commit, novo PR, PR fechada) — replicar esse dado no Postgres significa resolver staleness/sync sem nenhum ganho hoje: não há relatório, analytics ou busca offline sobre esses dados que justifique tê-los localmente.

**Trade-off aceito:** cada listagem é uma chamada de rede ao GitHub, sujeita ao rate limit (5000 req/h por token) e à latência do GitHub. Aceitável no volume de uso atual (pessoal/demo); se o produto crescer pra múltiplos usuários simultâneos revisando com frequência, cache com invalidação por webhook do GitHub vira necessário.

## Decisão 7 — Erros do GitHub traduzidos num único ponto (`handleGithubError`)

**O quê:** todo `catch` de chamada Octokit em `RepositoriesService` cai em `handleGithubError`, que loga a exceção completa (`AppLogger`) e mapeia `err.status` pra uma exception do Nest com mensagem em PT-BR: `401→UnauthorizedException`, `403|429→ForbiddenException`, `404→NotFoundException`, resto→`InternalServerErrorException`.

**Por quê:** sem esse ponto único, cada método (`listRepos`, `listPulls`, `getPullByNumber`, `backfillLogin`) reimplementaria a mesma leitura de `err.status` — divergência garantida (um endpoint trata 403, outro esquece). Esse refino veio do commit `a380ea6`, especificamente pra consolidar mensagem/logging que antes estavam duplicados.

## Consequências gerais

- Qualquer novo endpoint que chame o GitHub deve passar por `RepositoriesService.session()` (nunca instanciar `Octokit` solto) e ter seus erros tratados por `handleGithubError`.
- Trocar de PAT pra OAuth App no futuro é uma mudança isolada em `UserService`/`AuthModule` — `RepositoriesService` não muda, porque só depende de `getGithubCredentials(userId)` devolver um token válido, não de como esse token foi obtido.
- `SECRET_ENCRYPTION_KEY` ausente ou trocada em produção quebra a decifragem de todos os tokens já salvos (erro tratado, `BadRequestException`, mas exige reconectar o GitHub) — a chave precisa de backup/rotação cuidadosa, não é um valor "regenerável à vontade".
