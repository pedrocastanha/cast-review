# PRD 06 — Servidor MCP: Cast Review como ferramenta de outros agentes

**Status:** Proposta
**Prioridade:** 6
**Área:** novo `apps/mcp-server` (ou rota no `apps/backend`)
**Esforço:** P (~2–3 dias)

---

## Problema

O Cast Review só é acessível pela própria UI. Mas o lugar onde o desenvolvedor está em 2026 é dentro do agente de código (Claude Code, Cursor, Copilot). Pedir "revisa minha PR" ali e receber o relatório do Cast Review é o uso natural do produto — e hoje é impossível.

## Objetivo

Expor o Cast Review como **servidor MCP**, com tools tipadas que qualquer cliente MCP pode chamar, reusando a API do Nest (auth, GitHub, orquestração) sem duplicar lógica.

## Por que é bom pro portfólio

MCP virou o protocolo padrão de integração de agentes, e "integração MCP" aparece explicitamente nas listas de skills que substituíram os requisitos antigos de currículo. Um servidor MCP bem feito mostra três coisas de uma vez: desenho de contrato de tool (que é desenho de API para consumo por LLM, não por humano), escopo de permissão, e entendimento de que ferramenta de agente devolve **fato estreito**, não dump de arquivo.

O ponto mais forte: se o [PRD 02](./02-code-graph-context.md) existir, o servidor MCP expõe o **grafo de código** como tool — que é exatamente o padrão de 2026 (precomputar estrutura, servir consulta estreita, reduzir blast radius do que o agente vê).

---

## Escopo

**Dentro:**
- Servidor MCP em TypeScript (`@modelcontextprotocol/sdk`), transporte stdio + HTTP streamable.
- Tools de review e de consulta ao histórico.
- Resources para relatórios já gerados.
- Autenticação por token do próprio Cast Review, sem trafegar PAT do GitHub.
- README com o bloco de config pronto pra colar no cliente MCP.

**Fora:**
- Publicar no registro público de servidores MCP.
- Sampling / elicitation.
- OAuth (usa token do app, coerente com o MVP).

---

## Tools

| Tool | Input | Output | Nota de desenho |
|---|---|---|---|
| `list_repositories` | `{ query?, limit? }` | repos do usuário | wrapper de `RepositoriesService` |
| `list_pull_requests` | `{ repo, owner?, state? }` | PRs abertas | idem |
| `review_pull_request` | `{ repo, pullNumber, owner?, models?, publishPolicy? }` | `{ analysisId, verdict, overallScore, failCount, findings[], costUsd }` | long-running → devolve `analysisId` na hora e o cliente faz poll com `get_analysis` |
| `get_analysis` | `{ analysisId }` | status + report | permite acompanhar sem segurar conexão |
| `list_analyses` | `{ repo?, pullNumber?, limit? }` | histórico | reusa `listForRepository` |
| `explain_finding` | `{ analysisId, findingIndex }` | detalhe + trecho de código ancorado | resposta estreita, não o report inteiro |
| `get_code_context` | `{ repo, symbol \| path, hops? }` | callers/callees/testes/assinaturas | **só com o [PRD 02](./02-code-graph-context.md)**; é a tool mais valiosa da lista |

Princípios de desenho das tools (vale escrever no README, é o que mostra maturidade):
1. **Output cabe no contexto**: nada de devolver markdown de 10k tokens; `review_pull_request` devolve sumário + findings, e o markdown completo fica como *resource* linkado.
2. **Descrição de tool é prompt**: cada `description` diz quando **não** usar a tool, não só quando usar.
3. **Erro é acionável**: "PAT sem escopo `repo`" em vez de "401".
4. **Nada destrutivo sem confirmação**: `review_pull_request` com `publishPolicy: manual` por padrão — o agente não comenta na PR de ninguém sozinho (casa com o [PRD 05](./05-durable-runs-hitl.md)).

## Resources

- `castreview://analysis/{id}/report.md` — markdown completo do relatório.
- `castreview://analysis/{id}/spec.json` — Implementation Spec.
- `castreview://repo/{owner}/{repo}/conventions.md` — convenções resolvidas (repo ou default).

## Design técnico

O servidor MCP é **cliente HTTP do Nest**, não um segundo backend. Ele não fala com GitHub nem com o Python direto. Consequência: zero duplicação de auth/regra, e a fronteira arquitetural do projeto continua honesta.

```
apps/mcp-server/
  src/index.ts          # bootstrap, stdio + http
  src/tools/*.ts        # uma tool por arquivo, schema zod
  src/resources/*.ts
  src/client.ts         # cliente do Nest (reusa os tipos de shared/types.ts)
```

Auth: `CAST_REVIEW_TOKEN` (o JWT que o `auth.module` já emite) via env. O PAT do GitHub segue criptografado no banco (`secret-crypto.ts`) e **nunca** passa pelo MCP.

Config publicada no README:

```json
{
  "mcpServers": {
    "cast-review": {
      "command": "node",
      "args": ["apps/mcp-server/dist/index.js"],
      "env": { "CAST_REVIEW_URL": "http://localhost:3000", "CAST_REVIEW_TOKEN": "..." }
    }
  }
}
```

## Regras de negócio

1. Toda tool respeita o mesmo escopo de usuário da API (`requestedBy`), sem rota privilegiada.
2. `review_pull_request` é assíncrona por contrato — nunca segura a conexão do cliente MCP por 90s.
3. Escrita no GitHub via MCP exige `publishPolicy` explícito; default é não publicar.
4. Toda tool tem timeout e mensagem de erro em linguagem de agente.

## Métricas de sucesso

- GIF no README: pedir review dentro do Claude Code / Cursor e receber o veredito do Cast Review.
- Tokens médios por resposta de tool < 1.5k (mede a disciplina de output estreito).
- Zero credencial do GitHub trafegando pela camada MCP.

## Riscos

| Risco | Mitigação |
|---|---|
| Vira só um proxy sem substância | O valor está em `get_code_context` e `explain_finding` (respostas estreitas), não nos wrappers CRUD — priorizar essas duas |
| Agente externo disparando reviews caras em loop | Rate limit por token + custo máximo por run configurável |
| Spec MCP em evolução | Fixar versão do SDK; testar contra um cliente real, não só unitário |
