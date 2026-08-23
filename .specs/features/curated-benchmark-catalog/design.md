# Curated Benchmark Catalog Design

**Spec:** `.specs/features/curated-benchmark-catalog/spec.md`
**Status:** Approved for execution

## Architecture

O catálogo é materializado em um módulo TypeScript gerado e versionado. Uma migration importa esse módulo e insere os casos com IDs e slugs estáveis. O endpoint existente já combina casos `curated` globais com casos privados do usuário. A UI apenas passa a interpretar e apresentar os metadados documentais presentes em `source`.

## Components

### Curated case generator

- Local: `apps/backend/scripts/generate-curated-benchmark-cases.mjs`
- Recebe um manifesto fixo de PRs e SHAs esperados.
- Busca dados somente durante manutenção do catálogo.
- Produz snapshots canônicos, hashes SHA-256 e TypeScript determinístico.

### Generated fixture module

- Local: `apps/backend/src/modules/benchmarks/fixtures/curated-benchmark-cases.ts`
- Contém oito casos completos, sem chamadas de rede.
- É consumido por migration e testes.

### Seed migration

- Adiciona índice único parcial para slug oficial.
- Insere cada fixture com `ON CONFLICT DO NOTHING`.
- O rollback remove apenas IDs do pacote v1 e o índice criado.

### Benchmark Lab

- Agrupa oficiais e privados na navegação.
- Exibe categoria, dificuldade, licença, escopo do snapshot e link da PR.
- Mantém o workspace e comparação já existentes.

## Data Contract

`source` de caso oficial inclui:

```ts
{
  provider: 'github';
  owner: string;
  repo: string;
  pullNumber: number;
  url: string;
  headSha: string;
  baseSha: string;
  mergedAt: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  description: string;
  graphScope: 'changed-files';
  license: { spdx: string; name: string; url: string };
}
```

## Decisions

- Casos v1 são `exploratory`: PR mergeada não é sinônimo de ground truth completo.
- O grafo v1 representa arquivos alterados, testes relacionados e imports detectáveis entre eles. A UI declara esse escopo para não sugerir uma indexação integral do repositório.
- O head SHA é validado pelo gerador; o fixture não acompanha alterações posteriores da PR.
- Conteúdo individual é limitado no gerador para evitar fixtures e prompts ilimitados; truncamento fica explícito no snapshot.

