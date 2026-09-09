# SPEC: Production Readiness, Secure Deploy e Cast MCP

**Status:** Draft para revisão  
**Data:** 2026-09-06  
**Escopo:** CI/CD, deploy, hardening de segurança, proteção de dados, E2E e servidor MCP

## 1. Resultado esperado

O Cast deve poder rodar em produção com uma superfície de ataque controlada e um processo de entrega repetível:

```text
Vercel (frontend)
        │ HTTPS, cookies seguros, CORS explícito
        ▼
Railway (backend NestJS) ── rede privada + autenticação de serviço ──▶ Railway (ai-api)
        │
        ├── PostgreSQL privado, SSL e RLS
        ├── Redis privado, TLS e fila
        └── Neo4j privado, TLS e autenticação

Agente externo ── HTTPS + OAuth/MCP ──▶ Railway (Cast MCP) ── rede privada ──▶ backend
```

O deploy de uma versão só pode ficar ativo depois de migrations compatíveis, testes, validações de segurança, build e health checks passarem. O frontend nunca recebe credenciais de banco, GitHub, OpenAI, Railway, Neo4j, Redis ou do próprio MCP.

Esta SPEC parte da arquitetura atual: `apps/frontend`, `apps/backend` e `apps/ai-api`. O `ai-api` também será implantado, mas ficará sem domínio público. O MCP será um serviço separado que reutiliza os casos de uso e a autorização do backend.

## 2. Problemas observados no baseline

A implementação atual já possui bons fundamentos — `synchronize: false`, hash de senha, criptografia AES-256-GCM para segredos e `@nestjs/throttler` —, mas a preparação para produção precisa fechar estes pontos:

- o backend usa `origin: true` com `credentials: true`;
- tokens de acesso e refresh ficam no `localStorage` do frontend;
- não há pipeline versionado de GitHub Actions no repositório;
- ainda não existe uma estratégia executável de RLS com role de runtime e contexto de usuário;
- o `ai-api` expõe rotas HTTP que precisam de rede privada e autenticação de serviço em produção;
- logs e erros precisam de redaction centralizada antes de receberem tráfego real;
- migrations, deploys, rollback e testes E2E ainda não formam um gate único;
- o frontend precisa de auditoria do bundle e de sanitização de URLs renderizadas pelo Markdown.

Esses itens são lacunas de produção identificadas no código, não afirmações de que exista um vazamento ativo. A fase inicial deve confirmar cada uma com testes e inspeção do ambiente.

## 3. Objetivos

1. Entregar backend, `ai-api` e MCP por imagens imutáveis identificadas pelo commit.
2. Executar migrations de forma controlada antes de liberar a nova versão.
3. Bloquear merge e deploy quando qualidade, segurança, compatibilidade ou E2E falharem.
4. Garantir isolamento entre usuários no backend e no PostgreSQL.
5. Remover credenciais e dados sensíveis do browser, URLs, logs, telemetria e artefatos.
6. Expor o MCP com autenticação, autorização por projeto e ferramentas de escopo limitado.
7. Permitir uma auditoria verificável de cada ação feita pelo backend, worker ou MCP.

## 4. Fora de escopo

- Prometer segurança absoluta ou substituir uma auditoria profissional externa.
- Construir um provedor de identidade completo para organizações nesta primeira entrega.
- Expor queries Cypher, SQL, shell, filesystem ou chamadas arbitrárias ao GitHub por MCP.
- Permitir escrita em repositórios pelo MCP v1.
- Criptografar senhas de forma reversível.
- Reescrever todos os dados de negócio com criptografia de campo sem uma necessidade de consulta que justifique isso.

## 5. Decisões de arquitetura

| ID | Decisão | Motivo |
|---|---|---|
| D-01 | Produção não possui defaults para segredos, URLs internas, CORS, DB ou Redis. Configuração ausente encerra o processo. | Falhar fechado evita subir uma instância com credenciais ou permissões implícitas. |
| D-02 | O backend usa `FRONTEND_ORIGINS` como allowlist exata. `origin: true` é proibido em produção. | CORS com credenciais não pode refletir qualquer origem. |
| D-03 | O refresh token sai do JavaScript e passa a ser cookie `HttpOnly`, `Secure`, com rotação e revogação. O access token fica somente em memória. | Reduz o impacto de XSS e evita persistir tokens no browser. |
| D-04 | Senhas e refresh tokens são armazenados como hash. PATs, API keys e segredos recuperáveis usam criptografia autenticada com versionamento de chave. | Cada tipo de dado recebe o controle adequado. |
| D-05 | O runtime usa uma role PostgreSQL sem `BYPASSRLS`, com RLS forçado nas tabelas de usuário. Migrations usam uma role separada. | O banco vira uma segunda barreira contra IDOR e regressões de autorização. |
| D-06 | Toda operação de banco autenticada executa em transação com `SET LOCAL app.user_id`. O contexto nunca é colocado permanentemente numa conexão do pool. | Evita vazamento de contexto entre requisições. |
| D-07 | `ai-api`, PostgreSQL, Redis e Neo4j só aceitam tráfego privado. Backend e `ai-api` usam autenticação de serviço além da rede privada. | Rede privada reduz exposição; autenticação impede confiança cega na rede. |
| D-08 | O MCP remoto segue o modelo de autorização HTTP do MCP, com OAuth 2.1/PKCE, audience/resource binding e tokens curtos. O transporte local stdio usa credencial do ambiente. | O cliente recebe um token destinado ao MCP, e não um token de outro serviço. |
| D-09 | MCP v1 é read-only, exceto iniciar uma análise custosa com quota e permissão própria. | Consulta contextual é o primeiro caso de uso; ações externas entram depois de validar o modelo de autorização. |
| D-10 | Migrations de produção são forward-only e compatíveis com a versão anterior durante o rollout. `migration:revert` não é procedimento de produção. | Permite rollback da aplicação sem depender de rollback destrutivo do schema. |

## 6. Ambientes

| Ambiente | Frontend | Backend/MCP | Banco e filas | Uso |
|---|---|---|---|---|
| Local | Vite | processos locais | Docker Compose | desenvolvimento |
| CI | build isolado | serviços efêmeros | Postgres/Redis/Neo4j de teste | gates e E2E |
| Staging | preview protegida | Railway staging | recursos exclusivos | smoke, DAST e aprovação |
| Production | domínio Vercel | Railway production | recursos exclusivos | usuários reais |

Cada ambiente deve ter chaves JWT, chave de criptografia, banco, Redis, Neo4j, tokens MCP e credenciais de integração diferentes. Staging nunca compartilha dados ou segredos de produção.

O Vercel recebe apenas variáveis públicas necessárias ao bundle, como a origem pública da API quando aplicável. Qualquer variável `VITE_*` é considerada pública por definição. Segredos ficam em variáveis do backend ou do serviço MCP e nunca são prefixados com `VITE_`.

## 7. Pipeline CI/CD

### 7.1 Pull request

Todo pull request deve executar os seguintes checks. Os nomes podem mudar junto da configuração, mas cada gate precisa existir como status obrigatório da branch principal:

| Gate | Escopo | Critério |
|---|---|---|
| `frontend/quality` | TypeScript | `npm ci`, lint, testes e build passam. |
| `backend/quality` | NestJS | `npm ci`, Biome, testes unitários, integração e build passam. |
| `ai-api/quality` | Python | instalação limpa, lint, type check e pytest passam. |
| `mcp/quality` | MCP | schema validation, testes de autorização, ferramentas e build passam. |
| `migration/compatibility` | TypeORM/Postgres | banco limpo sobe, todas as migrations rodam, segunda execução é idempotente e schema esperado é confirmado. |
| `security/secrets` | repositório e histórico recente | scanner de segredos não encontra credenciais ou material privado. |
| `security/dependencies` | Node, Python e imagens | vulnerabilidades acima do limite definido bloqueiam o merge. |
| `security/sast` | TypeScript e Python | análise estática sem finding bloqueante. |
| `security/iac` | Docker, Compose, workflows e config | imagens, permissões e workflows passam a análise. |
| `e2e/critical-path` | browser + API | jornada autenticada e cenários negativos passam com providers fake. |
| `artifact/integrity` | imagens e bundles | imagem identificada pelo SHA, SBOM gerado e bundle sem segredos. |

O pipeline deve usar `npm ci` e arquivos de lock. Instalação com `npm install` não é permitida nos gates. A versão do Python e dos scanners deve ser fixada ou controlada por arquivo de dependências versionado.

### 7.2 Checks de segurança

O pipeline deve incluir, no mínimo:

- secret scanning no working tree e no histórico que será publicado;
- auditoria de dependências Node e Python;
- SAST para TypeScript e Python;
- scan de Dockerfiles e imagens, incluindo CVEs do sistema operacional;
- validação de permissões dos workflows, actions pinadas por SHA quando possível e `GITHUB_TOKEN` com permissões mínimas;
- geração de SBOM por imagem;
- scan do bundle final procurando padrões como `sk-`, PATs do GitHub, JWTs, chaves privadas, URLs internas e valores de ambiente sensíveis;
- verificação de que source maps de produção não são publicados publicamente, salvo decisão explícita.

Findings críticos ou altos devem bloquear o deploy. Exceções exigem arquivo versionado com justificativa, responsável, prazo de expiração e aprovação explícita.

### 7.3 Deploy

O fluxo de produção deve seguir esta ordem:

1. Merge em `main` após todos os gates obrigatórios.
2. Build das imagens do backend, `ai-api` e MCP usando o commit exato.
3. Scan das imagens e publicação em registry privado.
4. Deploy em Railway staging.
5. Execução das migrations com a role de migration, antes do tráfego da nova aplicação.
6. Health check, smoke tests e E2E contra staging.
7. Aprovação do ambiente de produção enquanto o fluxo ainda estiver em estabilização.
8. Deploy da mesma imagem em Railway production.
9. Health check de cada serviço e smoke test pós-deploy.
10. Deploy de produção do frontend na Vercel a partir do mesmo commit.

Uma falha de migration impede a troca da versão da aplicação. Um deploy saudável deve atender `/health` com `2xx` e possuir um readiness check separado que reporte dependências essenciais sem expor credenciais ou detalhes internos.

O rollback padrão restaura a imagem anterior e suas variáveis. Alterações destrutivas de banco seguem o padrão expand/contract: adicionar compatibilidade, migrar dados, trocar a aplicação e remover o legado somente em release posterior.

### 7.4 Migrations

- `synchronize` permanece `false` em todos os ambientes.
- A role de runtime não possui permissão DDL.
- A role de migration é usada somente pelo release job.
- Migrations longas informam timeout, lock e estratégia de manutenção.
- Cada migration deve ser testada contra um snapshot do schema atual e contra dados representativos.
- O pipeline executa migrations duas vezes para comprovar que não há trabalho pendente após a primeira execução.
- Antes de uma migration destrutiva ou de alto risco, o ambiente deve possuir backup verificável.
- Produção não usa `migration:revert` como mecanismo de rollback.

## 8. Segurança de aplicação

### 8.1 Configuração, headers e transporte

**SEC-01.** O processo falha ao iniciar se faltar qualquer segredo ou URL crítica.

**SEC-02.** O backend aceita somente HTTPS em produção e define HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy`, `frame-ancestors 'none'` e proteção contra MIME sniffing.

**SEC-03.** O backend limita tamanho de body, tempo de requisição, duração de SSE, número de conexões e profundidade de fila. O limite de upload e de mensagem é definido por rota.

**SEC-04.** O CORS usa allowlist explícita por ambiente, permite apenas métodos e headers necessários e só usa `credentials: true` quando a origem estiver validada.

**SEC-05.** O `ai-api` não possui domínio público. O backend envia um token de serviço rotacionável ou uma assinatura com timestamp, audience e nonce. O `ai-api` rejeita chamadas sem autenticação válida.

### 8.2 Autenticação e sessão

**SEC-06.** O backend deixa de devolver refresh token para o JavaScript. Login, registro e refresh configuram cookie `HttpOnly`, `Secure` e com política `SameSite` compatível com o domínio escolhido.

**SEC-07.** O access token fica somente em memória no frontend. Ao recarregar a página, o frontend tenta refresh usando o cookie. Nenhum access ou refresh token pode aparecer em `localStorage`, `sessionStorage`, URL, query string, console ou analytics.

**SEC-08.** Refresh tokens são rotacionados, armazenados somente como hash e revogados no logout, troca de senha, detecção de reuse ou ação explícita de segurança.

**SEC-09.** Requisições autenticadas por cookie exigem proteção CSRF. Requisições mutáveis com bearer em memória também validam `Origin` quando a rota puder ser acionada por browser.

**SEC-10.** Login, registro, refresh, troca de credenciais e recuperação de acesso possuem rate limit por IP e identificador. Mensagens de falha não revelam se o usuário existe.

### 8.3 Dados e criptografia

“Criptografia para tudo” será implementada por classificação de dado, com controles específicos:

| Dado | Controle obrigatório | Nunca fazer |
|---|---|---|
| Senha | Hash forte, preferencialmente Argon2id; se bcrypt permanecer, custo mínimo validado por benchmark. | Armazenar ou criptografar para recuperar. |
| Refresh token | Hash com comparação segura e rotação. | Persistir o token bruto. |
| GitHub PAT e OpenAI key | AES-256-GCM com IV aleatório, tag de autenticação, versão de formato e chave fora do banco. | Enviar ao frontend, logar ou incluir em relatório. |
| Private key e webhook secret do GitHub App | Secret manager da Railway, com rotação e escopo por serviço. | Commitar, guardar em JSONB ou imprimir no deploy. |
| JWT signing secrets | Segredos aleatórios independentes, com tamanho mínimo e rotação planejada. | Reutilizar entre staging, production, MCP e `ai-api`. |
| Código, diffs, chat e relatórios | HTTPS, criptografia de storage/backups do provedor, RLS, retenção mínima e acesso por escopo. | Tratar conteúdo de repositório como público. |
| Logs e telemetria | Redaction, retenção curta e campos estruturais mínimos. | Guardar prompt, resposta completa, diff, cookie ou Authorization header. |
| Dados em trânsito | HTTPS público, SSL/TLS para Postgres/Redis/Neo4j e rede privada entre serviços. | Usar endpoints públicos para dependências internas. |

**SEC-11.** A criptografia de segredos recuperáveis ganha `keyVersion`, suporte a rotação e procedimento de re-encryption. A aplicação pode ler a versão anterior somente durante uma janela de migração controlada.

**SEC-12.** Chaves de criptografia nunca são derivadas de senha de usuário, nunca são armazenadas no banco e nunca entram em resposta HTTP.

**SEC-13.** Retenção é mínima: payloads de webhook, snapshots de contexto, mensagens e relatórios possuem política por tipo de dado, com exclusão e limpeza testadas.

### 8.4 Autorização e RLS

**SEC-14.** Toda consulta retorna somente dados autorizados pelo usuário, projeto, repositório, instalação ou caso público aplicável. O padrão de autorização é negar.

**SEC-15.** O runtime conecta com uma role sem `SUPERUSER`, sem `BYPASSRLS` e sem permissão de DDL. RLS é habilitado e forçado nas tabelas de negócio.

**SEC-16.** Uma requisição autenticada começa uma transação e executa:

```sql
SELECT set_config('app.user_id', '<verified-user-id>', true);
SELECT set_config('app.actor_type', 'user', true);
```

O segundo argumento de `set_config` vem do usuário verificado pelo guard, nunca do body ou do header enviado pelo cliente. O valor `true` faz o contexto desaparecer ao final da transação.

**SEC-17.** Jobs BullMQ carregam `actorUserId` e `projectId` explícitos. O worker cria o mesmo contexto transacional antes de ler ou alterar dados. Jobs sem dono humano só operam em tabelas e linhas públicas previamente autorizadas.

**SEC-18.** As policies cobrem `SELECT`, `INSERT`, `UPDATE` e `DELETE`, inclusive relações indiretas:

| Grupo | Regra de ownership |
|---|---|
| `users` | somente o próprio `id`; campos sensíveis continuam fora do select padrão |
| `projects` | `owner_id = app.user_id` |
| `project_repositories` | projeto pertence ao usuário atual |
| `analyses` e snapshots | `requested_by` pertence ao usuário atual |
| chat threads e messages | thread pertence ao usuário atual |
| feature cards e revisions | card pertence a projeto do usuário atual |
| architecture maps, versions, capabilities, components e boundaries | mapa pertence ao usuário atual |
| finding cases, occurrences e events | caso pertence ao usuário atual |
| benchmarks | casos curated são somente leitura; casos privados pertencem ao dono; runs seguem o caso |
| GitHub installations, repositories, deliveries e review runs | instalação/repositório pertence ao usuário vinculado |
| tabelas públicas de catálogo | somente linhas explicitamente marcadas como públicas |

**SEC-19.** O pipeline de segurança testa RLS com duas conexões e dois usuários: trocar apenas o `id` da URL nunca permite ler, atualizar ou excluir dados do outro usuário. O teste também executa queries diretas com a role de runtime, sem passar pelo service layer.

**SEC-20.** A autorização de serviço do MCP não substitui a autorização do usuário. O MCP valida o principal recebido, cria uma asserção interna assinada para o backend e nunca repassa o bearer token do cliente ao serviço downstream.

### 8.5 Logs, erros e telemetria

**SEC-21.** Logs carregam request ID, rota normalizada, status, duração, resultado e identificador interno do ator quando necessário. Não carregam body, query sensível, cookie, Authorization, PAT, API key, prompt ou conteúdo de código.

**SEC-22.** O interceptor de logging aplica redaction centralizada também a exceptions, objetos aninhados e erros vindos de GitHub/OpenAI. Stack trace pode ser registrado somente depois de sanitizado.

**SEC-23.** Erros externos são convertidos em mensagens genéricas para o cliente. Detalhes internos ficam somente no log redigido.

**SEC-24.** Audit logs registram ator, ação, recurso, resultado, request ID, origem e duração. Conteúdo bruto é substituído por contagem, hash ou referência a snapshot autorizado.

## 9. Proteção do frontend

**FRONT-01.** O bundle não contém segredos, tokens, headers de serviço, URLs privadas, credenciais de integração ou conteúdo recebido de outro usuário sem autorização.

**FRONT-02.** O CI inspeciona `dist` e assets source map por padrões de segredo e falha se encontrar material sensível.

**FRONT-03.** A sessão usa access token em memória e refresh cookie `HttpOnly`. PAT do GitHub e API key da OpenAI são enviados somente em requisição protegida ao backend e não são persistidos no browser.

**FRONT-04.** O frontend não registra tokens, respostas completas, conteúdo de prompts ou diffs no console, URL, storage, analytics ou mensagens de erro.

**FRONT-05.** O renderer Markdown não interpreta HTML e aceita somente URLs `https:`, `http:` ou rotas relativas permitidas. Protocolos como `javascript:`, `data:` e `vbscript:` são rejeitados. Links externos usam `rel="noreferrer noopener"`.

**FRONT-06.** A Vercel publica headers de segurança e uma CSP compatível com o bundle. `unsafe-eval` é proibido; `unsafe-inline` só pode existir se houver justificativa documentada e escopo reduzido.

**FRONT-07.** Source maps de produção são privados ou desabilitados. Assets são servidos com cache coerente e sem incluir dados de usuário em HTML estático.

**FRONT-08.** A API usa DTOs de resposta com allowlist. O objeto `User` nunca inclui senha, hash de refresh, token criptografado, chave bruta ou qualquer segredo recuperável.

## 10. Cast MCP

### 10.1 Serviço e transporte

O MCP será um serviço separado em Railway, com um único endpoint de transporte remoto compatível com MCP Streamable HTTP. O endpoint aceita somente HTTPS, valida `Origin` e `Host`, rejeita origens não permitidas e aplica autenticação em toda requisição. O modo stdio ficará disponível para desenvolvimento local e deverá escrever somente mensagens MCP válidas em stdout; logs vão para stderr.

O MCP não acessa Postgres, Redis, Neo4j ou GitHub diretamente. Ele chama o backend por rede privada e usa contratos internos versionados.

### 10.2 Autorização

**MCP-01.** A conexão HTTP exige token válido com issuer, audience/resource, escopo, expiração e sujeito verificáveis. Token em query string é proibido.

**MCP-02.** O fluxo remoto usa OAuth 2.1 com PKCE para usuário humano. Credenciais de máquina usam client credentials, com escopos próprios e audience específica do MCP.

**MCP-03.** Tokens são curtos, revogáveis e não são gravados em logs. Refresh tokens, quando existirem, são rotacionados e protegidos.

**MCP-04.** O servidor cria um contexto de execução com `userId`, workspace/projeto permitido, escopos, request ID e quota. Cada ferramenta verifica autorização novamente.

**MCP-05.** Um token destinado ao MCP nunca é encaminhado ao backend. A comunicação MCP → backend usa credencial de serviço e uma asserção interna assinada, com timestamp, nonce, audience e principal validado.

### 10.3 Ferramentas v1

| Ferramenta | Escopo | Efeito |
|---|---|---|
| `search_docs` | projeto ou repositório autorizado | leitura |
| `find_symbol` | projeto ou repositório autorizado | leitura |
| `open_source` | path, símbolo e SHA autorizados | leitura |
| `get_pr_context` | PR e repositório autorizado | leitura |
| `trace_dependency` | grafo autorizado, profundidade limitada | leitura |
| `blast_radius` | PR, símbolo ou endpoint autorizado | leitura |
| `compare_architecture` | dois snapshots autorizados | leitura |
| `get_review` | análise autorizada | leitura |
| `start_review` | PR autorizada, quota disponível | inicia trabalho custoso; sem escrita no GitHub |

As ferramentas não aceitam query Cypher, SQL, shell, URL arbitrária, path fora do índice, PAT, API key ou prompt livre com privilégio administrativo.

Cada schema exige escopo explícito, limite de itens, profundidade máxima, teto de caracteres e, quando aplicável, SHA ou número da PR. O servidor ignora qualquer tentativa do cliente de ampliar o projeto ou repositório autorizado.

### 10.4 Contrato de resposta

Toda resposta que contiver código, documento, símbolo ou relação inclui procedência:

```json
{
  "items": [],
  "citations": [
    {
      "repoId": "owner/repo",
      "path": "src/example.ts",
      "line": 42,
      "sha": "..."
    }
  ],
  "scope": { "projectId": "...", "repositories": ["owner/repo"] },
  "truncated": false,
  "omissions": [],
  "dataClassification": "repository-content"
}
```

O truncamento é determinístico e informa o que ficou de fora. Conteúdo do repositório é tratado como dado não confiável: instruções presentes em README, comentários ou código não podem alterar permissões, revelar segredos ou virar instrução do sistema.

### 10.5 Operação do MCP

- rate limit por token, usuário, projeto e ferramenta;
- limite de concorrência e orçamento para `start_review`;
- timeout por ferramenta e cancelamento de jobs longos;
- idempotency key para iniciar a mesma análise;
- audit log com ferramenta, escopo, resultado, contagens, latência e custo;
- nenhum log com argumentos brutos que possam conter código ou dados pessoais;
- health check sem informação de infraestrutura;
- versionamento de nomes e schemas; remoção de ferramenta exige período de compatibilidade.

## 11. Testes E2E e validações de segurança

Os testes usam Postgres, Redis, Neo4j e providers de GitHub/LLM fake. Nenhum teste de CI usa PAT real, OpenAI key real, webhook secret real ou dados de produção.

### 11.1 Jornada principal

1. Registrar usuário, fazer login e obter sessão.
2. Recarregar a página e renovar sessão sem expor token ao JavaScript persistente.
3. Criar projeto e adicionar repositório fake.
4. Indexar fixture, consultar grafo e abrir uma PR fake.
5. Executar análise por SSE, persistir relatório e recuperar histórico.
6. Abrir chat, receber citações e criar Feature Card.
7. Conectar cliente MCP, listar ferramentas e executar `search_docs`, `blast_radius` e `get_review`.
8. Executar `start_review`, acompanhar status e receber o resultado auditável.

### 11.2 Cenários negativos obrigatórios

| Cenário | Resultado esperado |
|---|---|
| usuário A acessa projeto, análise, thread ou card de B | `404` ou `403` conforme o contrato, sem existência ou conteúdo de B |
| query direta na role runtime sem `app.user_id` | nenhum dado privado |
| usuário troca `projectId`, `repoId`, `analysisId` ou `threadId` | autorização continua baseada no contexto verificado |
| origem não permitida faz request com credencial | CORS/requisição rejeitada |
| POST mutável sem CSRF válido | rejeitado |
| Markdown contém `javascript:`, HTML ou payload XSS | conteúdo inerte e URL removida |
| login/refresh excede limite | `429`, sem revelar dados de conta |
| body, SSE ou tool result excede limite | truncamento/rejeição controlada |
| assinatura de webhook inválida ou redelivery | rejeição e idempotência sem execução duplicada |
| `ai-api` é chamado fora da rede ou sem credencial | rejeitado |
| MCP sem token, token expirado ou audience errada | `401` |
| MCP pede projeto fora do grant | `403`, sem dados parciais |
| MCP tenta Cypher, shell, URL ou path arbitrário | schema/allowlist rejeita |
| log contém secret, cookie, prompt ou diff | teste de redaction falha o pipeline |
| migration falha | release não troca a versão ativa |

### 11.3 DAST e regressão

Após o deploy de staging, executar smoke tests, DAST baseline, testes de headers, CORS, rate limit, cookies, TLS e endpoints públicos. A execução deve guardar como artefato o relatório sem payloads sensíveis.

## 12. Observabilidade operacional

O sistema deve expor métricas e logs estruturados para:

- taxa de 4xx, 5xx, 401, 403 e 429 por rota;
- latência p50/p95 por rota e ferramenta MCP;
- falhas de login, refresh reuse, CSRF, RLS e autenticação de serviço;
- profundidade e idade das filas;
- duração e erro de migration;
- custo, tokens e duração de análise sem conteúdo de prompt ou resposta;
- status do `ai-api`, Postgres, Redis, Neo4j e MCP.

Alertas iniciais devem cobrir aumento de 5xx, falhas repetidas de auth, refresh reuse, falhas de webhook, fila parada, falhas de migration e indisponibilidade de dependências.

## 13. Critérios de aceite

Esta SPEC será considerada implementada quando:

1. PRs sem todos os gates obrigatórios não puderem entrar em `main`.
2. O mesmo artefato de commit puder ser promovido de staging para produção.
3. Migrations rodarem em release controlado, com schema compatível e rollback da aplicação demonstrado.
4. Banco, Redis, Neo4j e `ai-api` não possuírem exposição pública desnecessária.
5. Nenhum token ou segredo ficar em `localStorage`, `sessionStorage`, URL, bundle, log, telemetria ou resposta de usuário.
6. Dois usuários não conseguirem atravessar autorização pelo backend ou por query direta com RLS.
7. O teste E2E principal e todos os cenários negativos desta SPEC passarem.
8. O MCP exigir autenticação, respeitar escopos, retornar citações e rejeitar operações fora da allowlist.
9. Um relatório de segurança versionado registrar findings, exceções, decisões e riscos residuais.
10. Um rollback de aplicação e um procedimento de rotação de segredo forem executados em staging.

## 14. Ordem recomendada de execução

### Fase 0 — Baseline e contratos

Inventariar endpoints, entidades, segredos, variáveis, portas públicas, logs, dependências e permissões. Criar fixtures de E2E e o relatório de baseline.

### Fase 1 — CI/CD e artefatos

Criar workflows, gates de qualidade, scans, builds imutáveis, schema compatibility check, registry e ambientes Railway/Vercel separados.

### Fase 2 — Segurança de runtime e frontend

Corrigir CORS, headers, body limits, rate limits distribuídos, redaction, service auth, cookies, sessão em memória, CSP, Markdown e auditoria de bundle.

### Fase 3 — Banco e dados

Criar roles, SSL, RLS, contexto transacional, policies, testes de isolamento, retenção e rotação de chaves.

### Fase 4 — Deploy e E2E

Subir staging, rodar migrations, smoke, E2E, DAST, rollback e validação de health/readiness. Promover para produção somente após os critérios de aceite.

### Fase 5 — MCP

Implementar adapter MCP, autenticação HTTP, grants, ferramentas read-only, contratos de citação, limites, audit logs e testes com clientes compatíveis. `start_review` entra depois das ferramentas de leitura passarem todos os gates.

## 15. Decisões a confirmar antes da execução

- domínio próprio compartilhando o mesmo site entre Vercel, API e MCP, ou domínios separados;
- política final de `SameSite` e CSRF conforme o domínio escolhido;
- provedor e topologia de Neo4j em produção;
- identidade OAuth do MCP e método de vinculação com o usuário do Cast;
- retenção final de código, chat, snapshots, webhooks e audit logs;
- limite inicial de custo, concorrência e tamanho de contexto por usuário e projeto.

## 16. Referências

- [Architecture do frontend](../ARCHITECTURE-frontend.md)
- [Architecture do backend](../ARCHITECTURE-backend.md)
- [PRD do Cast MCP](./../feature-cast-mcp/PRD.md)
- [Operação da GitHub App](../feature-github-app-automatic-review/DEPLOY.md)
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization)
- [MCP transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [Railway health checks](https://docs.railway.com/deployments/healthchecks)
- [Railway private networking](https://docs.railway.com/guides/docker-compose)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Vercel deployment protection](https://vercel.com/docs/deployment-protection)
