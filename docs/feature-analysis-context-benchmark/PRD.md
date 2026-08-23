# PRD: Contexto auditável da análise e Benchmark Lab

**Status:** MVP implementado
**Data:** 2026-08-22
**Área:** análise de PR, Code Graph, avaliação de modelos

## Resumo

O Cast Review deve persistir o contexto estrutural que o agente usou durante uma análise: símbolos alterados, callers, callees, testes, relações, ranking, orçamento, SHA do índice e indicação de contexto stale.

Esse snapshot será exibido ao usuário junto do review. O usuário poderá responder: “o que exatamente o agente viu para chegar nessa conclusão?”.

A mesma infraestrutura dará origem ao **Benchmark Lab**, com duas fontes de casos:

1. casos oficiais, fixos e versionados pelo projeto;
2. casos privados salvos pelo usuário a partir de uma PR/análise.

A recomendação é implementar as duas modalidades. Casos oficiais permitem medir qualidade de forma comparável; casos privados permitem testar modelos contra o contexto e os padrões reais de cada usuário.

## Problema

Hoje o Graph é consultado durante o run, mas seu resultado é transitório. O Neo4j continua sendo a fonte viva do grafo e pode mudar depois da análise.

Isso cria três problemas:

- o usuário não consegue auditar quais relações influenciaram um finding;
- uma análise antiga pode deixar de ser reproduzível após uma reindexação;
- não existe uma forma consistente de comparar modelos usando exatamente o mesmo diff, contexto e regras.

O projeto já possui persistência do relatório da análise em JSONB, mas ainda não possui um artefato de contexto versionado e independente do relatório ([`Analysis`](../../apps/backend/src/modules/analyses/analysis.entity.ts)).

## Visão

Transformar cada análise em um artefato explicável e reproduzível:

```text
PR snapshot + Graph snapshot + prompt version + model config
                         ↓
              Review reproduzível e auditável
                         ↓
              Comparação entre modelos
```

## Objetivos

- Mostrar ao usuário o subgrafo usado pelo agente.
- Persistir o contexto exatamente como existia no momento da análise.
- Indicar SHA solicitado, SHA indexado, stale, truncamento e orçamento.
- Permitir salvar uma PR/análise como caso de benchmark privado.
- Permitir executar o mesmo caso com modelos diferentes.
- Separar comparação exploratória de avaliação com ground truth.
- Criar uma base para medir recall, precisão, falso positivo, custo e latência.
- Evitar que uma alteração futura no Neo4j mude a interpretação de uma análise histórica.

## Fora de escopo inicial

- Treinar ou fine-tunar modelos.
- Criar um benchmark universal para todos os idiomas.
- Publicar automaticamente casos privados.
- Considerar output de LLM como ground truth sem revisão humana.
- Persistir o grafo completo de todos os repositórios em cada análise.
- Aprovar ou bloquear merge automaticamente.

## Usuários

### Dono da PR

Quer entender por que o agente comentou algo e quais partes do sistema podem ter sido afetadas.

### Usuário avaliando modelos

Quer rodar a mesma PR com diferentes modelos, mantendo diff, Graph, convenções e prompts constantes.

### Mantenedor do Cast Review

Quer acompanhar regressões de qualidade e adicionar casos difíceis ao conjunto oficial.

## Histórias de usuário

### SNAP-01 — Ver o contexto usado

Como dono de uma PR, quero abrir a seção “Contexto usado pelo agente” e visualizar callers, callees, testes e caminhos do Graph que entraram na análise.

### SNAP-02 — Entender a origem de cada relação

Como usuário, quero saber se uma relação é direta, transitiva, inferida ou stale, para não interpretar uma heurística como certeza.

### SNAP-03 — Preservar uma análise histórica

Como usuário, quero que uma análise antiga continue mostrando o mesmo contexto mesmo depois que o repositório for reindexado.

### BENCH-01 — Usar casos oficiais

Como usuário, quero executar uma suíte fixa de PRs curadas pelo Cast Review para comparar modelos em um cenário comum.

### BENCH-02 — Salvar uma PR própria

Como usuário, quero salvar uma análise como caso privado para repetir o teste sempre que quiser.

### BENCH-03 — Comparar modelos

Como usuário, quero rodar o mesmo caso com modelos diferentes e comparar findings, sobreposição, custo e duração.

### BENCH-04 — Avaliar com ou sem ground truth

Como usuário, quero comparar modelos mesmo quando ainda não existe uma resposta correta anotada; quando houver anotações, quero ver precisão, recall e falso positivo.

## Decisão de produto: benchmark híbrido

### Casos oficiais fixos

Serão casos versionados no repositório e disponibilizados para todos os usuários.

Cada caso deverá conter:

- diff e arquivos necessários;
- linguagem e categoria do problema;
- metadados da PR original;
- Graph snapshot;
- versão do caso;
- findings esperados, quando houver ground truth validado;
- licença/origem do conteúdo.

Esses casos são a referência comparável entre versões do produto.

### Casos privados salvos pelo usuário

O usuário poderá salvar uma análise concluída como benchmark privado.

O sistema deve salvar um snapshot materializado, não apenas `owner/repo/pullNumber`. Uma PR pode receber novos commits, comentários ou ser apagada. O caso salvo precisa continuar reproduzível.

Um caso privado pode começar sem ground truth. Nesse modo o sistema apresenta comparação exploratória, mas não afirma que um modelo foi “melhor”.

O usuário poderá posteriormente anotar findings esperados ou marcar findings como válidos, inválidos e duplicados. A partir daí o caso passa a ter avaliação objetiva.

## Modos de avaliação

### Exploração

Compara:

- findings por modelo;
- findings em comum;
- divergências;
- severidade;
- custo;
- tokens;
- latência;
- cobertura de arquivos.

Não calcula precisão/recall sem ground truth.

### Scored

Com ground truth anotado, calcula:

- precisão;
- recall;
- F1;
- falso positivo;
- falso negativo;
- acerto de severidade;
- acerto de localização;
- redundância;
- custo por finding válido.

## Requisitos funcionais

### Snapshot da análise

- RF-S1: toda análise concluída deve possuir snapshot do contexto Graph, quando o Graph estiver disponível.
- RF-S2: o snapshot deve registrar `requestedSha`, `indexedSha`, `stale`, versão do indexador, versão do schema e hash do snapshot.
- RF-S3: o snapshot deve conter os nós, arestas e trechos selecionados para o contexto do agente.
- RF-S4: o snapshot deve registrar o motivo da seleção, distância, score e confiança quando esses dados existirem.
- RF-S5: o snapshot deve registrar orçamento, tokens estimados, truncamento e itens omitidos por limite.
- RF-S6: uma análise histórica deve continuar exibindo seu snapshot após reindexação do repositório.
- RF-S7: falha no snapshot não pode transformar uma análise válida em erro; o relatório deve indicar contexto indisponível.

### Experiência de visualização

- RF-V1: a página da análise deve exibir resumo do impacto.
- RF-V2: o usuário deve conseguir filtrar callers diretos, callers transitivos, callees e testes.
- RF-V3: cada relação deve exibir path, símbolo, distância, tipo e confiança.
- RF-V4: contexto stale deve possuir aviso visível.
- RF-V5: o usuário deve conseguir ver quais itens foram omitidos por orçamento.
- RF-V6: o usuário deve conseguir abrir o Graph snapshot sem consultar o Graph vivo.

### Benchmark

- RF-B1: o sistema deve disponibilizar casos oficiais versionados.
- RF-B2: o usuário deve conseguir salvar uma análise como caso privado.
- RF-B3: o caso privado deve copiar o input necessário para execução: diff, arquivos, convenções e Graph snapshot.
- RF-B4: o usuário deve selecionar um ou mais modelos para uma execução.
- RF-B5: todas as execuções de uma comparação devem usar o mesmo caso e o mesmo snapshot de contexto.
- RF-B6: a execução deve registrar modelo, prompt version, Graph snapshot hash, tokens, custo, duração e resultado.
- RF-B7: casos sem ground truth devem ser identificados como exploratórios.
- RF-B8: o usuário deve conseguir criar e editar anotações de ground truth em casos privados.
- RF-B9: resultados de benchmark devem ser persistidos e consultáveis posteriormente.
- RF-B10: dados de casos privados só podem ser acessados pelo dono ou por compartilhamento explícito futuro.
- RF-B11: casos oficiais devem congelar o título e a descrição originais da PR, sem consultar o GitHub durante a navegação.
- RF-B12: antes de executar modelos, o Lab deve mostrar a proposta da PR, os arquivos alterados e o diff congelado; snapshots antigos sem descrição devem continuar utilizáveis com fallback explícito.

## Critérios de sucesso

### Transparência

- 99% das análises concluídas com Graph disponível possuem snapshot persistido.
- O usuário consegue identificar o SHA do índice e a condição stale.
- O Graph exibido na análise não depende de uma consulta posterior ao Neo4j.

### Reprodutibilidade

- O mesmo caso, snapshot e configuração gera uma execução comparável entre modelos.
- Mudanças no indexador ou prompt geram uma nova versão identificável.

### Benchmark

- Uma suíte oficial possui pelo menos 20 casos anotados antes de ser usada como ranking.
- Uma PR salva pelo usuário pode ser reexecutada sem acesso ao GitHub original.
- Comparações exibem custo e latência por modelo.

### Qualidade

- O sistema mede precisão, recall e falso positivo apenas quando existe ground truth.
- O sistema não apresenta ranking objetivo para casos exploratórios sem anotação.

## Privacidade e retenção

Snapshots podem conter código proprietário. Portanto:

- casos privados são sempre escopados ao usuário;
- API keys nunca entram em snapshots;
- o conteúdo salvo deve ser limitado ao que foi usado pelo agente;
- casos oficiais só podem usar conteúdo com origem/licença permitida;
- apagar uma análise deve apagar seu snapshot associado;
- salvar um benchmark deve criar uma cópia independente, deixando claro que ele não é um ponteiro vivo para a análise.

## Rollout recomendado

1. Persistência e visualização do Graph snapshot em análises.
2. Salvar análise como caso privado exploratório.
3. Execução comparativa entre modelos.
4. Ground truth e métricas scored.
5. Suíte oficial versionada e regressão contínua.

## Decisão recomendada

Implementar as duas modalidades de benchmark desde o desenho, mas lançar primeiro:

- casos oficiais pequenos e versionados;
- casos privados sem ground truth;
- comparação exploratória clara, sem ranking enganoso.

Ground truth anotado pode entrar na segunda etapa, quando o fluxo de snapshot já estiver confiável.

## Status de entrega do MVP

Implementado em 2026-08-22:

- snapshot imutável por análise, com hash canônico, input, SHA, subgrafo, orçamento e bloco textual;
- visualização sob demanda na análise, com filtros e aviso de contexto stale;
- criação de caso privado como cópia materializada da análise;
- execução síncrona de até quatro modelos contra o mesmo snapshot congelado;
- comparação exploratória de findings compartilhados e exclusivos, custo e duração;
- isolamento de casos e runs por usuário;
- catálogo global v1 com oito PRs públicas e mergeadas, carregado por migration;
- origem, licença, categoria, dificuldade, head SHA e escopo do grafo auditáveis no Lab.
- título e descrição originais da PR, lista de arquivos e diff congelado visíveis antes da comparação.

Permanece para as próximas etapas:

- editor de ground truth e métricas scored;
- fila assíncrona para matrizes maiores;
- edição/remoção de casos pela interface.

### Catálogo oficial v1

O pacote inicial usa PRs de Axios, Express, Fastify, TypeORM e node-redis. Cada caso é exploratório, somente leitura e contém diff, conteúdo limitado dos arquivos, testes relacionados e snapshot com hash canônico. O catálogo é instalado pela migration `SeedCuratedBenchmarkCatalog1787503000000`; não consulta GitHub, Neo4j ou Redis durante o uso.
