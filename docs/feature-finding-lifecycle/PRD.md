# PRD: Ciclo de vida dos findings

**Status:** Proposto

**Data:** 2026-09-01

**Prioridade:** P1 — próxima evolução da experiência de review
**Dependências:** análises persistidas, relatório de review, comentários no GitHub e aprovação humana

## Resumo executivo

O Cast Review já persiste análises completas de uma pull request, mas cada execução ainda é apresentada como um relatório independente. Quando a mesma PR recebe novos commits, o usuário precisa comparar mentalmente os relatórios para descobrir o que é novo, o que continua acontecendo e o que deixou de aparecer.

Esta feature transforma findings isolados em casos acompanháveis ao longo das execuções da mesma PR. Cada finding acionável passa a ser classificado como `novo`, `recorrente` ou `reaberto`; findings ativos que não reaparecem numa análise comparável ficam registrados como `não observado`. O usuário também pode marcar um caso como `risco aceito` ou `falso positivo`, com justificativa auditável.

O produto não afirmará que um problema foi corrigido apenas porque deixou de aparecer. A linguagem oficial será **“não observado nesta análise”**. Isso preserva a confiança: ausência de detecção é evidência útil, mas não é prova de correção.

## Problema

Hoje, uma nova análise responde “o que encontrei agora?”, mas não responde:

- este finding é realmente novo?
- o autor tentou corrigir e ele continuou aparecendo?
- um finding antigo deixou de ser detectado?
- o time já decidiu aceitar esse risco?
- este alerta já foi classificado como falso positivo?
- quantos findings geraram alguma ação concreta?

Essa falta de continuidade cria três efeitos de produto:

1. **Fadiga de review:** o usuário relê alertas conhecidos a cada push.
2. **Baixa auditabilidade:** não existe histórico explícito das decisões humanas sobre cada finding.
3. **Baixo aprendizado:** o Cast não consegue medir recorrência, não observação ou falso positivo percebido.

## Hipótese de produto

Se o Cast destacar apenas o delta entre execuções, preservar as decisões humanas e evitar republicar findings já reconhecidos, então os usuários agirão mais rápido sobre problemas novos, perceberão menos ruído e fornecerão sinais confiáveis para evolução dos agentes.

## Usuários e jobs-to-be-done

| Usuário | Necessidade |
| --- | --- |
| Autor da PR | Entender o que mudou na review depois de um novo push |
| Revisor | Distinguir risco novo, persistente e já deliberado |
| Tech Lead | Auditar riscos aceitos e falsos positivos sem reler todas as execuções |
| Mantenedor do Cast | Medir utilidade e ruído dos reviewers com feedback real |

## Princípios do produto

1. **Continuidade sem exagero:** “não observado” não será apresentado como “corrigido”.
2. **Escopo conservador:** no MVP, identidade e decisões valem somente para a mesma PR, repositório e usuário.
3. **Matching determinístico:** o MVP não usa LLM nem similaridade probabilística para decidir que dois findings são o mesmo caso.
4. **Feedback não altera o passado:** relatório, severidade e score originais permanecem auditáveis.
5. **Menos ruído no GitHub:** riscos aceitos e falsos positivos permanecem visíveis no Cast, mas não geram o mesmo comentário inline novamente.
6. **Falha aberta:** se a reconciliação de lifecycle falhar, a análise e o relatório continuam válidos; a UI informa que a comparação está indisponível.
7. **Sem treinamento implícito:** feedback humano não modifica prompts nem modelos automaticamente.

## Vocabulário oficial

### Classificação entre execuções

| Classificação | Significado |
| --- | --- |
| `new` | Primeira observação conhecida deste caso na PR |
| `recurring` | Caso ativo observado novamente |
| `reopened` | Caso anteriormente não observado que voltou a aparecer |
| `not_observed` | Caso ativo que não apareceu numa análise comparável posterior |

### Estado e decisão humana

| Dimensão | Valores | Significado |
| --- | --- | --- |
| Estado | `active`, `resolved` | `resolved` significa somente que o caso não foi observado na comparação mais recente |
| Disposição | `unreviewed`, `accepted_risk`, `false_positive` | Decisão humana independente do estado automático |

Um caso pode, por exemplo, estar `resolved + accepted_risk`: ele deixou de aparecer, mas sua decisão histórica continua preservada.

## Experiência proposta

### 1. Resumo da execução

Na visão geral de uma análise concluída, antes da lista tradicional de findings, o Cast mostra:

- `N novos`;
- `N recorrentes`;
- `N reabertos`;
- `N não observados`;
- `N reconhecidos` — soma de risco aceito e falso positivo ainda observados.

Se não houver baseline comparável, a UI informa: `Primeira análise acompanhada desta PR`.

### 2. Filtros orientados à decisão

A seção de findings passa a oferecer quatro visões:

- `Atenção`: novos, recorrentes e reabertos sem decisão humana;
- `Reconhecidos`: riscos aceitos e falsos positivos observados;
- `Não observados`: casos que deixaram de aparecer nesta comparação;
- `Todos`: visão completa da execução.

Cada card mostra a classificação, a primeira e a última análise em que apareceu e a disposição atual.

### 3. Feedback humano

Em um finding ativo, o usuário pode:

- marcar como `Risco aceito`;
- marcar como `Falso positivo`;
- voltar para `Sem decisão`;
- adicionar ou substituir uma justificativa curta; ela é obrigatória para `Falso positivo` e opcional para `Risco aceito`.

A mudança aparece imediatamente na análise atual e é aplicada às próximas ocorrências do mesmo caso naquela PR. O histórico registra ator, instante, valor anterior, valor novo e justificativa.

### 4. Publicação no GitHub

- Findings `unreviewed` continuam elegíveis para comentário inline.
- Findings `accepted_risk` e `false_positive` não são republicados em análises posteriores.
- O resumo da review informa quantos findings foram omitidos por decisão humana.
- Score e veredito calculados originalmente não são reescritos para esconder o finding.

### 5. Histórico antigo

Na primeira execução após o lançamento, o Cast pode usar a análise concluída imediatamente anterior da mesma PR como baseline. Não haverá backfill completo de todo o histórico no MVP.

## Histórias de usuário

### P1 — MVP

- **LIFE-01:** Como autor da PR, quero ver quais findings são novos, recorrentes ou reabertos.
- **LIFE-02:** Como autor da PR, quero saber quais casos ativos não reapareceram na análise atual.
- **LIFE-03:** Como revisor, quero marcar um finding como risco aceito ou falso positivo com justificativa.
- **LIFE-04:** Como revisor, quero que minha decisão continue valendo nas próximas execuções da mesma PR.
- **LIFE-05:** Como usuário, quero filtrar findings por atenção, reconhecidos e não observados.
- **LIFE-06:** Como usuário, quero que uma falha na comparação não invalide a review original.
- **LIFE-07:** Como usuário do GitHub, não quero receber novamente comentários sobre riscos já reconhecidos.

### P2

- **LIFE-08:** Como Tech Lead, quero uma inbox de findings ativos por repositório.
- **LIFE-09:** Como mantenedor, quero métricas agregadas de recorrência, tempo até não observação e falso positivo.
- **LIFE-10:** Como usuário, quero corrigir manualmente um matching incorreto entre casos.
- **LIFE-11:** Como Tech Lead, quero aplicar uma disposição a casos equivalentes em outras PRs do mesmo repositório.

### P3

- **LIFE-12:** Como organização, quero compartilhar decisões entre usuários e equipes.
- **LIFE-13:** Como mantenedor, quero usar feedback revisado como dataset de avaliação no Benchmark Lab.
- **LIFE-14:** Como usuário, quero receber sugestão de disposição baseada em decisões anteriores, sempre exigindo confirmação.

## Requisitos funcionais P1

| ID | Requisito |
| --- | --- |
| FL-01 | O sistema deve reconciliar findings `fail` e `warning` ao concluir o `report_ready`. |
| FL-02 | O matching deve ser limitado ao mesmo usuário, owner, repositório e número da PR. |
| FL-03 | O sistema deve usar fingerprint versionado e determinístico, sem chamada de LLM. |
| FL-04 | Finding sem caso anterior deve ser classificado como `new`. |
| FL-05 | Caso ativo observado novamente deve ser classificado como `recurring`. |
| FL-06 | Caso `resolved` observado novamente deve ser classificado como `reopened`. |
| FL-07 | Caso ativo não observado por um reviewer concluído deve gerar evento `not_observed` e ficar `resolved`. |
| FL-08 | Reviewer ausente ou execução incompleta não pode resolver casos daquele reviewer. |
| FL-09 | O usuário deve poder definir `unreviewed`, `accepted_risk` ou `false_positive`; `false_positive` exige nota e `accepted_risk` aceita nota opcional. |
| FL-10 | Toda mudança de disposição deve ser auditável e restrita ao dono do caso. |
| FL-11 | O relatório deve expor resumo de lifecycle e metadados por finding observado. |
| FL-12 | A API deve permitir paginação por cursor e filtro das visões de lifecycle. |
| FL-13 | Findings reconhecidos devem ser omitidos de novas publicações inline, sem alterar score ou relatório original. |
| FL-14 | Se lifecycle falhar, o sistema deve concluir o fluxo original e expor o estado `unavailable`. |
| FL-15 | A primeira reconciliação pode semear somente a análise concluída imediatamente anterior como baseline. |

## Requisitos não funcionais

### Determinismo

- O mesmo conjunto de findings, fingerprint version e baseline deve produzir a mesma reconciliação.
- Severidade não participa da identidade; um caso que muda de `warning` para `fail` continua sendo o mesmo caso.
- O material normalizado e o motivo do match devem ser auditáveis.

### Desempenho

- A reconciliação P1 não pode adicionar chamadas a LLM, GitHub, Neo4j ou Redis.
- Para uma análise com até 200 findings acionáveis e histórico da PR com até 1.000 casos, p95 da reconciliação deve ficar abaixo de 500 ms no ambiente local de referência.
- A listagem deve ter limite padrão 50 e máximo 100.

### Segurança e privacidade

- Toda consulta e mutação deve ser escopada ao `requestedBy` autenticado.
- Justificativas são conteúdo privado e não devem ser publicadas no GitHub no MVP.
- Logs não devem incluir título, detalhe, código ou nota integral.

### Compatibilidade

- Análises antigas sem lifecycle continuam abrindo normalmente.
- O contrato atual de `report.comments` permanece aditivo.
- Clientes antigos ignoram os novos campos sem quebrar.

## Métricas de sucesso

### Métricas de produto

- Pelo menos 80% dos usuários do dogfood identificam o delta principal sem abrir duas análises lado a lado.
- Redução de pelo menos 40% em comentários inline republicados sem mudança material.
- Pelo menos 30% das PRs com duas ou mais execuções recebem uma ação de lifecycle ou apresentam ao menos um caso não observado.
- Taxa de reversão de disposição inferior a 10% no dogfood inicial.

### Métricas de confiança

- 100% dos cards recorrentes exibem o caso e a ocorrência anterior que sustentaram o match.
- Zero caso resolvido automaticamente quando seu reviewer não concluiu a análise.
- 100% das mudanças de disposição possuem registro de auditoria.

## Fora de escopo do MVP

- Matching entre PRs diferentes.
- Decisões compartilhadas entre usuários ou organizações.
- Similaridade por embeddings ou LLM.
- Treinamento ou alteração automática de prompts.
- Recalcular score ou veredito após feedback humano.
- Reabrir ou resolver issues do GitHub.
- Provar que código foi corrigido.
- Backfill completo de todas as análises históricas.
- Exclusão e retenção configurável de casos.
- Dashboard agregado por repositório.

## Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Dois findings diferentes recebem o mesmo fingerprint | Âncoras estáveis, versionamento, escopo por PR e fallback conservador |
| Mesmo problema recebe fingerprint diferente após pequena mudança textual | Tornar o fallback explícito; matching manual fica em P2 |
| “Não observado” é interpretado como “corrigido” | Vocabulário obrigatório e explicação na UI |
| Feedback esconde risco importante | Manter score, relatório e aba de reconhecidos; suprimir apenas republicação |
| Falha de persistência derruba a análise | Lifecycle fail-open depois do `report_ready` |
| Histórico aumenta volume de dados | Índices por usuário/PR/fingerprint e paginação por cursor |

## Rollout recomendado

1. Persistir cases, ocorrências e eventos sem alterar a UI ou o GitHub.
2. Exibir lifecycle somente na análise interna.
3. Liberar ações de disposição com auditoria.
4. Suprimir republicação no GitHub apenas após validar o matching no dogfood.
5. Medir métricas antes de expandir o escopo para todo o repositório.

## Gate de lançamento

1. Duas análises fixture da mesma PR classificam corretamente `new`, `recurring`, `reopened` e `not_observed`.
2. Reviewer ausente não resolve nenhum de seus casos.
3. Alterar somente a severidade preserva a identidade do caso.
4. Risco aceito e falso positivo continuam visíveis no Cast e deixam de ser republicados no GitHub.
5. Repetir a mesma reconciliação não duplica ocorrência nem evento.
6. Falha forçada no lifecycle mantém a análise e seu relatório acessíveis.
7. Usuário diferente recebe `404` ao tentar ler ou alterar um caso que não possui.

## Rastreabilidade

| História | Requisitos | Status |
| --- | --- | --- |
| LIFE-01 | FL-01 a FL-06, FL-11 | Pendente |
| LIFE-02 | FL-07, FL-08, FL-11 | Pendente |
| LIFE-03 | FL-09, FL-10 | Pendente |
| LIFE-04 | FL-02, FL-09, FL-10 | Pendente |
| LIFE-05 | FL-11, FL-12 | Pendente |
| LIFE-06 | FL-14 | Pendente |
| LIFE-07 | FL-13 | Pendente |
