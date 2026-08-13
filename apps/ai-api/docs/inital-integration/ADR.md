# ADR: Grafo fixo (LangGraph) em vez de deep-agents autônomo

- **Status:** Proposto
- **Data:** 2026-08-10
- **Escopo:** `apps/ai-api`

## Contexto

O padrão "deep agents" (popularizado pelo pacote `deepagents` da LangChain) resolve tarefas longas e abertas: um agente planejador central mantém uma lista de todos dinâmica, um filesystem virtual pra memória de trabalho, e delega sub-tarefas pra sub-agentes com autonomia pra decidir o próprio caminho. É o padrão certo pra "pesquise X e escreva um relatório" — onde o caminho não é conhecido de antemão.

O Cast Review tem uma regra de negócio que vai na direção oposta: *"o agente só pode sinalizar um problema se referenciar uma linha específica do `conventions.md`"* — proposital, porque sem essa restrição o LLM tende a opinar de forma genérica e inconsistente entre execuções. Score também é sempre calculado em código, nunca gerado pelo LLM, pelo mesmo motivo: **consistência entre runs importa mais que autonomia**.

Precisava decidir: adotar deep-agents completo (planner dinâmico + delegação livre) ou um grafo com caminho fixo.

## Decisão 1 — Grafo com edges fixos, sem planner dinâmico

**O quê:** o pipeline é um `StateGraph` do LangGraph com ordem pré-definida: `change_analyzer → implementation_spec → {test_reviewer, architecture_reviewer} (paralelo) → report_builder`. Nenhum node decide qual é o próximo node — isso é definido em código, não pelo LLM.

**Por quê:** o mesmo motivo da regra 3 do produto (architecture reviewer só reporta com `conventionRef`) se aplica à orquestração: um planner decidindo dinamicamente "o que revisar em seguida" reintroduz variância entre execuções do mesmo diff. Um grafo fixo garante que rodar o mesmo PR duas vezes percorre exatamente os mesmos passos — só o conteúdo de cada finding pode variar (limitado pelas regras 2 e 3 do produto).

**Trade-off aceito:** perde a flexibilidade de deep-agents pra casos não previstos (ex.: reviewer decidir sozinho que precisa investigar um arquivo adicional não mandado no payload). Aceito porque o MVP não precisa disso — o Nest já manda o contexto relevante via Context Builder.

**Alternativa descartada:** deep-agents completo (planner + todo list + filesystem virtual + delegação livre). Revisar se, pós-MVP, um reviewer precisar de investigação aberta (ex.: navegar o repo inteiro por conta própria) — nesse ponto a troca é isolada a um node específico, não ao grafo inteiro (ver Consequências).

## Decisão 2 — Nodes como sub-agents isolados, tool surface mínimo

**O quê:** cada reviewer é um node de grafo, não um agente com acesso livre a tools. O único "dado externo" disponível é o que já veio no payload da requisição (`fullContent`, `relatedFiles`, `conventions`) — sem tool de leitura de filesystem real, sem tool genérica de busca.

**Por quê:** é a parte do deep-agents que vale a pena reaproveitar — isolamento de contexto por sub-agente evita que o prompt de um reviewer fique poluído com informação de outro, e mantém cada chamada de LLM pequena e previsível. A diferença é que aqui o isolamento é estrutural (grafo), não fruto de um planner decidindo o que delegar.

**Trade-off aceito:** se um reviewer precisar de dado que o Nest não mandou, a resposta é "falha ou ignora", não "busca sozinho". Aceito — expandir o payload do Context Builder é mudança mais segura que dar tool de FS livre a um LLM.

## Decisão 3 — Score nunca é responsabilidade de node com LLM

**O quê:** a fórmula de score (100 − 15×fail − 5×warning, clamp 0–100) vive em `domain/agents` (função pura), chamada pelos nodes de reviewer *depois* que o LLM devolve os `findings` — nunca pedida ao LLM como parte da resposta.

**Por quê:** LLM decide fatos (`status` de cada finding); matemática determinística decide nota. Isso é testável sem mockar nenhuma API e sem re-rodar LLM pra verificar regressão de score.

## Decisão 4 — Comunicação Nest↔Python via único endpoint SSE

**O quê:** `POST /agent/run` é o único endpoint que expõe o pipeline. Resposta é streaming SSE — cada node concluído emite um evento na mesma conexão HTTP. Não há WebSocket direto do Python pro front; o Nest é o único consumidor e repassa 1:1 pro browser.

**Por quê:** mantém o Python cego a quem está do outro lado (não precisa saber de sessão de usuário, socket, autenticação) — só processa um payload e devolve eventos. Simplifica o serviço a uma função pura de streaming.

## Decisão 5 — Serviço 100% stateless

**O quê:** `apps/ai-api` não persiste nada — sem banco, sem Redis, sem sessão em memória entre requisições. Cada `POST /agent/run` é isolado; o estado do grafo vive só durante a execução daquela requisição.

**Por quê:** o Nest já guarda o resultado (`Map<runId, Report>` em memória, por decisão do backend). Duplicar esse estado no Python seria duas fontes de verdade pra sincronizar sem necessidade — o Python não tem motivo pra saber que `runId`s existem.

**Trade-off aceito:** reiniciar o processo Python no meio de um run perde esse run inteiro (sem checkpoint/retry). Aceito no MVP — reavaliar se latência total do pipeline crescer a ponto de falhas de processo virarem custo real de UX.

## Decisão 6 — Reviewers em paralelo, unidos antes do report

**O quê:** `test_reviewer` e `architecture_reviewer` são branches paralelos do grafo (fan-out depois de `implementation_spec`, fan-in antes de `report_builder`) — não uma sequência.

**Por quê:** os dois reviewers são independentes entre si (nenhum lê o resultado do outro) e cada um já é uma chamada de LLM isolada — rodar em série só soma latência sem ganho de qualidade.

## Consequências gerais

- Adicionar um reviewer novo (ex.: Security, pós-MVP) é adicionar um node + uma edge no fan-out — não exige tocar `change_analyzer`, `implementation_spec` nem `report_builder`.
- Se algum node precisar de autonomia real no futuro (deep-agents completo só *naquele* node — ex. um reviewer que navega o repo por conta própria), a troca é isolada: o grafo em volta continua fixo, só aquele node vira um sub-grafo com planner próprio.
- `domain/agents` (entidades + scoring) não pode importar nada de `agents/` (nodes) nem de `infrastructure/llm` — é a camada que garante que score/severidade continuam testáveis sem LLM, mesmo que a orquestração mude.
- Qualquer novo node que precise de dado que não está no payload atual exige mudança no Context Builder do Nest, não uma tool nova no Python.
