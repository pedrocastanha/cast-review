# PRD: Cross-Repo Impact Review

**Status:** Implemented — validation in progress

**Data:** 2026-08-25

**Prioridade:** P1 — próximo passe do Cross-Repo Core
**Dependência:** [Cross-Repository Impact](../feature-cross-repo-impact/PRD.md)

## Resumo executivo

O Cast já consegue provar relações HTTP entre repositórios de um mesmo projeto. O próximo passo é usar esse conhecimento durante a revisão de uma pull request para responder: **“se esta mudança entrar, quais outros repositórios podem ser afetados e qual é a evidência?”**

A validação multi-repo será **opcional por execução**. Toda nova análise começa em `Apenas esta PR`, preservando custo, latência e comportamento atuais. Quando a PR pertencer a um projeto elegível, o usuário poderá ativar `Verificar impacto em outros repositórios`, escolher o projeto quando houver mais de um e visualizar previamente quais índices entrarão na análise.

## Problema

Uma revisão isolada identifica riscos dentro do repositório alterado, mas não vê consumidores ou provedores mantidos em outros repositórios. Isso é especialmente perigoso em mudanças de contratos HTTP: uma rota removida no backend pode continuar sendo chamada pelo frontend sem que qualquer arquivo do frontend apareça no diff.

Executar sempre uma análise multi-repo também seria errado. Muitas PRs são locais, alguns usuários não possuem projetos configurados e contexto adicional aumenta tokens, latência e ruído. O produto precisa oferecer profundidade sem transformar essa profundidade em custo obrigatório.

## Hipótese de produto

Se o Cast permitir ativar impacto multi-repo apenas quando necessário, mostrar o custo contextual antes da execução e devolver evidências reproduzíveis, então engenheiros poderão detectar riscos de integração sem perder a simplicidade da review local.

## Usuários e jobs-to-be-done

| Usuário | Necessidade |
| --- | --- |
| Autor da PR | Saber se uma alteração local exige mudanças coordenadas em outros serviços |
| Revisor | Validar o blast radius sem conhecer todos os repositórios do sistema |
| Tech Lead | Auditar por que o agente classificou uma integração como impactada |
| Engenheiro de plataforma | Comparar modelos usando o mesmo contexto multi-repo congelado |

## Princípios do produto

1. **Opt-in real:** desligado por padrão em cada nova execução.
2. **Zero surpresa:** ativar a opção nunca dispara indexação silenciosa.
3. **Fail-open:** falhas no contexto cross-repo não impedem a análise local.
4. **Evidência antes de inferência:** método, rota, arquivos, linhas e SHAs sustentam toda relação.
5. **Reprodução:** o usuário vê posteriormente o mesmo subgrafo usado pelo agente.
6. **Impacto não é quebra comprovada:** o Cast comunica risco potencial e nível de evidência.

## Experiência proposta

### 1. Escolha do escopo

Na tela de execução da análise haverá uma seção `Escopo da análise`:

- `Apenas esta PR` — padrão, fluxo e custo atuais.
- Toggle `Verificar impacto em outros repositórios` — disponível somente quando o repositório da PR pertence a pelo menos um projeto do usuário com dois ou mais membros ativos.

Ao ativar o toggle:

- Se houver um único projeto elegível, ele será pré-selecionado.
- Se houver vários, o usuário deverá escolher um.
- A UI mostrará quantidade de repositórios, índices prontos, índices ausentes/desatualizados e aviso de possível aumento de tokens e latência.
- Repositórios indisponíveis não serão indexados automaticamente; haverá um link para preparar o projeto antes da análise.

O toggle não será salvo como preferência global. Cada nova execução exige uma decisão explícita. Retomadas preservam o escopo imutável da execução original.

### 2. Detecção do impacto

Quando o modo multi-repo estiver ativo, o Cast irá:

1. Obter os conteúdos base e head dos arquivos alterados.
2. Extrair os contratos HTTP antes e depois da PR.
3. Classificar contratos como `added`, `removed`, `modified` ou `touched`.
4. Consultar, nos SHAs congelados dos outros repositórios, consumidores e provedores compatíveis.
5. Priorizar riscos de quebra, mudanças comportamentais e chamadas sem provedor conhecido.
6. Entregar ao agente somente o contexto selecionado dentro do orçamento configurado.

### 3. Resultado da review

A análise terá uma seção `Impacto entre repositórios` com:

- Modo solicitado e modo efetivamente executado.
- Projeto e SHAs utilizados.
- Repositórios incluídos, omitidos e motivo da omissão.
- Contratos alterados.
- Repositórios e arquivos potencialmente afetados.
- Direção da relação: consumidor → provedor.
- Método, rota, arquivo, linha, símbolo, framework e SHA dos dois lados.
- Confiança da relação e classificação do risco.
- Indicação explícita quando o resultado estiver incompleto ou degradado.

Cada finding gerado a partir desse contexto deverá citar uma evidência existente no snapshot. Relações cross-repo não serão publicadas como comentários inline em arquivos que não pertencem à PR; elas aparecerão no relatório e, quando aplicável, no resumo publicado no GitHub.

### 4. Replay e auditoria

O snapshot persistido da análise deverá registrar:

- Escopo solicitado e efetivo.
- Projeto selecionado.
- SHA base e head da PR.
- SHA indexado de cada repositório consultado.
- Alterações de contrato detectadas.
- Nós, relações e evidências entregues ao agente.
- Orçamento, truncamento, omissões e motivo de fallback.
- Versões do indexador, query e schema.
- Hash canônico do snapshot.

Mudanças futuras no projeto ou no Neo4j não poderão alterar o replay de uma análise concluída.

## Modos de execução

| Modo | Quando ocorre | Comportamento |
| --- | --- | --- |
| Repository | Padrão ou toggle desligado | Executa exatamente a análise atual, sem consultar projeto cross-repo |
| Project exact | Toggle ligado e todos os dados necessários disponíveis | Usa o contexto local e as evidências multi-repo congeladas |
| Project degraded | Toggle ligado, mas parte do projeto está stale/indisponível | Usa somente evidências válidas e informa as omissões |
| Repository fallback | Toggle ligado, mas nenhum contexto cross-repo utilizável | Continua localmente e registra o motivo do fallback |

## Classificação do impacto

| Situação determinística | Classificação de produto |
| --- | --- |
| Provider removido/modificado com consumidores confirmados | `breaking_candidate` |
| Provider tocado, contrato preservado, com consumidores confirmados | `behavioral_candidate` |
| Consumer novo/modificado sem provider conhecido no projeto | `integration_gap` |
| Contrato adicionado ou relação sem sinal de quebra | `informational` |

Esses nomes expressam risco, não certeza. O agente não poderá transformar `candidate` em “vai quebrar” sem outra evidência verificável.

## Histórias de usuário

- **SCOPE-01:** Como autor, quero decidir se uma análise deve usar somente a PR ou todo o projeto.
- **ELIGIBILITY-01:** Como usuário, quero entender por que o modo multi-repo está disponível ou indisponível.
- **IMPACT-01:** Como revisor, quero encontrar consumidores e provedores externos afetados pelo diff.
- **EVIDENCE-01:** Como Tech Lead, quero verificar cada afirmação cross-repo nos arquivos e SHAs originais.
- **RESILIENCE-01:** Como usuário, quero receber a review local mesmo quando o grafo multi-repo falhar.
- **REPLAY-01:** Como auditor, quero reabrir exatamente o contexto usado pelo agente.
- **BENCH-01:** Como engenheiro de IA, quero comparar modelos sobre o mesmo impacto congelado.

## Requisitos P1

1. Toda nova execução começa em `Apenas esta PR`.
2. O modo multi-repo só pode usar um projeto próprio que contenha o repositório da PR.
3. Ativar o modo não pode indexar, reindexar ou alterar projetos automaticamente.
4. O modo desligado não pode consultar o grafo de projeto nem adicionar tokens cross-repo ao prompt.
5. O sistema deve comparar contratos base e head, incluindo arquivos removidos.
6. O blast radius deve usar somente relações versionadas e autorizadas.
7. Toda evidência entregue ao agente deve ser persistida no snapshot da análise.
8. Falha parcial ou total do cross-repo deve degradar a execução, não encerrá-la.
9. A UI deve diferenciar análise exata, degradada e fallback local.
10. Findings cross-repo devem citar evidência do snapshot e nunca inventar paths ou relações.

## Requisitos P2

- Salvar casos multi-repo no Benchmark Lab.
- Comparar precisão, recall, custo, tokens e latência entre modelos usando o mesmo snapshot.
- Permitir filtro de histórico por modo local, project exact, degraded ou fallback.
- Sugerir o modo multi-repo com heurísticas locais, sem ativá-lo automaticamente.

## Métricas de sucesso

- 100% dos findings cross-repo possuem caminho reproduzível até método, rota, arquivo, linha e SHA.
- O modo desligado mantém o mesmo payload contextual e a mesma quantidade de chamadas externas da análise atual.
- 100% das falhas simuladas de Neo4j/Redis/índice resultam em análise local concluída ou em erro não relacionado ao cross-repo.
- O dogfood detecta consumidores reais do frontend quando uma fixture de PR remove ou modifica um contrato do backend.
- O snapshot reaberto preserva o resultado após reindexação dos repositórios.
- O Benchmark Lab consegue executar dois modelos sobre o mesmo snapshot multi-repo sem buscar novamente o grafo vivo.

## Segurança e privacidade

- O backend valida ownership do projeto e membership do repositório antes de criar a análise.
- A AI API recebe somente os repositórios e SHAs autorizados pelo backend.
- Tokens GitHub e chaves de modelo nunca entram no snapshot.
- Código e evidências de um projeto não podem aparecer em análises de outro usuário.
- Logs registram IDs, status e métricas, nunca conteúdo integral ou segredos.

## Fora de escopo

- Ativação automática do modo multi-repo.
- Indexação automática ao iniciar uma análise.
- Matching semântico ou relações inferidas por LLM.
- Comentários inline em arquivos de outros repositórios.
- Criação automática de PRs coordenadas.
- Contract drift contínuo fora da execução de uma PR.
- Chat, memória cross-conversation, toggle Cast, roles e Kanban.
- Suporte completo a todos os protocolos; o primeiro slice reutiliza contratos HTTP suportados pelo Cross-Repo Core.

## Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Contexto extra aumenta custo e ruído | Opt-in, preflight, orçamento separado e truncamento determinístico |
| Índice stale produz confiança falsa | Mostrar SHA/staleness, degradar confiança e nunca ocultar omissões |
| Agente exagera uma relação | Vocabulário de candidatos + citação obrigatória + validação estrutural |
| Projeto grande explode o prompt | Ordenar por severidade/evidência e persistir o que foi omitido |
| Falha do grafo derruba a review | Fallback obrigatório para repository mode |
| Relação externa vira comentário inline inválido | Publicar no relatório/resumo, não em arquivo fora do diff |

## Gate de lançamento

1. Com o toggle desligado, uma análise existente continua produzindo o mesmo comportamento local.
2. Com o toggle ligado, uma fixture backend → frontend encontra ao menos um consumidor externo com evidência completa.
3. Com índice parcial e com Neo4j indisponível, a análise local continua e mostra o fallback.
4. Uma análise concluída permanece reproduzível depois que os índices vivos mudam.
5. Usuário sem acesso ao projeto recebe not found e nenhum contexto é vazado.
