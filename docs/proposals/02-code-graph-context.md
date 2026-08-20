# PRD 02 — Code Graph / Repo Map: contexto por blast radius

**Status:** Proposta
**Prioridade:** 2
**Área:** `apps/backend` (Context Builder) + novo módulo de indexação
**Esforço:** M/G (~5–8 dias)

---

## Problema

O PRD principal diz que revisar só o diff é a limitação que o Cast Review existe pra resolver. A implementação atual resolve pela metade:

`apps/backend/src/modules/analyses/helpers/import-resolver.helper.ts` extrai imports com **regex**, só imports **relativos**, só de **JS/TS**, e para em **3 arquivos por arquivo alterado** (`MAX_RELATED_FILES_PER_CHANGE`). Consequências concretas:

- import por alias (`src/...`, `@app/...`, path mapping do tsconfig) → ignorado;
- **quem chama** a função alterada → nunca entra no contexto (o grafo só olha pra frente, nunca pra trás);
- Python/Go/qualquer outra linguagem → zero contexto relacionado;
- os 3 arquivos são os 3 **primeiros** do arquivo, não os 3 mais **relevantes**;
- `MAX_RELATED_FILE_CHARS = 4000` corta no meio do arquivo, podendo entregar meia função.

Ou seja: o reviewer não vê os callers da função que a PR mudou. É a causa raiz de falso positivo ("essa validação não é feita em lugar nenhum" — é, no caller) e de falso negativo ("mudou a assinatura e não quebrou nada" — quebrou 4 callers).

## Objetivo

Substituir o resolvedor por regex por um **índice estrutural do repositório**: parse com tree-sitter, grafo de símbolos (define/referencia), ranking por PageRank e seleção do contexto dentro de um **orçamento de tokens** — servindo ao agente apenas o *blast radius* da mudança.

## Por que é bom pro portfólio

É o padrão de 2026: precomputar estrutura, expor como consulta, e deixar o agente pedir fatos estreitos em vez de queimar contexto lendo arquivo inteiro. Estudos de 2026 reportam ~10x menos tokens e ~2x menos tool calls com índice tree-sitter exposto via grafo; a compressão só de assinaturas corta ~70% dos tokens preservando estrutura. É a feature que mostra **context engineering**, que é o que substituiu prompt engineering como disciplina crítica.

Além disso: é o "Knowledge Graph / GitNexus" que o PRD original já colocou no roadmap pós-MVP. Entregar isso fecha a promessa arquitetural do projeto.

---

## Escopo

**Dentro:**
- Indexação com tree-sitter de TS/JS + Python (2 linguagens, bem feitas).
- Grafo de símbolos: nós = arquivo e símbolo; arestas = `defines`, `references`, `imports`, `tests`.
- Ranking dos vizinhos por PageRank personalizado, com peso maior nos arquivos alterados pela PR.
- Seleção sob orçamento de tokens, entregando **assinatura** por padrão e corpo completo só pro topo do ranking.
- Cache do índice por `repo@sha`, com invalidação incremental por arquivo alterado.
- Novo bloco no payload: `relatedContext` com `callers`, `callees`, `tests`, `signatures`.

**Fora:**
- Embeddings / busca vetorial. O grafo resolve o problema aqui e é determinístico — decisão consciente, vale documentar.
- Call graph interprocedural completo, análise de tipos, resolução dinâmica.
- Linguagens além de TS/JS/Python no v1.

---

## Design técnico

### Onde mora

Índice é CPU-bound e depende de parser nativo → mora no **Python** (`apps/ai-api`), que já é o serviço de IA, ou num módulo Nest chamando `web-tree-sitter`. Recomendação: **Python**, com `tree-sitter` + `tree-sitter-language-pack`, e um endpoint novo:

```
POST /index/build   { repoId, sha, files: [{path, content}] }  -> { indexId, stats }
POST /index/context { indexId, changedFiles, tokenBudget }     -> { relatedContext }
```

Motivo da fronteira: o Nest continua dono do GitHub (buscar arquivos, auth); o Python continua dono de tudo que é análise. Coerente com a decisão de arquitetura já documentada — o Python não ganha conhecimento de GitHub, ele recebe conteúdo pronto.

Alternativa mais barata pro v1: rodar a indexação **dentro do run**, sem endpoint separado, apenas sobre os arquivos que o Nest já busca hoje + os vizinhos de 1 salto. Menos escalável, muito menos código. Sugerido como fase 1.

### Modelo do grafo

```
Node:  { id, kind: file|function|class|method, path, name, line, endLine, signature }
Edge:  { from, to, kind: defines|references|imports|tests }
```

Extração por linguagem via queries do tree-sitter (`*.scm`), não por regex:
- TS/JS: `function_declaration`, `class_declaration`, `method_definition`, `call_expression`, `import_statement`, `import` dinâmico, `require`.
- Python: `function_definition`, `class_definition`, `call`, `import_statement`, `import_from_statement`.

Resolução de import: relativo (já funciona) + alias lido de `tsconfig.json#compilerOptions.paths` e `pyproject/setup.cfg`, + resolução por nome de símbolo quando o path falha (fallback: símbolo único no repo → resolve).

Detecção de teste: arquivo casando `**/*.spec.*`, `**/*.test.*`, `**/tests/**`, `test_*.py` que referencie símbolo definido em arquivo alterado → aresta `tests`. Isso alimenta direto a regra 2 do PRD (test reviewer mapeia `businessRule` → teste) e é **muito** melhor que o `analysis["hasTests"]` booleano de hoje em `nodes/change_analyzer`.

### Ranking (PageRank personalizado)

1. Vetor de personalização: peso 1.0 nos arquivos alterados pela PR, 0 no resto.
2. PageRank sobre o grafo com arestas bidirecionais ponderadas: `references` inversa (caller → alterado) pesa **mais** que `imports` direta, porque caller é o que falta hoje.
3. Ordena candidatos por score; corta por orçamento.

### Orçamento de tokens

```
tokenBudget (default 8_000)
  ├─ 60% arquivos alterados (fullContent, já existe)
  ├─ 30% top-N vizinhos: corpo completo dos 3 primeiros
  └─ 10% cauda: só assinaturas (repo map estilo aider)
```

Corte por **símbolo**, nunca por caractere — resolve o `slice(0, 4000)` que hoje entrega função pela metade.

### Impacto no payload

`ChangedFileContext.relatedFiles` (hoje `{path, content}`) ganha companhia:

```ts
interface RelatedContext {
  callers: SymbolRef[];      // quem chama o que mudou
  callees: SymbolRef[];
  tests: SymbolRef[];        // testes que tocam o símbolo alterado
  repoMap: string;           // assinaturas rankeadas, texto compacto
  stats: { indexedFiles: number; budgetUsed: number; truncated: boolean };
}
```

Os prompts (`graph/utils/files.py::files_block`) passam a receber `repoMap` + callers explícitos. `MAX_PROMPT_TOTAL_CHARS` sai de "corte cego" pra "orçamento gerenciado".

## Regras de negócio

1. Contexto é **determinístico**: mesmo repo@sha + mesmo diff → mesmo contexto. Sem LLM na seleção.
2. Nenhum símbolo entra cortado no meio. Se não cabe no orçamento, entra só a assinatura.
3. Se a indexação falhar (linguagem não suportada, parse error), o sistema **degrada** para o resolvedor por regex atual, não quebra a review. `stats.truncated`/`indexedFiles` reportam isso na UI.
4. Índice é cacheado por `repo@sha`; PR nova no mesmo repo reindexa só os arquivos com hash diferente.

## Métricas de sucesso

Medidas **pelo eval do PRD 01** (por isso ele vem antes):

| Métrica | Antes (regex) | Meta |
|---|---|---|
| `false_positive_rate` | baseline | −30% relativo |
| `rule_recall` | baseline | +10% relativo |
| tokens de prompt por review | baseline | ≤ baseline (mais sinal, não mais volume) |
| casos com caller relevante presente no contexto | ~0% | ≥ 80% |

"Reduzi falso positivo em 30% trocando regex por grafo de símbolos, e provei com eval" é uma frase de entrevista que vale o projeto inteiro.

## Riscos

| Risco | Mitigação |
|---|---|
| Indexar repo grande estoura tempo/memória | Indexa só o subgrafo alcançável a ≤2 saltos dos arquivos alterados; limite de arquivos configurável |
| tree-sitter como dependência nativa complica o setup local | `tree-sitter-language-pack` traz binários pré-compilados; fallback documentado |
| Complexidade não justificada pro MVP | Fase 1 (1 salto, sem PageRank, sem cache) já entrega valor e cabe em 2 dias |

## Plano incremental

1. **Fase 1** — tree-sitter substitui o regex na extração de imports; adiciona callers a 1 salto. Sem grafo persistido.
2. **Fase 2** — grafo completo + PageRank + orçamento de token + repo map de assinaturas.
3. **Fase 3** — cache por `repo@sha` + invalidação incremental + `stats` na UI.
4. **Fase 4** — expõe o grafo como tool (casa com o [PRD 06 — MCP](./06-mcp-server.md)).
