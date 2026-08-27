# PRD: Chat sobre Repositório e Projeto

**Status:** Especificado — implementação em andamento

**Data:** 2026-08-27

**Prioridade:** P1 — primeira superfície conversacional do Cast
**Dependências:** [Code Graph Context](../feature-code-graph-context/), [Cross-Repo Impact Review](../feature-cross-repo-impact-review/PRD.md)

## Resumo executivo

O Cast já indexa repositórios em um grafo de código (símbolos, chamadas, imports, testes, endpoints HTTP) e já prova relações entre repositórios de um mesmo projeto. Hoje esse conhecimento só é consumido por dois caminhos rígidos: a análise de pull request e a visualização do grafo.

Este documento especifica uma terceira superfície: **conversa**. O usuário abre um chat no escopo de um repositório ou de um projeto e pergunta em linguagem natural. Um agente com ferramentas de leitura sobre o grafo busca o que precisa e responde **sempre com evidência** — repositório, arquivo, linha e símbolo, clicáveis para o grafo.

O chat é somente leitura no MVP. Ele não edita código, não abre PR e não dispara reindexação.

## Problema

O grafo responde perguntas que hoje ninguém consegue fazer:

- "Como funciona o fluxo de login?"
- "Quem chama `resolveAnalysisScope`?"
- "Que endpoints do backend o front não consome?"
- "Se eu mexer nesse arquivo, o que quebra?"

Nenhuma dessas perguntas cabe na UI atual. O grafo visual mostra estrutura, mas exige que o usuário já saiba onde olhar. A análise de PR só roda sobre um diff existente. Quem chega novo em um repositório — ou volta a ele depois de meses — não tem por onde começar.

O caminho alternativo hoje é o usuário abrir o código no editor e usar um assistente genérico. Isso perde exatamente o diferencial do Cast: o assistente genérico não conhece as arestas entre repositórios, não sabe qual `sha` está indexado e não cita evidência verificável.

## Público e cenários

**Desenvolvedor entrando em um repositório desconhecido.** Pergunta aberta, sem saber nomes de arquivo. Precisa de um mapa e de pontos de entrada.

**Desenvolvedor investigando uma mudança.** Já sabe o arquivo. Menciona `@src/modules/projects/projects.service.ts` e pergunta quem depende daquilo.

**Tech lead olhando um projeto multi-repo.** Pergunta sobre o contrato entre front e back. Precisa que a resposta atravesse repositórios, não pare na borda de um.

## Escopo do MVP

### Dentro

1. **Thread de chat com escopo fixo** — repositório único ou projeto (N repositórios). Escopo e `sha` congelados na criação da thread.
2. **Menção de arquivo** — `@` abre autocomplete com os arquivos do índice. O conteúdo do arquivo mencionado entra no contexto da primeira volta.
3. **Agente com ferramentas de leitura sobre o grafo** — busca de símbolo, leitura de símbolo/arquivo, vizinhança (callers/callees), listagem de arquivos, endpoints HTTP e ligações cross-repo.
4. **Citações obrigatórias** — toda afirmação sobre código carrega `repoId`, `path`, `line` e símbolo. Clicar leva ao nó no grafo.
5. **Streaming** — o usuário vê as ferramentas sendo chamadas e o texto sendo escrito, via SSE.
6. **Histórico persistido** — threads e mensagens no Postgres. O usuário reabre e continua.
7. **Aviso de índice desatualizado** — se o repositório foi reindexado depois da criação da thread, a UI avisa.

### Fora (explicitamente)

- Edição de código, sugestão de patch, abertura de PR.
- Disparo de ações com efeito colateral (reindexar, rodar análise) pelo chat.
- Busca semântica por embeddings. O agente navega o grafo; não há índice vetorial.
- Compartilhamento de thread entre usuários.
- Upload de arquivo pelo chat.
- Leitura autônoma, no meio do loop, de arquivos que não estão no índice. O agente só enxerga o que o grafo tem; arquivos não parseados (markdown, JSON, YAML) entram apenas quando o usuário os menciona.

## Requisitos funcionais

**RF-01** O usuário cria uma thread no escopo de um repositório indexado ou de um projeto com ao menos um repositório indexado.

**RF-02** A thread grava o `sha` indexado de cada repositório do escopo no momento da criação. Todas as respostas da thread se referem a esses `sha`.

**RF-03** O usuário digita `@` e recebe autocomplete dos arquivos do índice, filtrado por substring do caminho. Em thread de projeto, o autocomplete indica de qual repositório é cada arquivo.

**RF-04** Ao enviar a mensagem, o conteúdo integral de cada arquivo mencionado é resolvido e entregue ao agente. A fonte primária é o grafo; arquivos sem símbolo parseado caem no GitHub, no `sha` da thread.

**RF-05** O agente decide autonomamente quais ferramentas chamar, em até 8 iterações por mensagem. Estourou o limite, responde com o que reuniu e sinaliza que a investigação foi truncada.

**RF-06** A resposta final cita evidência. Cada citação identifica repositório, caminho, linha e — quando aplicável — símbolo.

**RF-07** O usuário vê, em tempo real: quais ferramentas foram chamadas e com quais argumentos, um resumo do que cada uma retornou, e o texto da resposta sendo escrito.

**RF-08** O usuário lista, abre, renomeia e apaga suas threads.

**RF-09** Só o autor da thread acessa a thread. O acesso ao repositório ou projeto é revalidado a cada mensagem.

**RF-10** A chave OpenAI e o modelo vêm do cliente por requisição, como já acontece em análises. Nada de chave persistida.

## Requisitos não funcionais

**RNF-01 — Custo.** Cada mensagem tem teto de iterações (8) e teto de tokens de saída de ferramenta por volta. O `usage` (tokens e custo estimado) é gravado por mensagem, reaproveitando `infrastructure/llm/pricing`.

**RNF-02 — Latência.** O primeiro evento SSE chega em até 2s. Ferramentas rodam sobre o grafo já carregado em memória, sem round-trip HTTP entre serviços por chamada.

**RNF-03 — Fronteira de credenciais.** O `ai-api` não fala com o GitHub. Qualquer conteúdo que exija o token do usuário é resolvido no backend NestJS antes da chamada.

**RNF-04 — Cancelamento.** Fechar a aba ou cancelar aborta o stream e interrompe o loop no `ai-api`.

**RNF-05 — Degradação.** Repositório não indexado dentro de um projeto não bloqueia a thread: ele é omitido, e a omissão é informada ao usuário e ao agente.

## Métricas de sucesso

- Uma pergunta aberta sobre repositório indexado é respondida com pelo menos uma citação verificável (o arquivo e a linha existem no `sha` da thread).
- Mediana de iterações de ferramenta por mensagem ≤ 4.
- Zero respostas sobre código sem citação.
- Nenhuma chamada ao GitHub originada do `ai-api`.

## Riscos

**Agente entra em loop de ferramentas.** Mitigação: teto duro de iterações, e detecção de chamada repetida idêntica (mesma tool, mesmos args) que encerra a investigação.

**Custo por mensagem imprevisível.** Mitigação: teto de iterações, truncamento do retorno de ferramenta, `usage` gravado e exibido por mensagem.

**Resposta ancorada em índice velho.** Mitigação: `sha` congelado, comparação com o `sha` atual a cada abertura da thread, aviso visível.

**Alucinação de caminho de arquivo.** Mitigação: toda citação é validada contra o grafo antes de ser gravada; citação que não resolve é descartada e a mensagem é marcada como parcialmente não verificada.
