# TASKS — Cast Code como cliente oficial do Cast Review

**Spec:** [SPEC.md](./SPEC.md)  
**Status:** Em execução  
**Método:** TDD; testes de contrato ficam imutáveis durante GREEN  
**MCP:** fora de escopo

## Gates

| Área | Quick | Full |
| --- | --- | --- |
| `cast-code` | `npm test -- <spec>` | `npm run typecheck && npm test && npm run build` |
| backend | `npm test -- <spec>` | `npm run lint && npm test && npm run build && npm run test:e2e` |
| frontend/ai-api | — | sem mudança funcional prevista |

## Sequência

```text
T1 docs/contrato
 ├─ T2 manifesto genérico ─ T3 retirar Platform
 ├─ T4 backend instance
 └─ T5 config/credencial ─ T6 HTTP/SSE ─ T7 comandos ─ T8 REPL
                                      T4 ───────────────┘
T3 + T7 + T8 ─ T9 E2E/smoke ─ T10 docs/memórias
```

## T1 — Corrigir PRD/SPEC/TASKS para o novo padrão

**Requisitos:** CR-01..CR-13  
**Done:** Cast Review é a única integração remota; Platform aposentado; auth reutiliza JWT/refresh; MCP fora.

## T2 — Extrair `ProjectManifestService`

**Arquivos:** novo service + spec; `project.module.ts`; environment activation/module/spec.  
**Requisitos:** CR-02, CR-11  
**Testes RED:** leitura ausente/inválida, merge preservando `project` e `castReview`, escrita atômica/permissões, environment round-trip.  
**Done:** nenhum ambiente depende de `PlatformConfigService`.

## T3 — Aposentar Platform sem quebrar recursos locais

**Arquivos:** App/Core/Repl/Memory/Benchmark/Scheduler/Runtime; módulo/specs legados.  
**Requisitos:** CR-10, CR-11, CR-12

- retirar bootstrap/config/cache/telemetria/RAG/definições remotas;
- retirar benchmark/schedule sync, mantendo execução/relatórios/store;
- retirar runtime telemetry projector sem consumidores;
- manter `platform_project_id` nullable;
- deixar tombstones claros para comandos antigos.

**Gate:** typecheck + testes tocados.

## T4 — Publicar `frontendUrl` no contrato de instância

**Arquivos:** backend `app.controller.ts` + spec.  
**Requisitos:** CR-03  
**Testes RED:** env explícita, fallback da primeira origin, sem derivar de header do cliente.  
**Done:** CLI satisfaz CSRF sem relaxar middleware.

## T5 — Config e store de credencial

**Arquivos:** config types/manager/specs; módulo `cast-review`; manifesto.  
**Requisitos:** CR-01..CR-06  
**Testes RED:** precedência/HTTPS, YAML, origin isolation, `0700/0600`, rotação, remoção e redaction.  
**Done:** senha não persiste; refresh fica no store; Platform config não é usada.

## T6 — Cliente HTTP/SSE

**Arquivos:** client/types/specs.  
**Requisitos:** CR-03..CR-09  
**Testes RED:** login headers/cookie, profile, refresh único, cookie rotacionado, logout, thread/get, SSE fragmentado/CRLF/eventos/abort/erro.  
**Done:** contrato existente sem serviço interno.

## T7 — Comandos diretos e repo

**Arquivos:** `main.ts`, repository/session/commands/specs, AppModule.  
**Requisitos:** CR-01, CR-06..CR-08, CR-12  
**Testes RED:** configure/login/status/logout/link/chat, flags, SSH/HTTPS GitHub, fallback global, exit codes e tombstones.  
**Done:** `cast review` funciona com servidor fake; senha não é argv.

## T8 — REPL `/cast-review`

**Arquivos:** repl module/service/help/suggestions/specs.  
**Requisitos:** CR-06..CR-08, CR-10..CR-12  
**Testes RED:** dispatch/status/chat/logout, cancelamento, `/review`, Platform ausente da ajuda e tombstone.  
**Done:** prompt normal não pede login, não conversa e não envia telemetria ao Cast Review.

## T9 — E2E automatizado e smoke real

**Arquivos:** backend E2E, `scripts/smoke-cast-review.mjs`, package script/relatório.  
**Requisitos:** CR-04, CR-07..CR-09, CR-13  
**Automatizado:** backend real + AI fake + store isolado cobre login/rotação/thread/SSE/persistência/logout/RLS.  
**Real:** stack completa, conta normal, credenciais salvas, repo indexado e binário real; exige `message_done` e persistência. Prova do grafo exige tool call/result e citação.

Blockers aceitáveis só após tentativa: conta/segredo externo ausente, GitHub sem acesso ou OpenAI sem crédito. Separar falha de ambiente e código.

## T10 — Documentação, memórias e explicação

**Arquivos:** README, docs, `MEMORY.md` dos módulos e `explanations/`.  
**Requisitos:** CR-10..CR-13  
**Done:** setup reproduzível, docs atuais não ensinam Platform, MCP adiado e walkthrough técnico.

## Traceability

| Critério | Tasks |
| --- | --- |
| CR-01, CR-02 | T2, T5, T7 |
| CR-03..CR-06 | T4, T5, T6, T7 |
| CR-07..CR-09 | T6, T7, T8, T9 |
| CR-10..CR-12 | T2, T3, T7, T8, T10 |
| CR-13, CR-14 | T3, T8, T9, T10 |

## Regras de execução

- Não alterar teste RED para fazê-lo passar sem mudar a SPEC deliberadamente.
- Não registrar segredos em argv, fixture, log, commit ou output.
- Não apagar dados/volumes/config do usuário.
- Não substituir `HOME` em smoke; injetar caminho temporário.
- Não criar servidor MCP nesta iniciativa.
