# PRD: Observabilidade distribuída

**Status:** Proposto

**Data:** 2026-09-03

**Prioridade:** P1 — fundação de operação e pré-requisito para evoluções de custo e performance
**Dependências:** pipeline de análise atual (Nest → ai-api → LangGraph), cálculo de custo de LLM existente, fila BullMQ de indexação

## Resumo executivo

O Cast Review executa uma análise atravessando quatro fronteiras de processo: navegador, gateway WebSocket do Nest, stream SSE do serviço Python, e o pipeline de agentes do LangGraph chamando o provedor de LLM. Cada fronteira registra logs próprios, e nenhum deles compartilha identificador.

Na prática, quando uma análise demora dois minutos ou custa mais do que o esperado, não existe forma de responder onde o tempo foi gasto ou qual agente consumiu o orçamento. A informação existe em pedaços — o `LoggingInterceptor` mede duração de requisição HTTP, o cliente de LLM já calcula `cost_usd` por chamada — mas nada correlaciona esses pedaços entre si.

Esta feature introduz rastreamento distribuído e métricas sobre o pipeline existente. Um `traceId` único acompanha a análise do primeiro clique até a última chamada de modelo, cada etapa do pipeline vira um span mensurável, e o custo já calculado passa a ser exposto como métrica agregável.

O objetivo não é instrumentar o sistema inteiro. É instrumentar o caminho crítico da análise, que é onde está a latência, o custo e a complexidade real do produto.

## Problema

O sistema é observável apenas localmente, dentro de cada processo:

- logs do Nest e logs do Python não possuem correlação; investigar uma análise exige alinhar timestamps manualmente entre dois terminais;
- a duração total de uma análise é conhecida, mas a distribuição dessa duração entre etapas não é;
- o custo por chamada de LLM é calculado e descartado no nível de agregação; não existe custo por análise, por agente ou por modelo ao longo do tempo;
- a profundidade da fila de indexação e a duração da indexação por árvore não são medidas;
- uma regressão de performance introduzida por mudança de prompt ou de contexto só é percebida subjetivamente;
- falha intermitente no stream SSE entre Nest e Python não deixa rastro reconstituível.

A consequência é que qualquer decisão sobre performance ou custo é feita por intuição, e o produto não consegue provar que uma otimização funcionou.

## Hipótese de produto

Se cada análise produzir um trace único atravessando os dois runtimes e as métricas de custo forem expostas de forma agregável, então será possível localizar gargalos em minutos em vez de horas, quantificar o efeito de mudanças de prompt e contexto, e sustentar decisões de orçamento com dado em vez de estimativa.

## Usuários e jobs-to-be-done

| Usuário | Necessidade |
| --- | --- |
| Mantenedor do projeto | Descobrir qual etapa domina a latência de uma análise lenta |
| Desenvolvedor de agentes | Comparar custo e duração entre versões de prompt e de contexto |
| Operador local | Confirmar que a stack subiu saudável e que a fila não está represada |
| Autor de PR no repositório | Ver que uma mudança não degradou latência nem custo do pipeline |
| Avaliador do projeto | Entender a arquitetura do fluxo observando um trace real |

## Modelo mental do produto

### Trace

Registro completo de uma análise, do gatilho até a resposta final, cruzando processos. Identificado por `traceId` e propagado pelo padrão W3C Trace Context.

### Span

Etapa nomeada dentro de um trace, com início, fim e atributos. Um span pertence a um trace e pode ter um span pai.

### Baggage

Contexto de negócio que viaja junto com o trace. Nesta feature: `analysisId`, `repositoryId` e `origin` da análise.

### Métrica

Valor agregável ao longo do tempo, independente de um trace específico. Duração, custo, tokens e profundidade de fila.

## Princípios do produto

1. **Caminho crítico primeiro:** instrumentar o pipeline de análise e indexação; não instrumentar código auxiliar por completude.
2. **Custo zero de comportamento:** telemetria nunca altera resultado nem bloqueia execução; falha de exportador é degradação silenciosa e registrada.
3. **Dado já existente é reaproveitado:** custo e tokens já são calculados no cliente de LLM e não devem ser recalculados.
4. **Local por padrão:** a stack de observabilidade sobe junto com o projeto, sem depender de serviço externo ou conta paga.
5. **Sem vazamento:** conteúdo de diff, prompt, resposta de modelo e credencial nunca entram em span, métrica ou log.
6. **Correlação obrigatória:** todo log emitido dentro de um trace carrega o `traceId`.

## Experiência proposta

### 1. Investigar uma análise lenta

O usuário abre o Grafana, filtra traces pelo `analysisId` mostrado na interface, e vê a árvore completa da execução. A visão de cascata expõe imediatamente qual span domina o tempo: busca do diff no GitHub, montagem de contexto do code graph, ou um agente específico.

Ao abrir o span de uma chamada de modelo, os atributos mostram modelo, tokens de entrada, tokens de saída, tokens em cache e custo estimado daquela chamada.

### 2. Acompanhar custo

Um dashboard mostra custo acumulado por modelo e por agente, número de análises executadas, custo médio por análise, e distribuição de tokens entre prompt, completion e cache. A série temporal permite ver o efeito de uma mudança de prompt no dia em que ela entrou.

### 3. Verificar saúde local

Um dashboard de saúde mostra profundidade da fila de indexação, duração de indexação por repositório, taxa de erro por rota e latência p50/p95 do pipeline. Serve para responder rapidamente se o ambiente local está degradado ou se o problema é da mudança em teste.

### 4. Correlacionar log e trace

Ao encontrar uma linha de log de erro, o `traceId` presente nela leva direto ao trace correspondente, com todos os spans dos dois runtimes. O caminho inverso também funciona: a partir de um span, filtrar os logs daquele trace.

### 5. Degradação

Se o coletor estiver indisponível, a aplicação continua funcionando normalmente. Spans são descartados após buffer cheio, e o fato é registrado uma vez por janela, sem inundar o log.

## Histórias de usuário

### P1 — MVP

- **OBS-01:** Como mantenedor, quero que uma análise produza um único trace atravessando Nest e serviço Python.
- **OBS-02:** Como mantenedor, quero um span por etapa do pipeline de agentes, com duração mensurável.
- **OBS-03:** Como desenvolvedor de agentes, quero ver tokens e custo estimado como atributos do span da chamada de modelo.
- **OBS-04:** Como operador, quero métricas de duração, custo, tokens e fila expostas em endpoint Prometheus.
- **OBS-05:** Como mantenedor, quero que todo log carregue o `traceId` do trace em curso.
- **OBS-06:** Como operador, quero subir traces, métricas e dashboards junto com o projeto por composição local.
- **OBS-07:** Como usuário, quero que indisponibilidade de telemetria não afete nem interrompa a análise.

### P2

- **OBS-08:** Como desenvolvedor, quero ver o `traceId` na interface da análise para investigar sem consultar log.
- **OBS-09:** Como mantenedor, quero amostragem configurável para reduzir volume em execução prolongada.
- **OBS-10:** Como mantenedor, quero alerta local quando custo por análise ultrapassar limite configurado.
- **OBS-11:** Como desenvolvedor, quero span de consulta ao Neo4j e ao Postgres no caminho de montagem de contexto.
- **OBS-12:** Como mantenedor, quero exportar um trace de exemplo como artefato de documentação da arquitetura.

### P3

- **OBS-13:** Como mantenedor, quero comparar automaticamente latência e custo entre duas execuções do benchmark.
- **OBS-14:** Como operador, quero perfil contínuo de CPU e memória do serviço Python durante indexação.
- **OBS-15:** Como organização, quero exportar telemetria para backend externo compatível com OTLP.

## Requisitos funcionais P1

| ID | Requisito |
| --- | --- |
| OB-01 | O Nest deve iniciar um trace por análise e propagar contexto W3C `traceparent` na chamada ao serviço Python. |
| OB-02 | O serviço Python deve extrair o contexto recebido e continuar o mesmo trace, sem criar trace novo. |
| OB-03 | O pipeline de agentes deve emitir um span por nó executado, nomeado de forma estável. |
| OB-04 | Toda chamada de modelo deve emitir span com atributos de modelo, tokens de prompt, completion, cache e custo estimado. |
| OB-05 | `analysisId`, `repositoryId` e `origin` devem viajar como baggage e aparecer nos spans dos dois runtimes. |
| OB-06 | Logs do Nest e do Python devem incluir `traceId` e `spanId` quando emitidos dentro de um trace. |
| OB-07 | O sistema deve expor endpoint de métricas Prometheus em porta separada da API pública. |
| OB-08 | Devem existir métricas de duração de análise por etapa, custo acumulado por modelo e por agente, tokens por tipo, duração de indexação e profundidade de fila. |
| OB-09 | A composição local deve subir coletor, backend de traces, Prometheus e Grafana com dashboards provisionados. |
| OB-10 | Dashboards devem ser versionados no repositório como arquivo, não configurados manualmente. |
| OB-11 | Falha de exportação de telemetria não deve propagar exceção para o fluxo de negócio. |
| OB-12 | Nenhum span, métrica ou log pode conter diff, prompt, resposta de modelo, token de acesso ou chave de API. |
| OB-13 | A instrumentação deve poder ser desativada por variável de ambiente, sem alteração de código. |
| OB-14 | Trabalho assíncrono processado pela fila deve manter vínculo com o trace que o enfileirou. |

## Inventário de spans do caminho crítico

| Span | Runtime | Origem |
| --- | --- | --- |
| `analysis.run` | Nest | raiz do trace, criada no início do caso de uso de análise |
| `github.fetch_diff` | Nest | integração Octokit |
| `code_graph.context` | Python | montagem e orçamento de contexto |
| `agent.run` | fronteira | requisição SSE do Nest para o serviço Python |
| `node.change_analyzer` | Python | nó do pipeline |
| `node.implementation_spec` | Python | nó do pipeline |
| `agent.<reviewer>` | Python | um span por reviewer especialista |
| `node.report_builder` | Python | nó do pipeline |
| `llm.chat` | Python | chamada ao provedor, filha do span do agente que a originou |
| `index.repository` | Nest | processador da fila de indexação |

## Inventário de métricas

| Métrica | Tipo | Labels |
| --- | --- | --- |
| `cast_analysis_duration_seconds` | histogram | `stage`, `origin` |
| `cast_analysis_total` | counter | `status`, `origin` |
| `cast_llm_cost_usd_total` | counter | `model`, `agent` |
| `cast_llm_tokens_total` | counter | `model`, `agent`, `kind` |
| `cast_llm_request_duration_seconds` | histogram | `model`, `agent` |
| `cast_index_duration_seconds` | histogram | `language` |
| `cast_queue_depth` | gauge | `queue` |
| `cast_http_request_duration_seconds` | histogram | `route`, `status` |

O label `kind` de tokens assume `prompt`, `completion` ou `cached`. Cardinalidade de labels é fixa e conhecida; identificadores de análise e de repositório não podem virar label.

## Requisitos não funcionais

### Desempenho

- A instrumentação não deve adicionar mais que 5% à duração de uma análise de referência no ambiente local.
- Exportação de spans é assíncrona e em lote; nunca síncrona no caminho da requisição.
- O buffer de exportação é limitado; descarte é preferível a acúmulo de memória.

### Confiabilidade

- Coletor indisponível na subida não impede a aplicação de iniciar.
- Reconexão do exportador é automática e não exige reinício.
- Ausência de telemetria é observável: a aplicação registra que a exportação está falhando.

### Segurança e privacidade

- Atributos de span são estruturais: identificadores, nomes de etapa, contagens e durações.
- Conteúdo de código, prompt e resposta de modelo são explicitamente proibidos em telemetria.
- O endpoint de métricas não é exposto na mesma porta da API pública.
- A stack de observabilidade é local; nenhum dado sai da máquina no MVP.

### Manutenibilidade

- Nomes de span e de métrica seguem convenção documentada e são tratados como contrato.
- A instrumentação de nós do pipeline é centralizada, não repetida nó a nó.
- Dashboards ficam versionados e sobem por provisionamento.

## Métricas de sucesso

- Uma análise completa produz um trace único com todos os spans do inventário, sem trace órfão entre runtimes.
- O tempo para identificar a etapa dominante de uma análise lenta cai para menos de dois minutos.
- 100% das chamadas de modelo aparecem com custo e tokens no span correspondente.
- O custo acumulado reportado pela métrica confere com o custo calculado pelo módulo de cost tracking.
- Dogfood identifica ao menos um gargalo de latência ou custo não conhecido previamente.
- Subir a stack completa e ver o primeiro trace leva menos de cinco minutos a partir do clone.
- Overhead medido de latência fica abaixo do limite de 5%.

## Fora de escopo do MVP

- Backend de telemetria hospedado ou serviço pago.
- Perfil contínuo de CPU e memória.
- Real user monitoring e telemetria do navegador.
- Alertas com envio para canal externo.
- Amostragem adaptativa por carga.
- Rastreamento de queries individuais do ORM.
- Retenção de longo prazo e política de arquivamento.
- Correlação entre traces de repositórios diferentes.

## Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Instrumentação vaza conteúdo de código ou credencial | Lista fechada de atributos permitidos e revisão explícita no gate |
| Overhead degrada a análise | Exportação em lote assíncrona e medição de overhead como critério de aceite |
| Cardinalidade de métrica explode | Identificadores proibidos como label; labels fixos e revisados |
| Stack local pesada demais para a máquina do usuário | Perfil de composição opcional; a aplicação sobe sem observabilidade por padrão |
| Contexto de trace se perde na fronteira SSE | Teste de integração que falha se o trace do Python não for filho do trace do Nest |
| Contexto se perde no trabalho assíncrono da fila | Trace context serializado no payload do job e restaurado no processador |
| Instrumentação vira código espalhado e frágil | Decorador único para nós do pipeline e interceptor único no Nest |

## Rollout recomendado

1. SDK e exportador nos dois runtimes, sem spans manuais, validando a instrumentação automática de HTTP.
2. Propagação de contexto na fronteira Nest → Python e teste que prova a continuidade do trace.
3. Spans manuais do pipeline de agentes e da chamada de modelo com atributos de custo.
4. Correlação de log com `traceId` nos dois lados.
5. Métricas e endpoint Prometheus.
6. Composição local de coletor, backend de traces, Prometheus e Grafana com dashboards versionados.
7. Medição de overhead e ajuste de amostragem.

## Gate de lançamento

1. Uma análise real produz um trace único e contínuo cruzando os dois runtimes.
2. Todos os spans do inventário do caminho crítico aparecem com duração coerente.
3. Custo e tokens do span de modelo conferem com o cost tracking existente.
4. Uma linha de log de erro permite chegar ao trace correspondente pelo `traceId`.
5. Derrubar o coletor não interrompe nem degrada uma análise em curso.
6. Nenhum atributo de telemetria contém diff, prompt, resposta ou credencial, verificado por inspeção de um trace completo.
7. Overhead medido fica abaixo de 5% na análise de referência.
8. A variável de desativação remove a instrumentação sem quebrar a aplicação.

## Rastreabilidade

| História | Requisitos | Status |
| --- | --- | --- |
| OBS-01 | OB-01, OB-02, OB-05 | Pendente |
| OBS-02 | OB-03, OB-14 | Pendente |
| OBS-03 | OB-04, OB-12 | Pendente |
| OBS-04 | OB-07, OB-08 | Pendente |
| OBS-05 | OB-06 | Pendente |
| OBS-06 | OB-09, OB-10 | Pendente |
| OBS-07 | OB-11, OB-13 | Pendente |
