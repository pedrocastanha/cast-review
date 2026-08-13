# Change Analyzer — máquina, não modelo

## Por que este passo existe
Antes de gastar token, o pipeline precisa saber *que tipo de arquivo* a PR mexeu.
Isso decide atalhos: sem teste → Test Reviewer não chama OpenAI; sem conventions o Architecture também não.

## Trabalho (um só)
Classificar cada path em `test` | `migration` | `config` | `source`.
Calcular `hasTests` e `hasMigration`.

## O que isto NÃO é
Não é um agente de IA. Não descreve produto. Não extrai regras. Não dá nota.

## Output
```json
{
  "files": [{ "path": "src/a.ts", "kind": "source", "extension": ".ts" }],
  "hasTests": false,
  "hasMigration": false
}
```
