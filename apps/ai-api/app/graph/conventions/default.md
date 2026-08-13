# Convenções Cast Review (padrão da casa)

Use este documento quando o repositório não tiver `conventions.md`.
Cite a regra com o texto exato ao apontar um finding.

## Fronteiras
- Controller HTTP é porta fina: não valida regra de negócio, não gera id, não escreve SSE na mão.
- Domain não importa infrastructure, HTTP nem cliente de LLM.
- Graph/orquestração não persiste banco; persistência fica no Nest.
- Frontend nunca chama o serviço Python direto.

## Segredos
- apiKeys nunca vão para log, banco, evento SSE persistido ou markdown do relatório.
- Token GitHub nunca aparece em resposta HTTP.

## Score e findings
- Score é calculado em código (100 − 15×fail − 5×warning). O LLM não inventa a nota.
- Finding de arquitetura precisa de conventionRef citando este arquivo ou o conventions.md do repo.
- Sem teste cobrindo uma regra de negócio extraída da spec, o Test Reviewer marca fail.

## Idioma e UX
- Erro e texto visível ao usuário final em português.
- Relatório final precisa de veredito (aprovar / comentar / pedir mudanças), não só scores soltos.

## Testes
- Pipeline, scoring e atalhos determinísticos têm teste sem rede.
- Mudança de contrato HTTP (payload/evento) precisa de teste de rota.

## Estrutura
- Módulo Nest concentra entity, repository, service e migration daquele domínio.
- Agente LLM vive em pasta própria com prompt.md e skills/.
- Node sem LLM (change analyzer, report builder) não chama OpenAI.
