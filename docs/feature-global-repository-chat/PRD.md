# PRD: Chat Global e Chat por Repositório

**Status:** Proposto

**Data:** 2026-08-29

**Prioridade:** P1

**Substitui:** o modo de chat por projeto do [Chat sobre Repositório e Projeto](../feature-repo-chat/PRD.md).

## Resumo executivo

O Cast terá duas superfícies conversacionais, ambas fundamentadas exclusivamente nos índices de código autorizados do usuário:

1. **Chat global** em `/chat`, para descobrir quais repositórios indexados existem e investigar um ou mais deles sob demanda.
2. **Chat do repositório** em `/repos/:owner/:repo/chat`, para investigar um único repositório em um SHA congelado.

O modo de projeto é removido. Ele mistura contexto demais antes de o usuário ou o agente saberem onde investigar. O chat global começa sem catálogo nem grafo no prompt: o agente recebe um protocolo para consultar o catálogo paginado de índices e só materializa grafos quando há uma razão explícita. Isso reduz custo, preserva a fronteira de credenciais e torna a resposta auditável.

O usuário pode indicar um repositório indexado diretamente no compositor com `/`. As evidências deixam de ocupar a resposta inteira: ficam recolhidas por padrão em uma seção organizada e expansível. Chats e análises passam a usar `gpt-5.4-mini` como modelo inicial, mantendo a possibilidade de informar outro modelo aceito pela chave OpenAI do usuário.

## Problema

O chat atual exige que o usuário escolha um repositório ou projeto antes de iniciar. Isso força uma decisão de escopo antes da descoberta e entrega todos os membros de um projeto ao agente mesmo quando só um é relevante. Ao mesmo tempo, a lista usada para escolher o escopo mistura repositórios indexados e não indexados, que não podem responder perguntas.

O resultado é fricção para começar, contexto desnecessário e pouca legibilidade das evidências. O usuário precisa poder perguntar de forma ampla, descobrir o que está disponível e afunilar a investigação sem o agente receber todos os grafos ou perder as garantias de autorização.

## Objetivos

- Permitir descoberta e investigação entre repositórios indexados sem pré-carregar todos eles no contexto do modelo.
- Manter uma experiência rápida e explícita para perguntas sobre um repositório conhecido.
- Garantir que toda evidência continue verificável por repositório, arquivo, linha e símbolo.
- Tornar o modelo usado visível e selecionável, com `gpt-5.4-mini` como padrão de análise e chat.
- Reduzir o ruído visual das evidências sem escondê-las.

## Fora de escopo

- Chat por projeto e ferramentas de relação cross-repo baseadas em um projeto.
- Indexação, reindexação, edição de código, abertura de PR ou qualquer ação de escrita pelo chat.
- Busca semântica/embeddings ou envio de todos os índices ao LLM para busca global.
- Persistir chaves OpenAI, GitHub ou grants internos em threads ou mensagens.
- Criar uma lista nova de repositórios para a tela de Repositórios; o filtro é uma opção do GET existente.

## Públicos e cenários

| Cenário | Experiência desejada |
| --- | --- |
| Desenvolvedor não sabe por onde começar | Abre `/chat`, pede ao agente os repositórios indexados ou digita `/` para selecionar um. |
| Desenvolvedor já sabe o repositório | Abre a aba Chat daquele repositório e pergunta sem selecionar escopo. |
| Desenvolvedor compara custo/qualidade | Escolhe outro modelo no compositor; a resposta mostra o modelo e o uso registrados. |
| Revisor confere uma conclusão | Expande Evidências e abre o arquivo/linha ou símbolo correspondente. |

## Experiência do produto

### 1. Chat global

`/chat` cria threads do tipo `global`. A thread não contém uma lista congelada de repositórios nem envia esse catálogo no system prompt. O agente aprende, pelo prompt operacional, que deve chamar `list_indexed_repositories` quando precisar descobrir o escopo.

A ferramenta lista resultados pequenos, paginados e filtráveis por nome. Após receber um `repoId`, as demais ferramentas carregam apenas o grafo daquele repositório e SHA. Se um novo repositório for indexado, ele aparece na próxima chamada à ferramenta de catálogo; não é necessário criar outra thread.

No início de uma mensagem, digitar `/` abre autocomplete de `GET /repositories?indexed=true`. Selecionar uma opção insere a marcação canônica `/owner/repo`. Ela dá ao agente uma pista explícita para a mensagem atual, mas não transforma a thread global em uma thread congelada nem expõe a lista inteira ao modelo. A marcação aceita um repositório por mensagem.

### 2. Chat do repositório

A navegação de um repositório indexado inclui a aba `Chat`. Ela abre `/repos/:owner/:repo/chat`, cria/lista somente threads daquele repositório e preserva o comportamento de SHA congelado por thread. Não há seletor de projeto nem seletor de repositório nessa tela.

Uma aba de chat de repositório sem índice deve explicar que o repositório precisa ser indexado antes de criar uma conversa. O chat nunca dispara a indexação automaticamente.

### 3. Modelo

O compositor mostra um campo de modelo editável, iniciado em `gpt-5.4-mini`. O usuário pode escolher sugestões ou informar um identificador compatível com sua chave OpenAI, tal como no Benchmark Lab. O modelo é enviado por mensagem e persistido nas mensagens do usuário e assistant para auditoria. O mesmo padrão passa a ser o default das novas análises.

### 4. Evidências

Cada resposta assistant mostra um único controle `Evidências · N`, fechado inicialmente. Ao expandi-lo, as citações são agrupadas por repositório e ordenadas por caminho e linha. Cada item apresenta caminho, linha e símbolo, com links para o grafo quando houver `symbolId` e para o permalink GitHub do SHA congelado quando disponível. A ausência de evidência continua explícita; o componente não cria links nem caminhos inferidos.

## Requisitos funcionais

**GRC-01** `GET /repositories` preserva sua resposta atual por padrão. Com `?indexed=true`, ele retorna somente repositórios aos quais o usuário tem acesso e que possuem SHA indexado; um índice stale continua elegível porque ainda é uma versão consultável.

**GRC-02** `/chat` permite criar, listar, abrir, renomear e apagar threads globais sem seleção inicial de repositório ou projeto.

**GRC-03** O agente global disponibiliza `list_indexed_repositories(query?, limit?, cursor?)` e não recebe a lista inteira de repositórios no prompt, no histórico ou em uma chamada sem ferramenta.

**GRC-04** As ferramentas de leitura globais só podem carregar um `repoId` retornado pelo catálogo autenticado ou indicado pela marcação validada da mensagem. O backend revalida autorização e estado indexado ao consultar o catálogo e antes de entregar um SHA/grafo.

**GRC-05** Digitar `/` no começo de uma mensagem global oferece autocomplete de até 30 repositórios de `GET /repositories?indexed=true`; selecionar um insere `/owner/repo` e a UI não envia a lista de sugestões ao modelo.

**GRC-06** O chat por repositório fica disponível como aba para um repositório e cria threads com SHA congelado. O modo de criação e seleção por projeto deixa de ser exposto pela UI e pela API pública de criação.

**GRC-07** O compositor de chat permite selecionar ou digitar um modelo por mensagem e usa `gpt-5.4-mini` inicialmente. As novas análises usam o mesmo default.

**GRC-08** Toda resposta assistant persiste o modelo que a produziu, seu uso de tokens/custo, tool calls, citações e informação de truncamento.

**GRC-09** Evidências aparecem em disclosure fechado inicialmente, agrupadas e navegáveis, sem mudar as citações persistidas nem ocultar o contador.

**GRC-10** O system prompt do chat global define um protocolo de investigação: descobrir escopo somente quando necessário; limitar a busca a poucos repositórios; obter evidência com ferramenta antes de afirmar; declarar lacunas; responder em português sem inventar fontes.

## Requisitos não funcionais

**GRC-N01 — Orçamento de contexto.** O catálogo retorna no máximo 20 entradas por chamada do agente. Cada retorno contém apenas `repoId`, SHA curto, estado e cursor; nomes de arquivo e corpos de símbolos continuam submetidos aos limites existentes. O agente pode manter no máximo três workspaces carregados por mensagem; ao ultrapassar, deve pedir refinamento ou descartar o menos recente e registrar truncamento.

**GRC-N02 — Segurança.** A AI API nunca recebe token GitHub. O catálogo global é resolvido pelo backend por grant interno de curta duração, exclusivamente em runtime de ferramenta, e revalida acesso do usuário. O grant não pode entrar no prompt, nos tool arguments do LLM, nos eventos SSE, no Postgres ou nos logs.

**GRC-N03 — Latência.** Uma pergunta de repositório continua a carregar um único grafo. No chat global, o custo de catálogo é pago somente quando a ferramenta é chamada e pode ser interrompido pelo cancelamento da stream.

**GRC-N04 — Compatibilidade.** Threads de repositório existentes continuam legíveis. Threads históricas de projeto são mantidas no banco, mas não são criadas nem listadas pela experiência nova até que se defina uma política explícita de arquivamento/migração.

## Métricas de sucesso

- Nenhum catálogo completo de repositórios indexados é adicionado ao prompt de uma mensagem global.
- 100% dos repositórios retornados por `?indexed=true` têm SHA consultável no momento da resposta.
- 100% das respostas sobre código mantêm pelo menos uma evidência válida, ou declaram insuficiência de evidência.
- Uma seleção com `/` fica utilizável por teclado e leva no máximo uma requisição debounced ao endpoint filtrado.
- O modelo e custo de cada resposta ficam visíveis na thread reaberta.

## Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Catálogo global vaza repositórios | Grant efêmero, revalidação no Nest e paginação; AI API não consulta GitHub. |
| Muitos grafos esgotam memória/contexto | Carga preguiçosa, máximo de três workspaces e limites por tool. |
| O LLM tenta usar repositório inventado | Ferramentas exigem validação de catálogo e devolvem erro seguro. |
| Modelo inválido gera falha confusa | Validar campo não vazio; propagar erro da OpenAI como evento de chat sem gravar resposta assistant. |
| Evidências recolhidas parecem ocultas | Contador sempre visível, link navegável e estado acessível por teclado. |
