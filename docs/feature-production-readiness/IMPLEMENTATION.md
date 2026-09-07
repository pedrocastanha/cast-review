# Estado da implementação

Data: 2026-09-06. Implementação parcial; não liberar produção usando este documento como aprovação de segurança. Sem commits e sem publicação remota.

## Entregue localmente

- Refresh em cookie HttpOnly/Secure/SameSite Strict; access token em memória; limpeza dos tokens antigos do localStorage.
- Refresh com identificador aleatório, digest SHA-256 completo e consumo condicional no banco para impedir uso concorrente do mesmo token. Sessões antigas exigem novo login. Ainda falta modelar famílias de sessões e revogação completa por reuse.
- CORS explícito, proteção de origem e header obrigatório nas rotas de sessão, headers de segurança e erros 5xx genéricos em produção.
- Guard de throttling global, limites menores nas rotas de autenticação e contador Redis atômico em produção.
- Autenticação backend → ai-api com segredo de serviço, falha fechada em produção, timeout e proibição de redirects no cliente interno. Documentação HTTP do ai-api desabilitada.
- Redaction de logs Winston, remoção de query strings dos registros e filtros para credenciais e payloads aninhados.
- URLs Markdown limitadas a HTTP/HTTPS ou caminhos relativos seguros.
- AES-256-GCM com key ID, leitura de v1 e v2, AAD em v2 e testes de adulteração. Re-encryption operacional em lote ainda pendente.
- Dockerfiles com usuário sem privilégios e contexto sem arquivos de ambiente.
- Runner de migrations compiladas com credencial separada e advisory lock; duas execuções verificadas em banco isolado.
- Workflows de qualidade, migrations, CodeQL, auditoria Node/Python e scan de segredos em histórico e bundle. Os workflows ainda não foram executados pelo GitHub nem configurados como checks obrigatórios.
- Configuração de headers Vercel e gerador de rewrites em `apps/frontend/scripts/configure-vercel.mjs`, dependente de PUBLIC_API_ORIGIN.
- Correções mecânicas de formatação/imports no backend para desbloquear o lint preexistente. Avisos de lint permanecem.

## Validação realizada

- Backend: build e 399 testes unitários passaram.
- Python: 329 testes passaram também após atualização de FastAPI, Starlette, LangGraph, checkpoint Redis e pytest.
- Frontend: build, lint e 33 testes passaram.
- Integração Redis: 3 testes passaram, incluindo concorrência entre instâncias.
- Feature Cards HTTP/Postgres: 5 testes passaram em banco isolado.
- Sessão HTTP: 4 testes passaram, incluindo cookie, CSRF e origem em rotas com variações de caixa/barra final. O serviço de autenticação é substituído; isso não equivale ao E2E completo de login com banco e browser.
- Imagem backend construída localmente. A imagem deve ser reconstruída depois de alterações posteriores no código.
- Auditoria Node após atualização compatível: zero vulnerabilidades reportadas.
- Auditoria Python: 13 vulnerabilidades iniciais em 5 pacotes; após atualização das dependências e nova execução do pip-audit, nenhuma vulnerabilidade conhecida reportada.
- Histórico Git: 224 commits examinados. Bundle: aproximadamente 757 KB examinados; scanner não detectou segredos. Isso não prova ausência de dados sensíveis em todas as respostas de runtime.

## Triagem do scanner de segredos

`.gitleaksignore` contém somente três fingerprints históricos. Duas ocorrências são uma fixture de 17 caracteres no teste `user.service.openai.spec.ts`, commit `54ca1643d71d6dd82e4a0475087971d116164fc9`. A terceira é o token de badge CircleCI do template NestJS em README, commit `a9872d1091895f425852affa66a48040a841c6a8`. Nenhum path inteiro ou regra inteira foi ignorado. Reavaliar essas exceções até 2026-10-06; responsável: mantenedor do Cast.

## Pendências obrigatórias

1. RLS completo, roles de runtime/migration, bootstrap de autenticação, contexto transacional e adaptação dos workers. Não há migration ativando RLS nesta entrega.
2. Isolamento de conteúdo no Neo4j, cache e checkpoints Redis; revalidação de permissão GitHub e de snapshots históricos.
3. Servidor MCP e integração OAuth, grants, asserção interna, ferramentas e testes. Nenhum servidor MCP foi criado nesta entrega.
4. E2E completo em browser, DAST, scans de imagem/IaC, SBOM, assinatura e promoção do mesmo artefato.
5. Configuração efetiva de Railway/Vercel, domínios, rede privada, TLS de dependências, proxy confiável e checks obrigatórios no GitHub.
6. Quotas de custo e concorrência por usuário/projeto, rate limit por identificador de conta, limites de SSE e comportamento de desconexão/retry.
7. Retenção, backups, restore, re-encryption, rotação operacional, trilha de auditoria persistente e alertas.
8. Auditoria completa de DTOs, exports, mensagens SSE, imagens externas, logs Python e conteúdo enviado ao LLM.
9. Lock completo de dependências Python e lint/typecheck Python. As dependências diretas estão fixadas e as vulnerabilidades conhecidas encontradas foram resolvidas.

## Bloqueios externos verificados

Railway CLI: OAuth expirado (`invalid_grant`) e nenhum projeto vinculado. Precisa de login e vínculo com o ambiente correto; não compartilhar segredos no chat.

Vercel CLI autenticada; projeto/domínios do Cast ainda não definidos nesta sessão. A URL relativa `/api` exige rewrite configurado antes de publicar. Cookies Strict pressupõem navegação pelo mesmo site/proxy; validar os domínios finais antes do rollout.

## Comandos operacionais preparados

Após build do backend, `MIGRATION_DATABASE_URL` permite executar `node scripts/migrate.cjs` com o usuário de migrations. A credencial não deve ser concedida ao runtime normal. O runner não fornece rollback destrutivo.

No frontend, definir `PUBLIC_API_ORIGIN` e executar `node scripts/configure-vercel.mjs` gera rewrites HTTPS; revisar o arquivo gerado antes da publicação.

`SECRET_ENCRYPTION_KEY` permite ler v1. Para novas gravações v2, configurar `SECRET_ENCRYPTION_ACTIVE_KEY` e `SECRET_ENCRYPTION_KEYS` como mapa JSON de IDs para chaves hexadecimais de 32 bytes. Manter as chaves anteriores enquanto existirem dados cifrados por elas. Nunca guardar esses valores no Git.
