# PRD 01 — Eval Harness, Golden Dataset e LLM-as-Judge

**Status:** Proposta
**Prioridade:** 1 (fazer primeiro)
**Área:** `apps/ai-api`
**Esforço:** M (~3–5 dias)

---

## Problema

Hoje não existe forma de responder três perguntas que qualquer avaliador técnico faz:

1. "Trocar `gpt-5-mini` por `gpt-5` melhora a review ou só encarece?"
2. "Esse ajuste de prompt no `test_reviewer` melhorou ou piorou?"
3. "Quantos findings são falso positivo?"

Os testes atuais (`apps/ai-api/tests/`) provam que o **código** funciona (scoring, parsing, fallback quando não há teste). Nenhum prova que a **review é boa**. É exatamente a lacuna que separa "usei a API da OpenAI" de "sou AI Engineer" — evals são o sinal #1 de experiência real com LLM em produção segundo o mercado de 2026.

## Objetivo

Uma suíte de eval versionada no repositório que roda o pipeline inteiro contra PRs reais congeladas, pontua o resultado com métricas determinísticas + LLM-as-judge, e falha o CI quando o score cai abaixo de um baseline commitado.

Critério de pronto: `pytest -m eval` roda offline com fixtures gravadas e `make eval` roda contra a API real produzindo um relatório comparável entre execuções.

## Por que é bom pro portfólio

Praticamente nenhum portfólio tem eval harness. Saber falar de viés de LLM-as-judge, curadoria de golden dataset e alinhamento juiz↔humano é discurso de top 5%. E aqui tem um bônus: o produto **é** um avaliador, então avaliar o avaliador é meta-coerente e rende uma boa seção de README.

---

## Escopo

**Dentro:**
- Golden dataset de 20–30 casos, cada um = diff real + `conventions.md` + rótulo esperado.
- Runner que executa o grafo (ou um agente isolado) por caso e agrega métricas.
- Métricas determinísticas (baratas, sem LLM) + juiz LLM para as dimensões subjetivas.
- Baseline commitado (`baseline.json`) e comando de comparação com limiar de regressão.
- Modo `record/replay` de chamadas LLM, pra rodar eval no CI sem gastar API key.
- Página/seção no README com a tabela de resultados por modelo.

**Fora:**
- Plataforma externa (Braintrust/LangSmith). Fica como nota de "o que eu usaria em produção".
- Fine-tuning ou otimização automática de prompt.
- Anotação humana em UI. Rótulos vêm de arquivo YAML, revisados manualmente.

---

## Golden Dataset

Estrutura proposta:

```
apps/ai-api/evals/
  dataset/
    001-missing-test-for-rule/
      case.yaml
      diff.patch
      conventions.md
      files/            # fullContent dos arquivos alterados
    002-convention-violation-layering/
    ...
  cassettes/            # respostas LLM gravadas (replay no CI)
  runner.py
  metrics.py
  judge.py
  baseline.json
```

`case.yaml`:

```yaml
id: 001-missing-test-for-rule
description: PR adiciona regra de expiração de token sem teste correspondente
source: https://github.com/<owner>/<repo>/pull/42
category: test_coverage        # test_coverage | convention | clean_pr | adversarial
expect:
  verdict: request_changes
  min_fails: 1
  reviewers:
    test_reviewer:
      must_flag_rules:
        - "token expirado deve ser rejeitado"
      max_score: 85
    architecture_reviewer:
      max_findings: 0
  must_not_flag:                # anti-falso-positivo
    - "formatação"
```

Composição alvo (30 casos):

| Categoria | Qtd | Papel |
|---|---|---|
| `test_coverage` | 8 | regra de negócio sem teste → deve dar `fail` |
| `convention` | 8 | viola linha específica do `conventions.md` |
| `clean_pr` | 8 | PR correta → **deve aprovar**; mede falso positivo |
| `adversarial` | 6 | diff com prompt injection, diff gigante, arquivo binário, PR só de docs, rename em massa, arquivo sem extensão conhecida |

Os ~25% adversariais/negativos são o que dá honestidade ao dataset — dataset só de caso feliz não mede nada.

## Métricas

**Determinísticas (sem LLM, rodam sempre):**

| Métrica | Definição | Meta inicial |
|---|---|---|
| `verdict_accuracy` | veredito previsto == esperado | ≥ 0.80 |
| `rule_recall` | regras em `must_flag_rules` efetivamente sinalizadas | ≥ 0.85 |
| `false_positive_rate` | findings `fail` em casos `clean_pr` ÷ total de findings | ≤ 0.10 |
| `convention_grounding` | findings de arquitetura com `conventionRef` válido apontando pra linha existente | = 1.00 |
| `schema_validity` | respostas do LLM que parseiam como JSON no 1º try | ≥ 0.98 |
| `cost_per_review_usd` / `p95_latency_s` | via `usage.py` já existente | tracking |

`convention_grounding = 1.00` é dura de propósito: a regra de negócio 3 do PRD principal diz que o architecture reviewer **só pode** reportar citando convenção. Eval que verifica que a citação existe de fato no arquivo transforma uma regra escrita em regra medida.

**LLM-as-judge (dimensões subjetivas):**
- `finding_usefulness` (1–5): o finding é acionável ou é ruído genérico?
- `spec_faithfulness` (1–5): a Implementation Spec descreve o que o diff realmente faz, sem alucinar contrato?

Regras do juiz, pra ele não virar mais uma fonte de inconsistência:
- modelo, rubrica e `temperature=0` fixos e versionados; mudar rubrica = novo `judge_version`;
- juiz recebe rubrica com âncoras concretas por nota, não "avalie a qualidade";
- juiz **nunca** é o mesmo modelo que gerou a saída avaliada (evita self-preference bias);
- 10 casos com nota humana em `human_labels.yaml`; reporta-se a correlação juiz↔humano. Se cair abaixo de 0.7, o juiz é declarado não confiável e a métrica é ignorada no gate.

## Runner e gate de CI

```bash
python -m evals.runner --dataset evals/dataset --model gpt-5-mini --out evals/runs/<ts>.json
python -m evals.runner --compare evals/runs/<ts>.json --baseline evals/baseline.json --tolerance 0.03
```

- `--replay` (default no CI): usa `cassettes/`, custo zero, determinístico.
- `--record`: chama a API real e grava. Rodado localmente ao mudar prompt.
- Gate: falha se qualquer métrica determinística cair mais que a tolerância vs. baseline.
- Toda run salva timestamp + modelo + hash dos prompts → dá pra responder "quando isso começou a piorar?".

Aproveita o que já existe: `tests/llm_fakes.py` já injeta `LlmResult` com usage conhecido; o cassette é a evolução natural disso (grava usage real em vez de `prompt=12`).

## Design técnico

- `evals/runner.py` — carrega casos, monta `AgentRunRequest`, consome `run_pipeline`, coleta o evento `report_ready`. Reusa os DTOs de `app/application/dto/schemas.py`, sem HTTP.
- `evals/cassette.py` — camada de gravação/replay sobre `complete_json` (chave = hash de `system+user+model`). Precisa injetar o client, então: extrair `complete_json` para um protocolo passado via estado ou `contextvar`, em vez de import direto nos agentes. Refactor pequeno e que melhora o desenho.
- `evals/metrics.py` — puro, testável, sem rede.
- `evals/judge.py` — usa o mesmo `complete_json`, com prompt em `evals/prompts/judge.md`, versionado.
- CI: workflow `evals.yml` rodando `--replay` em todo PR; job semanal opcional com `--record`.

## Riscos

| Risco | Mitigação |
|---|---|
| Dataset vira "diff que eu inventei" e não mede nada real | Casos vêm de PRs públicas reais, com URL de origem no `case.yaml` |
| Cassette desatualiza silenciosamente após mudança de prompt | Chave do cassette inclui hash do prompt; miss → falha explícita pedindo `--record` |
| Juiz LLM caro/instável | Só 2 dimensões, só nos casos onde a métrica determinística não decide; correlação com humano publicada |
| Não-determinismo mesmo com temperature=0 | Métricas agregadas sobre 30 casos + tolerância de 3% no gate |

## Métricas de sucesso da feature

- Tabela no README com ≥ 3 modelos comparados em qualidade **e** custo — esse é o entregável de portfólio.
- Um caso documentado de regressão pega pelo eval antes do merge.
- `pytest -m eval` verde, offline, em < 60s.
