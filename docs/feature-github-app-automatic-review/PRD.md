# PRD: Revisão automática via GitHub App

**Status:** Implementado (P1)

**Data:** 2026-09-01

**Prioridade:** P2 — automação e distribuição do produto
**Dependências:** revisão persistida, fila de jobs, publicação de comentários, políticas de análise e lifecycle de findings

## Resumo executivo

O Cast Review hoje é iniciado por uma ação explícita dentro da aplicação. Esse modelo é adequado para exploração e controle de custo, mas cria uma etapa separada do fluxo em que desenvolvedores já trabalham. Em PRs urgentes ou frequentes, a revisão deixa de ser executada justamente quando a consistência mais importa.

Esta feature introduz uma GitHub App instalável por usuário ou organização. Depois de o responsável ativar repositórios e definir orçamento/políticas, eventos de pull request passam a disparar análises assíncronas. O progresso e o resultado aparecem como Check Run e, conforme a política, como comentários de review.

O MVP começa em **modo informativo**: a integração nunca bloqueia merge por padrão. Gate obrigatório de branch será uma ativação posterior e explícita, depois de medir falsos positivos e confiabilidade operacional.

## Problema

O fluxo manual possui quatro limitações:

1. depende de memória e disciplina do usuário;
2. não garante cobertura consistente entre PRs;
3. exige troca de contexto para iniciar e acompanhar a revisão;
4. usa PAT pessoal para ações que, em ambiente de equipe, deveriam ter identidade e permissões próprias.

Além disso, um webhook não possui a sessão do usuário que hoje inicia uma análise. Automação exige ownership claro de instalação, configuração persistida, execução durável e limites de custo antes de ser segura.

## Hipótese de produto

Se o Cast puder ser instalado uma vez, revisar somente eventos e repositórios autorizados e entregar resultado na própria PR, então mais PRs serão analisadas, o tempo entre push e feedback cairá e o Cast passará de ferramenta consultiva para parte recorrente do processo de entrega.

## Usuários e jobs-to-be-done

| Usuário | Necessidade |
| --- | --- |
| Desenvolvedor | Receber feedback sem abandonar a PR |
| Mantenedor de repositório | Garantir cobertura mínima e política consistente |
| Tech Lead | Controlar quando a review roda, quanto custa e o que pode bloquear |
| Administrador GitHub | Conceder acesso mínimo e revogável por instalação |
| Operador do Cast | Reprocessar entregas e diagnosticar falhas sem duplicar análises |

## Princípios do produto

1. **Opt-in por instalação e repositório:** instalar a App não ativa análise automaticamente.
2. **Permissão mínima:** solicitar somente acessos necessários ao fluxo habilitado.
3. **Um SHA, uma execução lógica:** entregas duplicadas não geram reviews duplicadas.
4. **Último commit vence:** análise de SHA ultrapassado não publica resultado como atual.
5. **Modo informativo primeiro:** nenhum bloqueio implícito no MVP.
6. **Custo previsível:** automação só é ativada com modelo, orçamento e chave válidos.
7. **Identidade do produto:** publicações são feitas pela App, não pelo PAT pessoal do autor.
8. **Falha visível, merge não sequestrado:** indisponibilidade do Cast não bloqueia merge no MVP.

## Experiência proposta

### 1. Instalação

Na página de integrações, o usuário escolhe `Instalar Cast Review no GitHub`. Após concluir o fluxo no GitHub, volta ao Cast e vê:

- conta/organização da instalação;
- repositórios autorizados;
- status da conexão;
- permissões concedidas;
- quem administra a instalação no Cast.

Instalações sem vínculo com um usuário autenticado permanecem pendentes e não processam código.

### 2. Ativação por repositório

Para cada repositório autorizado, o administrador define:

- automação ligada/desligada;
- eventos: PR aberta, reaberta e novo push;
- executar ou ignorar drafts;
- modelos usados;
- escopo local ou projeto cross-repo;
- política de publicação;
- teto mensal em USD e limite por análise;
- comportamento quando índice estiver stale.

A ativação exige teste de configuração e exibe estimativa de custo baseada no histórico, quando disponível.

### 3. Execução automática

Ao receber evento elegível:

1. o Cast valida assinatura, instalação, repositório e configuração;
2. deduplica a entrega e identifica `head_sha`;
3. cria uma execução persistida na fila;
4. abre Check Run `Cast Review` como `in_progress`;
5. executa a mesma pipeline de análise manual;
6. verifica novamente se o SHA continua atual;
7. conclui o check e publica comentários conforme a política.

Novo push cancela, invalida ou deixa sem publicação a execução anterior. O histórico continua disponível no Cast como superseded.

### 4. Resultado na PR

O Check Run mostra:

- status operacional;
- veredito informativo;
- contagem de findings novos, recorrentes e reconhecidos, quando lifecycle estiver disponível;
- custo e duração;
- link para o relatório completo e contexto auditável;
- motivo de fallback ou análise incompleta.

No MVP, a conclusão do check é `neutral` ou `success` para resultados de produto e `failure` somente para falha operacional da execução. `request_changes` não vira bloqueio obrigatório automaticamente.

### 5. Controle e pausa

O administrador pode:

- pausar um repositório;
- pausar toda a instalação;
- executar manualmente uma PR;
- reprocessar uma entrega com falha;
- visualizar uso do orçamento;
- revogar o vínculo local sem depender do GitHub.

## Histórias de usuário

### P1 — MVP informativo

- **APP-01:** Como administrador, quero vincular uma instalação GitHub ao meu usuário Cast.
- **APP-02:** Como administrador, quero ativar automação apenas em repositórios escolhidos.
- **APP-03:** Como desenvolvedor, quero receber análise automática quando uma PR elegível muda.
- **APP-04:** Como desenvolvedor, quero acompanhar o estado pelo Check Run da PR.
- **APP-05:** Como administrador, quero limitar custo e pausar a automação.
- **APP-06:** Como operador, quero que webhooks repetidos sejam processados com idempotência.
- **APP-07:** Como autor, não quero receber resultado de um SHA ultrapassado.
- **APP-08:** Como usuário, quero abrir no Cast o relatório e a evidência usados pelo check.

### P2

- **APP-09:** Como Tech Lead, quero tornar o check obrigatório em branches selecionadas.
- **APP-10:** Como organização, quero compartilhar a administração da instalação com papéis distintos.
- **APP-11:** Como mantenedor, quero regras de inclusão/exclusão por path, label e autor.
- **APP-12:** Como usuário, quero comandos em comentário para reexecutar ou explicar a review.

### P3

- **APP-13:** Como organização, quero faturamento e orçamento centralizados por instalação.
- **APP-14:** Como plataforma, quero políticas herdadas por organização com override por repositório.
- **APP-15:** Como desenvolvedor, quero que o Cast abra uma PR de correção aprovada.

## Requisitos funcionais P1

| ID | Requisito |
| --- | --- |
| GA-01 | O sistema deve vincular installation ID a um usuário Cast autenticado por fluxo verificável. |
| GA-02 | O sistema deve listar somente repositórios concedidos à instalação. |
| GA-03 | Automação deve iniciar desligada em cada repositório. |
| GA-04 | Ativação exige chave/modelos válidos, política e orçamento configurados. |
| GA-05 | O webhook deve validar assinatura antes de ler ou persistir o payload. |
| GA-06 | Entrega repetida deve ser idempotente pelo delivery ID e pela chave instalação/repo/PR/SHA/configuração. |
| GA-07 | Eventos P1 são `opened`, `reopened` e `synchronize`; drafts são ignorados por default. |
| GA-08 | Execução automática deve ser assíncrona e sobreviver ao término da requisição de webhook. |
| GA-09 | Cada execução deve possuir origem `github_app`, delivery ID, installation ID e head SHA auditáveis. |
| GA-10 | O Check Run deve acompanhar queued, in progress e conclusão. |
| GA-11 | Resultado de SHA ultrapassado não pode publicar novos comentários nem concluir como check atual. |
| GA-12 | Novo push deve invalidar ou solicitar cancelamento de execução anterior da mesma PR. |
| GA-13 | Limite por run ou mensal atingido deve pular a análise com motivo explícito, sem cobrança adicional. |
| GA-14 | A App deve publicar usando token de instalação, nunca o PAT do usuário. |
| GA-15 | O usuário deve conseguir pausar repositório e instalação imediatamente. |
| GA-16 | O relatório completo deve continuar persistido e autorizado no Cast. |

## Requisitos não funcionais

### Segurança

- Segredo do webhook e chave privada da App nunca aparecem em logs ou respostas.
- Tokens de instalação são efêmeros e não são persistidos em texto claro.
- O acesso ao código é limitado à instalação e aos repositórios concedidos.
- Eventos de repositório removido ou instalação suspensa são rejeitados antes de enfileirar trabalho.
- Payload bruto tem retenção curta e configurável; metadados de auditoria permanecem.

### Confiabilidade

- O endpoint de webhook deve responder em até 2 segundos após validar e enfileirar.
- Processamento usa retry com backoff para falhas transitórias.
- Idempotência cobre redelivery manual do GitHub e retries internos.
- Falha ao atualizar Check Run não apaga o relatório persistido.

### Custo

- O sistema reserva orçamento antes de iniciar chamada a LLM.
- Execuções canceladas reportam custo já consumido, sem fingir custo zero.
- Configuração sem chave ou orçamento entra em estado `configuration_required`, não em retry infinito.

### Observabilidade

- Métricas por instalação/repositório: entregas, deduplicação, fila, duração, cancelamento, custo e falhas.
- Logs usam IDs e SHA; não incluem diff, código, comentários ou credenciais.

## Métricas de sucesso

- Mais de 80% das PRs elegíveis do dogfood recebem Check Run sem ação manual.
- Mediana entre webhook e check `in_progress` inferior a 10 segundos.
- Zero review publicada para SHA que já não é o head da PR.
- Zero análise duplicada para redelivery do mesmo evento.
- Pelo menos 50% dos checks concluídos são abertos ou geram interação no período piloto.
- Custo mensal nunca ultrapassa o teto configurado por erro de concorrência.

## Fora de escopo do MVP

- Substituição obrigatória do fluxo por PAT.
- Bloqueio automático de merge.
- Suporte a GitLab ou Bitbucket.
- Execução em pushes sem pull request.
- Correção ou commit automático.
- Administração multiusuário/RBAC completa.
- Marketplace público e cobrança SaaS.
- Comandos por comentários.
- Execução para forks quando a política de segurança não puder garantir isolamento de secrets.

## Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Automação multiplica falsos positivos | Modo informativo, lifecycle e rollout por repo |
| Webhooks duplicam custo | Dupla idempotência por delivery e execução lógica |
| Corrida entre pushes publica review velha | Head SHA check antes de toda publicação |
| Chave pertence a pessoa que sai da equipe | Estado de configuração e futuro ownership organizacional |
| Orçamento estoura por concorrência | Reserva transacional antes de enfileirar a etapa LLM |
| Permissões excessivas reduzem confiança | Manifesto mínimo e explicação de cada permissão |
| Indisponibilidade bloqueia entregas | Check não obrigatório no MVP e fail-open operacional |

## Rollout recomendado

1. Ambiente de desenvolvimento com uma App privada e um repositório fixture.
2. Shadow mode: recebe eventos e cria auditoria, sem rodar LLM.
3. Check Run sem comentários em repositórios próprios.
4. Comentários habilitados em opt-in com lifecycle.
5. Piloto com pequena organização.
6. Somente depois, avaliar check obrigatório.

## Gate de lançamento

1. Redelivery do mesmo webhook produz uma única execução lógica.
2. Push B durante análise A impede A de publicar como atual.
3. Suspender instalação ou pausar repo interrompe novos jobs.
4. Limite de custo concorrente nunca é ultrapassado nas fixtures.
5. Token de instalação é usado e expirado sem persistência indevida.
6. Falha de GitHub, fila e ai-api produz estados recuperáveis e auditáveis.
7. Usuário sem ownership não consegue ler nem alterar instalação/configuração.

## Rastreabilidade

| História | Requisitos | Status | Onde |
| --- | --- | --- | --- |
| APP-01 | GA-01, GA-02, GA-14 | Implementado | `installations.service.ts`, `installation-token.service.ts` |
| APP-02 | GA-03, GA-04, GA-15 | Implementado | `installations.service.ts`, `IntegrationsPage.tsx` |
| APP-03 | GA-05 a GA-09, GA-12 | Implementado | `webhooks.service.ts`, `review.processor.ts` |
| APP-04 | GA-10, GA-11, GA-16 | Implementado | `check-run.service.ts`, `check-run-output.helper.ts` |
| APP-05 | GA-04, GA-13, GA-15 | Implementado | `budget.service.ts`, `installations.service.ts` |
| APP-06 | GA-05, GA-06, GA-08 | Implementado | `webhooks.service.ts`, `github-app.service.ts` |
| APP-07 | GA-11, GA-12 | Implementado | `review.processor.ts` (`beforePublish`, supersede) |
| APP-08 | GA-09, GA-16 | Implementado | `analyses.origin`/`head_sha`, `ReviewRunList.tsx` |

Detalhes de implementação: [SPEC.md](./SPEC.md). Operação: [DEPLOY.md](./DEPLOY.md).

**Não implementado do P1:** `staleIndexBehavior` é persistido e configurável, mas a checagem de índice stale antes da análise não altera o fluxo — o valor fica gravado para o P2.
