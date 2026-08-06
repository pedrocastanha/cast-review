# PRD — Cast Review (MVP Fullstack de Portfólio)

**Versão:** 0.4
**Status:** Draft
**Contexto:** Substitui a v0.3. Consolida a arquitetura como **monólito modular** (backend único em Python), define as regras de negócio do scoring e as responsabilidades de cada agente.

---

# Visão

Cast Review é uma aplicação open source, 100% local, que permite ao usuário conectar seu GitHub, escolher uma Pull Request e rodar uma revisão automática baseada em agentes especialistas — acompanhando o progresso em tempo real, direto na tela.

---

# Objetivo do MVP

Demonstrar a ideia central do Cast Review (gerar uma especificação da implementação antes de revisar, e validar com agentes especialistas) como peça de portfólio fullstack — com uma arquitetura back-end consciente (monólito modular, não microsserviços por modismo).

**Não é objetivo do MVP:**
- ficar no ar publicamente (é "baixa e roda local")
- OAuth com GitHub (usa Personal Access Token)
- persistência robusta (in-memory / cache do navegador por padrão)
- suportar múltiplas linguagens de código-alvo
- Cast Skills dinâmico, GitNexus, múltiplos provedores de LLM, observabilidade/tracing de produção

---

# Decisão de arquitetura: NestJS orquestra, Python é o motor de agentes

O backend é dividido em dois papéis claros, não dois serviços simétricos:

- **NestJS** — monólito modular responsável por tudo que **não é IA**: autenticação (PAT), integração com GitHub (listar repos/PRs, buscar diff, ler `conventions.md` do repositório), gateway de WebSocket com o frontend, e orquestração da chamada ao serviço de agentes.
- **Python** — serviço isolado e **stateless**, responsável exclusivamente pela arquitetura de agentes: Change Analyzer, Implementation Spec, Reviewers, scoring e Report Builder. Não conhece GitHub, não conhece autenticação — só recebe o diff e as convenções já prontos, processa, e devolve o resultado via streaming.

**Motivo dessa fronteira:** o Nest concentra tudo que é infraestrutura de aplicação (onde monólito modular já se justificou antes); o Python fica isolado exatamente na parte que tem identidade própria e pode evoluir sozinha — a arquitetura de agentes (troca de modelo, novos reviewers, ajuste de prompt) sem precisar mexer no resto do sistema. Isso não é "dois microsserviços por modismo": é a divisão que faz sentido pelo critério de "domínio com ritmo de mudança e responsabilidade diferentes do resto", que é justamente o que justifica separar algo do monólito.

**Comunicação:** Python expõe um único endpoint HTTP (`POST /agent/run`) que devolve a resposta como **stream (Server-Sent Events)** — cada etapa concluída do pipeline emite um evento na mesma conexão. O Nest consome esse stream e repassa 1:1 pro front através do seu próprio WebSocket Gateway. O Python nunca abre conexão direta com o frontend.

## Contexto além do diff puro

Revisar só o diff (linhas adicionadas/removidas) é exatamente a limitação que ferramentas atuais de AI code review têm, e que o Cast Review existe pra resolver — então o payload enviado ao Python não pode ser só o diff bruto.

O Nest monta um **pacote de contexto** antes de chamar o Python:
- para cada arquivo alterado, busca o **conteúdo completo do arquivo** (não só as linhas do diff);
- resolve os imports/requires desse arquivo que apontam pra caminhos internos do repositório (heurística simples, sem AST completo);
- busca o conteúdo desses arquivos relacionados, com um limite por arquivo alterado (evita explosão de tokens/custo).

Essa é uma versão simplificada da ideia de indexação estrutural do PRD original (que usava GitNexus/Knowledge Graph completo) — resolve boa parte do problema de contexto sem exigir grafo de dependências, embeddings ou call graph completo. O Knowledge Graph de verdade continua no roadmap pós-MVP, como evolução natural desse "Context Builder".

O princípio seguido: **um módulo nunca acessa o interno de outro**, apenas a interface pública que ele expõe. Isso é o que separa um monólito modular de um "big ball of mud" — e vale ser um ponto explícito no README como decisão consciente de arquitetura, não limitação.

---

# Regras de negócio

## 1. Score é calculado, não gerado pelo LLM
Cada reviewer parte de 100 pontos e desconta por finding, com peso fixo por severidade:
- `fail` → -15
- `warning` → -5
- `pass` → 0

O LLM só decide o `status` de cada finding (identifica os fatos); a matemática do score é lógica determinística, testável sem chamar nenhuma API de IA. Isso evita notas "no chute" e inconsistentes entre execuções.

## 2. Test Reviewer avalia cobertura, não qualidade do teste
Regra: para cada `businessRule` da Implementation Spec, deve existir ao menos um teste cobrindo o cenário — se não existir, `fail`. Não entra no mérito de assertividade (exigiria coverage real de execução, fora de escopo do MVP). Decisão de escopo deliberada, documentada no README.

## 3. Architecture Reviewer só reporta violação de convenção declarada
Regra: o agente só pode sinalizar um problema se referenciar uma linha específica do `conventions.md`. Proposital — sem essa restrição, o LLM tende a opinar de forma genérica e inconsistente entre execuções, reproduzindo o mesmo problema que o Cast Review existe pra resolver.

## 4. Sem gate de aprovação automática no MVP
O relatório mostra scores lado a lado, sem bloqueio de merge (isso é V2+ do produto original). No MVP é puramente informativo.

---

# Agentes — responsabilidades e decisões

| Agente | Responsabilidade | Por que essa fronteira |
|---|---|---|
| **Change Analyzer** | Extrai fatos estruturais do diff via heurística (arquivo/extensão), não LLM | Determinístico; parsing de AST completo custaria esforço desproporcional ao ganho de demo |
| **Implementation Spec** | Traduz o diff bruto numa especificação estruturada (1 chamada de LLM) | Garante que todos os reviewers compartilhem o mesmo entendimento da mudança, evitando interpretações divergentes do diff cru |
| **Test Reviewer** | Mapeia `businessRules` → existência de teste correspondente | Escopo estreito por design (regra 2) |
| **Architecture Reviewer** | Valida contra `conventions.md` estático | Escopo estreito por design (regra 3) — sem isso vira "opinião do LLM" |
| **Report Builder** | Agrega score + findings em Markdown final | Não é agente de IA — lógica pura determinística, sem introduzir mais uma fonte de inconsistência numa etapa que só soma números e formata texto |

Apenas 2 reviewers no MVP (Test + Architecture), por escolha — poucos agentes bem calibrados comunicam mais maturidade técnica do que muitos agentes rasos.

---

# Público-alvo do MVP

Recrutadores e avaliadores técnicos que baixam o repositório, rodam localmente com sua própria API key, e testam com um PR real do GitHub em poucos minutos.

---

# Critério de sucesso

- Rodar localmente com sua própria API key e ver o fluxo completo: colar PAT → escolher PR → rodar → streaming ao vivo → relatório.
- README com GIF do fluxo completo.
- Módulos com fronteiras claras e testados (cada regra de negócio acima com teste correspondente).

---

# Roadmap pós-MVP (fora de escopo)

- OAuth com GitHub
- Persistência real e histórico entre sessões
- Mais reviewers (Security, API, Database, Performance, Documentation)
- Cast Skills dinâmico, GitNexus
- Observabilidade/tracing de produção, versionamento de prompts como código
- Extrair um módulo como serviço externo, se algum domínio justificar (ex: pipeline de IA com escala/latência divergente do resto)
