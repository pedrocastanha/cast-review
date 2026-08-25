# Curated Benchmark Catalog Specification

## Problem Statement

O Benchmark Lab permite comparar modelos, mas exige que cada usuário crie seu próprio caso. O produto precisa oferecer um catálogo inicial comum, reproduzível e auditável para que qualquer usuário autenticado compare qualidade, latência e custo sem preparar uma PR.

## Goals

- Disponibilizar oito PRs públicas e mergeadas para todos os usuários.
- Congelar diff, arquivos e contexto estrutural sem dependência do GitHub em runtime.
- Exibir origem, licença, categoria, dificuldade e escopo do grafo.
- Manter casos oficiais somente leitura e carga idempotente.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Ranking automático | Os casos desta fase são exploratórios e ainda não têm ground truth humano. |
| Atualização automática de PRs | Cada versão é imutável; atualização exige novo fixture/migration. |
| Execução sem chave do usuário | O backend não subsidia chamadas de modelo nesta fase. |

## User Stories

### P1: Executar um caso oficial

Como usuário autenticado, quero selecionar uma PR oficial e comparar até quatro modelos para avaliar qualidade, custo e duração com a mesma evidência.

Acceptance criteria:

1. WHEN um usuário lista os casos THEN o sistema SHALL retornar os oito casos oficiais além dos casos privados do próprio usuário.
2. WHEN um usuário executa um caso oficial THEN todos os modelos SHALL receber o mesmo diff e snapshot hash congelados.
3. WHEN outro usuário abre o mesmo caso THEN o sistema SHALL retornar o mesmo conteúdo e permitir uma execução independente.

### P1: Auditar a origem

Como usuário, quero entender de onde veio o caso e qual contexto o agente recebeu.

Acceptance criteria:

1. WHEN um caso oficial é exibido THEN a UI SHALL mostrar repositório, número da PR, categoria, dificuldade e licença.
2. WHEN o usuário abre a origem THEN a UI SHALL apontar para a PR pública fixada pelo head SHA.
3. WHEN um fixture é carregado THEN seu hash SHALL corresponder ao payload canônico persistido.

### P1: Catálogo seguro e reproduzível

Como mantenedor, quero carregar os fixtures de forma idempotente sem acesso ao GitHub em runtime.

Acceptance criteria:

1. WHEN a migration roda novamente THEN o sistema SHALL evitar casos duplicados por slug.
2. WHEN um usuário tenta apagar um caso oficial THEN o sistema SHALL recusar a operação.
3. WHEN o backend é compilado THEN os fixtures SHALL estar disponíveis como módulos TypeScript, sem asset externo obrigatório.

## Edge Cases

- Caso privado com o mesmo título não conflita com slug oficial.
- Arquivo removido na PR mantém patch e conteúdo final vazio.
- Patch ausente na API vira marcador explícito, não uma PR silenciosamente vazia.
- Um caso oficial permanece executável sem GitHub, Neo4j ou Redis.

## Requirement Traceability

| ID | Requirement | Status |
| --- | --- | --- |
| CBC-01 | Oito casos globais | Verified |
| CBC-02 | Input e grafo congelados | Verified |
| CBC-03 | Origem/licença/metadados visíveis | Verified |
| CBC-04 | Seed idempotente | Verified |
| CBC-05 | Acesso global e somente leitura | Verified |
| CBC-06 | Testes e UAT desktop/mobile | Verified |
