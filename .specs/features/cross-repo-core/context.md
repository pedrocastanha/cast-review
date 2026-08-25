# Cross-Repo Core Context

**Gathered:** 2026-08-23  
**Spec:** `.specs/features/cross-repo-core/spec.md`  
**Status:** Implemented

## Feature Boundary

Esta release entrega apenas a base cross-repo: projetos, membros, indexação, correlação HTTP determinística, persistência Neo4j e visualização. Não entrega chat ou superfícies futuras.

## Implementation Decisions

### Sequenciamento

- Cross-repo é a primeira release independente.
- Chat, Toggle e Role-aware Copilot dependem desta base e ficam adiados.

### Criação e edição

- Repositórios são associados durante criação ou edição do projeto.
- A fonte da seleção é a lista GitHub já autorizada para o usuário.

### Correlação

- Frontend consumidor aponta para backend provedor.
- Método + rota normalizada é a prova primária.
- Similaridade e LLM não participam do MVP.
- Cada ligação expõe evidência e confiança.

### UX

- O grafo do projeto prioriza componentes e relações, não todos os símbolos.
- Detalhes aparecem progressivamente ao selecionar uma aresta.
- A linguagem visual segue `.impeccable.md`.

## Agent's Discretion

- Composição exata do layout, mantendo a linguagem visual atual.
- Forma de agregar múltiplos endpoints na mesma relação entre repositórios.
- Mensagens de vazio e carregamento.

## Deferred Ideas

- Matching semântico.
- Memória e Chat.
- Toggle.
- Roles e Kanban.
