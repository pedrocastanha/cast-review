# PRD: Mapa arquitetural semântico

**Status:** P1 implementado

**Versão:** 0.3 — P1 implementado

**Data:** 2026-09-01 (revisão em 2026-09-03, implementação do P1 em 2026-09-04)

**Prioridade:** P2 — evolução do Code Graph e da inteligência de sistema
**Dependências:** indexação do Code Graph, projetos multi-repo, evidência versionada, chat e Cross-Repo Impact Review

## Resumo executivo

O Cast já representa símbolos, arquivos, chamadas, imports, testes e relações HTTP entre repositórios. Essa estrutura responde “quem chama quem?”, mas ainda exige que o usuário traduza caminhos e símbolos para conceitos do sistema: autenticação, cobrança, catálogo, identidade, entrega ou observabilidade.

O Mapa Arquitetural Semântico adiciona uma camada de significado acima do grafo técnico. Ele organiza o sistema em **capacidades**, **componentes** e **fronteiras**, mostra dependências entre essas unidades e conecta cada afirmação às evidências de código e aos SHAs que a sustentam.

O mapa não pretende descobrir sozinho a “arquitetura verdadeira”. O MVP combina sugestões automáticas com confirmação humana e distingue claramente `confirmado`, `inferido` e `não mapeado`. Uma inferência jamais será apresentada como regra arquitetural aprovada.

## Estado atual do código

O mapa semântico não parte do zero. A camada técnica que ele consome já está implementada e em uso:

| Capacidade existente | Onde | Papel no mapa semântico |
| --- | --- | --- |
| Indexação por tree-sitter | `apps/ai-api/app/code_graph/indexer.py` | Fonte dos símbolos, arquivos e relações que viram componentes candidatos |
| Grafo persistido em Neo4j | `apps/ai-api/app/code_graph/graph.py` | Substrato das arestas técnicas que sustentam dependências entre capacidades |
| Serialização para visualização | `apps/ai-api/app/code_graph/viz.py` | Agregação por diretório e expansão de vizinhança, reaproveitáveis na visão executiva |
| Endpoint de grafo | `GET /index/graph` em `apps/ai-api/app/api/routes/index.py` | Ponto de extensão para o recorte semântico |
| Relações HTTP entre repositórios | `apps/ai-api/app/code_graph/http_endpoints.py` | Evidência de dependência entre capacidades de repositórios diferentes |
| Impacto cross-repo | `apps/ai-api/app/code_graph/cross_repo_impact.py` | Blast radius técnico que o mapa traduz para capacidades |
| Snapshot versionado por SHA | `apps/ai-api/app/code_graph/snapshot.py` e `analysis-context-snapshot.entity.ts` | Base do congelamento de versão exigido por SM-10 e SM-13 |
| Render de grafo no frontend | `apps/frontend/src/pages/RepoGraphPage.tsx` com xyflow | Base da visão executiva; hoje renderiza hierarquia de diretórios com drill-down |
| Painel de contexto | `apps/frontend/src/components/analysis/GraphContextPanel.tsx` | Base do evidence inspector |
| Orçamento de contexto | `apps/ai-api/app/code_graph/budget.py` | Separação entre orçamento técnico e semântico exigida pelos requisitos não funcionais |

O que falta é exclusivamente a camada de significado: taxonomia persistida, procedência e confiança das associações, regras de fronteira, e o recorte semântico dentro do relatório de review. Nenhuma reescrita da camada técnica é necessária.

O módulo de backend correspondente não existe ainda. O padrão a seguir é o de `apps/backend/src/modules/finding-cases`, que já combina entidade, repositório e casos de uso com eventos versionados.

## Problema

O grafo técnico atual é poderoso, mas possui limites de produto:

- diretórios não correspondem necessariamente a domínios do negócio;
- nomes de arquivos não explicam responsabilidade ou criticidade;
- uma aresta técnica não informa se a dependência é permitida, inesperada ou perigosa;
- mapas grandes exigem que o usuário já saiba onde olhar;
- impacto cross-repo é expresso em endpoints e arquivos, não em capacidades afetadas;
- pessoas não técnicas não conseguem interpretar o blast radius com autonomia.

Na prática, a pergunta relevante raramente é apenas “quais arquivos mudam?”. Ela é “quais responsabilidades e produtos podem ser afetados por esta mudança?”.

## Hipótese de produto

Se o Cast traduzir evidências do grafo em capacidades e componentes confirmáveis, então desenvolvedores entenderão sistemas desconhecidos mais rápido, Tech Leads identificarão erosão arquitetural e reviews comunicarão impacto em linguagem mais próxima do negócio.

## Usuários e jobs-to-be-done

| Usuário | Necessidade |
| --- | --- |
| Desenvolvedor em onboarding | Entender rapidamente os principais domínios e pontos de entrada |
| Autor da PR | Saber quais capacidades sua mudança atravessa |
| Tech Lead | Detectar dependências proibidas e erosão de fronteiras |
| Arquiteto | Manter um mapa vivo ligado ao código, não um diagrama abandonado |
| Gestor técnico | Entender blast radius sem navegar por dezenas de arquivos |

## Modelo mental do produto

### Capacidade

Responsabilidade percebida pelo negócio ou pela plataforma, como `Autenticação`, `Cobrança`, `Catálogo` ou `Observabilidade`.

### Componente

Unidade técnica que realiza parte de uma capacidade, como um módulo Nest, pacote, aplicação ou repositório.

### Fronteira

Regra sobre como capacidades ou componentes podem se relacionar, por exemplo: `Frontend pode consumir API pública, mas não acessar persistência`.

### Evidência

Arquivo, símbolo, endpoint, import ou chamada versionada que sustenta uma associação ou dependência.

## Princípios do produto

1. **Evidência navegável:** toda associação e dependência chega ao arquivo, linha, símbolo e SHA quando disponíveis.
2. **Inferência explícita:** sugestões automáticas nunca se disfarçam de fatos confirmados.
3. **Humano define significado:** o usuário pode confirmar, editar ou rejeitar a taxonomia.
4. **Camada, não substituição:** o grafo técnico continua acessível abaixo do mapa semântico.
5. **Progressivo:** mapa parcial é útil e permitido; o sistema mostra áreas não mapeadas.
6. **Versionado:** mudanças na taxonomia e no índice não reescrevem análises históricas.
7. **Sem custo oculto:** qualquer uso de LLM para descrição/classificação é explícito e orçado.

## Experiência proposta

### 1. Primeiro mapa

Ao abrir um repositório ou projeto indexado, o usuário escolhe `Criar mapa arquitetural`. O Cast produz candidatos de componentes usando sinais já disponíveis — repositórios, diretórios, módulos, símbolos e endpoints — e apresenta uma tela de confirmação.

O usuário pode:

- criar ou renomear capacidades;
- agrupar componentes;
- mover um componente entre capacidades;
- marcar uma sugestão como confirmada;
- deixar itens como não mapeados;
- adicionar descrição curta e criticidade;
- salvar uma versão do mapa.

O MVP não exige 100% de cobertura para publicar o mapa.

### 2. Visão executiva

A visão padrão mostra capacidades como nós principais e dependências confirmadas/inferidas como arestas. Cada capacidade exibe:

- descrição;
- componentes e repositórios envolvidos;
- endpoints fornecidos e consumidos;
- criticidade definida pelo usuário;
- quantidade de dependências de entrada/saída;
- cobertura do mapeamento;
- status do índice e SHA.

O usuário pode expandir capacidade → componente → símbolo, preservando o drill-down atual.

### 3. Evidence inspector

Ao selecionar uma associação ou dependência, o painel lateral mostra:

- origem e destino;
- tipo da relação;
- confiança e origem da classificação;
- evidências técnicas;
- versão do mapa e SHAs;
- ação para confirmar, rejeitar ou editar quando autorizado.

### 4. Fronteiras arquiteturais

O Tech Lead pode declarar regras simples:

- `allow`: relação esperada;
- `deny`: relação proibida;
- `review`: relação permitida, mas que exige atenção;

As regras operam primeiro no nível capacidade → capacidade. Violações são determinísticas sobre arestas confirmadas do grafo. Relações apenas inferidas podem gerar aviso, nunca falha, no MVP.

### 5. Uso na review

Quando uma PR toca símbolos mapeados, o relatório inclui `Impacto arquitetural`:

- capacidades diretamente alteradas;
- capacidades consumidoras/provedoras alcançadas pelas evidências;
- fronteiras atravessadas;
- violações confirmadas;
- partes não mapeadas ou stale;
- link para o recorte congelado do mapa.

O mapa enriquece o contexto, mas sua indisponibilidade não bloqueia a review tradicional.

### 6. Uso no chat

O chat passa a aceitar perguntas como:

- “quais capacidades dependem de autenticação?”;
- “por que cobrança conhece identidade?”;
- “quais partes críticas não têm testes relacionados?”;
- “resuma o impacto desta PR em termos de domínio”.

Respostas continuam exigindo citações técnicas. O rótulo semântico sozinho não conta como evidência de código.

## Histórias de usuário

### P1 — MVP

- **SAM-01:** Como Tech Lead, quero criar capacidades e associar componentes do grafo.
- **SAM-02:** Como usuário, quero distinguir associações confirmadas, inferidas e não mapeadas.
- **SAM-03:** Como desenvolvedor, quero navegar de capacidade até a evidência de código.
- **SAM-04:** Como Tech Lead, quero declarar fronteiras allow/deny/review.
- **SAM-05:** Como autor, quero ver quais capacidades e fronteiras uma PR afeta.
- **SAM-06:** Como auditor, quero reabrir a versão do mapa usada numa análise.
- **SAM-07:** Como usuário, quero que falha ou mapa parcial não impeça a análise existente.

### P2

- **SAM-08:** Como arquiteto, quero comparar versões do mapa e visualizar erosão ao longo do tempo.
- **SAM-09:** Como usuário, quero descrições semânticas sugeridas por LLM com custo explícito.
- **SAM-10:** Como Tech Lead, quero atribuir owners a capacidades e notificar o grupo correto.
- **SAM-11:** Como usuário do chat, quero consultar capacidades e fronteiras como ferramentas do agente.
- **SAM-12:** Como mantenedor, quero templates de taxonomia por stack ou arquitetura.

### P3

- **SAM-13:** Como organização, quero importar/exportar modelos C4 ou Structurizr.
- **SAM-14:** Como gestor, quero relacionar capacidades a produtos, jornadas e indicadores de negócio.
- **SAM-15:** Como plataforma, quero combinar dependências estáticas com telemetria de runtime.

## Requisitos funcionais P1

| ID | Requisito |
| --- | --- |
| SM-01 | O usuário deve criar um mapa no escopo de repositório ou projeto que possui. |
| SM-02 | O mapa deve possuir versão imutável publicada e rascunho editável separado. |
| SM-03 | Capacidade deve ter nome, descrição opcional, criticidade e componentes associados. |
| SM-04 | Cada associação deve registrar origem `manual`, `rule` ou `llm` e confiança `confirmed` ou `inferred`. |
| SM-05 | O usuário deve confirmar, editar, rejeitar ou deixar sugestão não mapeada. |
| SM-06 | Toda associação automática deve citar ao menos uma evidência do índice. |
| SM-07 | A UI deve navegar capacidade → componente → evidência técnica. |
| SM-08 | O usuário deve declarar fronteiras `allow`, `deny` ou `review` entre capacidades. |
| SM-09 | Violações `deny` só podem ser confirmadas por relação técnica confirmada. |
| SM-10 | Análise de PR deve congelar a versão do mapa e o recorte efetivamente usado. |
| SM-11 | O relatório deve separar impacto confirmado, inferido, stale e não mapeado. |
| SM-12 | Mapa ausente, parcial ou indisponível deve degradar para review atual. |
| SM-13 | Mudança no mapa vivo não pode alterar uma análise histórica. |
| SM-14 | Usuário sem ownership não pode ler rascunho, mapa privado ou evidência associada. |
| SM-15 | O produto deve calcular e mostrar cobertura do mapeamento. |

## Cobertura do mapa

O MVP apresenta duas métricas diferentes:

- **Cobertura estrutural:** percentual de componentes candidatos associados a uma capacidade.
- **Cobertura da PR:** percentual de símbolos alterados na PR que alcançam uma capacidade confirmada.

Uma cobertura baixa é uma informação, não um erro. O produto nunca deve esconder o restante do sistema para fazer o mapa parecer completo.

## Requisitos não funcionais

### Confiança

- Labels visuais de `confirmado`, `inferido`, `stale` e `não mapeado` são obrigatórios.
- Toda violação apresenta regra, versão do mapa e caminho até as evidências.
- Sugestões de LLM, quando existirem, permanecem `inferred` até ação humana.

### Desempenho

- Abrir a visão executiva de até 100 capacidades/componentes agregados deve responder em p95 abaixo de 1 segundo sobre índice pronto no ambiente local de referência.
- Drill-down é carregado sob demanda; o endpoint não devolve o grafo de símbolos inteiro por default.
- Orçamentos separam contexto semântico do contexto técnico da review.

### Versionamento

- Versão publicada é imutável.
- Editar cria ou atualiza um draft.
- Publicar gera novo número e hash canônico.
- Snapshots de análise guardam versão/hash e recorte materializado.

### Segurança e privacidade

- Taxonomia pode revelar arquitetura proprietária e segue o mesmo ownership de projeto/repositório.
- Descrições, nomes e evidências não aparecem em logs integrais.
- Exportação e compartilhamento ficam fora do MVP.

## Métricas de sucesso

- Novo desenvolvedor identifica os três principais domínios e pontos de entrada em menos de 10 minutos no teste de usabilidade.
- 100% das associações automáticas exibidas possuem evidência navegável.
- 100% das violações confirmadas possuem regra e aresta técnica reproduzível.
- Dogfood encontra ao menos uma dependência arquitetural não evidente pela estrutura de diretórios.
- Review com mapa indisponível mantém o mesmo resultado base e informa a degradação.
- Pelo menos 70% dos candidatos sugeridos por regra são confirmados ou apenas ajustados no piloto.

## Fora de escopo do MVP

- Descoberta autônoma de “domínios verdadeiros”.
- Geração obrigatória de descrição por LLM durante toda indexação.
- Telemetria de runtime, traces ou service mesh.
- Modelagem C4 completa.
- Sincronização bidirecional com ferramentas externas de arquitetura.
- Ownership por equipe e notificações.
- Relações com KPIs, receita ou jornadas de cliente.
- Correção automática de violações.
- Bloqueio de merge baseado somente em relação inferida.
- Histórico visual completo de evolução arquitetural.

## Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Mapa transmite certeza falsa | Proveniência e confiança obrigatórias |
| Curadoria manual vira trabalho excessivo | Sugestões progressivas e cobertura parcial aceita |
| Taxonomia envelhece | Status stale, versionamento e revisão por delta |
| Visualização vira grafo ilegível | Agregação por capacidade e drill-down sob demanda |
| LLM aumenta custo recorrente da indexação | LLM fora do caminho obrigatório P1 |
| Regra arquitetural bloqueia caso legítimo | Modo `review`, evidência e ausência de gate automático P1 |
| Mudança semântica quebra histórico | Snapshot materializado por análise |

## Rollout recomendado

1. Taxonomia manual sobre um projeto dogfood.
2. Sugestões determinísticas de componentes por estrutura já indexada.
3. Visão executiva + evidence inspector.
4. Fronteiras em modo observação.
5. Recorte semântico na review de PR.
6. Somente após validação, ferramentas semânticas no chat e sugestões LLM.

## Faseamento de implementação

Cada fase entrega valor sozinha e não depende da seguinte para ser útil. Fases 1 a 3 já produzem um mapa navegável com detecção de violação.

| Fase | Entrega | Requisitos cobertos | Depende de |
| --- | --- | --- | --- |
| 1 | ✅ Persistência da taxonomia: mapa, capacidade, componente, associação com evidência, rascunho e versão publicada | SM-01 a SM-06, SM-13, SM-14 | índice existente |
| 2 | ✅ Sugestão determinística de componentes candidatos a partir do grafo e tela de confirmação humana | SM-05, SM-06, SM-15 | fase 1 |
| 3 | ✅ Fronteiras `allow`/`deny`/`review` e detecção determinística de violação sobre arestas confirmadas | SM-08, SM-09 | fase 1 |
| 4 | ✅ Recorte semântico congelado na análise e seção de impacto arquitetural no relatório | SM-10 a SM-12 | fases 1 e 3 |
| 5 | ✅ Visão executiva com drill-down capacidade → componente → evidência e evidence inspector | SM-07 | fases 1 e 2 |
| 6 | ⏳ Nomeação e descrição sugeridas por LLM, sempre `inferred` e com custo explícito | SAM-09 | fase 2 |

A fase 6 é a única que introduz custo recorrente e permanece fora do caminho obrigatório, conforme o princípio de sem custo oculto.

## Gate de lançamento

1. Usuário cria, publica e revisa uma nova versão sem alterar versões antigas.
2. Toda associação sugerida chega a evidência real ou é descartada.
3. Uma aresta proibida confirmada aparece na view e na review com regra reproduzível.
4. Relação inferida nunca gera violação confirmada nem bloqueio.
5. Reindexação não altera snapshots de análises concluídas.
6. Projeto parcial informa cobertura e repositórios omitidos.
7. Usuário sem acesso recebe not found sem vazamento de taxonomia.

## Rastreabilidade

| História | Requisitos | Status |
| --- | --- | --- |
| SAM-01 | SM-01 a SM-03, SM-05 | Implementado |
| SAM-02 | SM-04 a SM-06, SM-11 | Implementado |
| SAM-03 | SM-06, SM-07 | Implementado |
| SAM-04 | SM-08, SM-09 | Implementado |
| SAM-05 | SM-10 a SM-12, SM-15 | Implementado |
| SAM-06 | SM-02, SM-10, SM-13 | Implementado |
| SAM-07 | SM-12 | Implementado |
