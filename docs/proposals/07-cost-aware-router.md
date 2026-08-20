# PRD 07 — Roteador de modelo consciente de custo + cache de prompt

**Status:** Proposta
**Prioridade:** 7
**Área:** `apps/ai-api`
**Esforço:** P/M (~2–4 dias)

---

## Problema

Hoje o modelo é escolhido pelo usuário na UI e aplicado igual pra todo mundo: `models.testReviewer` e `models.architectureReviewer` vêm do DTO e vão direto pro `complete_json`. Isso significa que uma PR de 4 linhas mexendo num README paga o mesmo modelo que uma PR de 800 linhas alterando o domínio. Além disso:

- `implementation_spec/agent.py` usa `state["models"]["testReviewer"]` — a Spec, que é a etapa que **todos** os reviewers dependem, herda o modelo do test reviewer por acidente, não por decisão;
- não há reaproveitamento de nada entre execuções: rodar a mesma PR duas vezes custa duas vezes;
- o prompt é montado com o conteúdo variável (diff) **antes** do conteúdo estável, o que desperdiça o cache de prompt automático da OpenAI (que exige prefixo comum — o `cached_tokens` já é rastreado em `pricing.py`, mas o prompt não é organizado pra aproveitá-lo).

A infra de medição de custo já existe e é boa (`usage.py`, `pricing.py`, `UsageStrip.tsx`). Falta usá-la pra **decidir**, não só pra reportar.

## Objetivo

Escolher o modelo por etapa com base em características determinísticas da mudança, com escalada quando a resposta for de baixa confiança, e estruturar os prompts para maximizar cache hit — com o ganho medido em USD e publicado.

## Por que é bom pro portfólio

"Otimização de custo" aparece nas listas de skill de 2026 junto com evals e observabilidade. A diferença entre citar e provar é ter um número: *"roteamento por complexidade + ordenação de prompt para cache cortaram 62% do custo por review sem perda de `rule_recall` no eval"*. Esse número só é possível porque o [PRD 01](./01-eval-harness.md) e o [PRD 03](./03-otel-genai-observability.md) existem — por isso essa feature vem depois.

---

## Escopo

**Dentro:**
- Sinal de complexidade determinístico por PR (sem LLM).
- Política de roteamento por etapa: modelo barato → escalada condicional.
- Reordenação de prompt (estável antes de volátil) para cache hit.
- Cache exato de resultado por `(agente, hash do prompt, modelo)`.
- Comparação de custo/qualidade no eval, publicada no README.

**Fora:**
- Cache semântico por embedding (nota de roadmap; cache exato resolve o caso de rerun).
- Multi-provider (Anthropic/Gemini). O `complete_json` é OpenAI-only hoje; abstrair provider é feature separada.
- Fine-tuning / distillation.

---

## Design técnico

### 1. Sinal de complexidade

`app/domain/routing/complexity.py`, puro e testável, reusando o que o `change_analyzer` já extrai:

```python
@dataclass(frozen=True)
class ChangeComplexity:
    score: float          # 0..1
    tier: Literal["trivial", "standard", "complex"]
    reasons: list[str]
```

Entradas: linhas alteradas, nº de arquivos, presença de migration (`hasMigration`, já existe), presença de teste (`hasTests`, já existe), tipo dos arquivos (config/doc vs source), profundidade do blast radius (com o [PRD 02](./02-code-graph-context.md): nº de callers afetados), e sinal de guardrail (com o [PRD 04](./04-prompt-injection-guardrails.md): injeção → nunca usa modelo fraco).

### 2. Política de roteamento

| Tier | Implementation Spec | Reviewers |
|---|---|---|
| `trivial` (só doc/config, <30 linhas) | modelo nano/mini | modelo mini |
| `standard` | mini | mini |
| `complex` (migration, >300 linhas, >10 callers) | modelo forte | forte |

**Escalada por confiança** — a parte interessante: se a resposta do modelo barato vier com sinal de baixa confiança, refaz com o modelo forte. Sinais determinísticos, sem juiz LLM:
- JSON inválido no 1º try (`parse_json_object` caiu no fallback de recorte);
- `businessRules` vazio numa PR com >50 linhas de source (sintoma clássico de spec preguiçosa);
- finding de arquitetura sem `conventionRef` válido (hoje é só filtrado fora silenciosamente em `run_architecture_reviewer` — perder o finding inteiro é pior que reperguntar);
- `finish_reason = length` (resposta truncada).

Máximo **1** escalada por etapa, registrada no `usage` como `escalated: true` e visível na UI. Isso mantém o custo de pior caso limitado e auditável.

Override do usuário continua existindo: escolher modelo na UI desliga o roteamento (modo `manual`). O default vira `auto`.

### 3. Cache

Duas camadas:

- **Prompt cache (OpenAI, automático)**: exige prefixo estável. Hoje o `_user_prompt` começa com o bloco de PRD e o diff — tudo volátil. Reorganizar para `[system fixo] + [skills fixas] + [conventions] + [diff/arquivos]`, colocando o volátil no fim. O `cached_tokens` já é lido e precificado; a mudança é só de ordem e rende ~50–90% de desconto na parte cacheada.
- **Cache exato de resultado**: chave `sha256(agent + prompt_version + model + system + user)` → resultado + usage. Persistido no Postgres. Rerodar a mesma PR sem mudança = custo zero e resposta instantânea (ótimo pra demo, e é o que torna o `--replay` do eval realista).

Invalidação: chave inclui `prompt_version` (hash dos arquivos `prompt.md` + skills carregados pelo `build_system_prompt`), então editar prompt invalida sozinho. Elegante, e resolve o problema clássico de cache velho de LLM.

### 4. Onde encaixa

- `complete_json` ganha um parâmetro `cache: CachePolicy` e emite `cache_hit` no usage.
- `usage.py` ganha `cacheHits`, `escalations`, `savedUsd` (custo evitado, estimado com as tarifas de `pricing.py`).
- `UsageStrip.tsx` mostra "economizado: $X (Y% cache)".

## Regras de negócio

1. Roteamento é determinístico: mesma PR → mesmo tier → mesmo modelo. Sem LLM decidindo modelo.
2. Escalada acontece no máximo 1x por etapa e é sempre visível no relatório.
3. Cache hit nunca serve resultado de `prompt_version` diferente.
4. Modo `manual` do usuário sempre vence o roteador.
5. Custo estimado exibido tem que bater com o custo real da API — o teste de `pricing.py` cobre as tarifas; o cache introduz o risco de contabilidade dupla e precisa de teste próprio.

## Métricas de sucesso

Medidas pelo eval do [PRD 01](./01-eval-harness.md), em tabela no README:

| | Custo/review | `verdict_accuracy` | `rule_recall` | p95 |
|---|---|---|---|---|
| Baseline (modelo forte fixo) | $X | — | — | — |
| Roteado | ≤ 0.4X | ≥ baseline − 2pp | ≥ baseline − 2pp | ≤ baseline |

Meta: **−60% de custo com perda de qualidade dentro de 2 pontos percentuais.** Se a qualidade cair mais que isso, a política está errada e o eval prova — que é o ponto de ter eval.

## Riscos

| Risco | Mitigação |
|---|---|
| Modelo barato degradar review silenciosamente | Gate de eval no CI; escalada por sinal de baixa confiança |
| Cache servindo review desatualizada | Chave inclui sha do conteúdo + `prompt_version`; TTL configurável |
| Tabela de preços desatualizar (`PRICING_AS_OF`) | Já existe o campo; adicionar teste que alerta quando a data passa de 90 dias |
| Complexidade demais para ganho pequeno | Fase 1 (só reordenar prompt pra cache) custa ~2h e já entrega ganho medível |
