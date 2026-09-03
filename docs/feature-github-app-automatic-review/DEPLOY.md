# Operar a revisão automática (CI/CD)

Guia de ponta a ponta: da criação da App no GitHub até a primeira PR revisada sozinha.

## 1. Criar a GitHub App

Em **Settings → Developer settings → GitHub Apps → New GitHub App**:

| Campo | Valor |
| --- | --- |
| Nome | `Cast Review` (o slug vira `cast-review`) |
| Homepage URL | URL do seu frontend |
| Callback URL | `https://SEU-FRONT/integrations` |
| Setup URL | `https://SEU-FRONT/integrations` — marque **Redirect on update** |
| Webhook URL | `https://SEU-BACKEND/github-app/webhooks` |
| Webhook secret | Gere com `openssl rand -hex 32` |

**Permissões (repository):**

- Contents: Read-only
- Pull requests: Read and write
- Checks: Read and write
- Metadata: Read-only

**Eventos assinados:** Pull request, Installation, Installation repositories.

Depois de criar, gere uma private key (`.pem`) e anote o App ID.

## 2. Variáveis de ambiente do backend

```bash
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=cast-review
GITHUB_APP_PRIVATE_KEY_BASE64=$(base64 -w0 cast-review.private-key.pem)
GITHUB_APP_WEBHOOK_SECRET=<o secret do passo 1>
GITHUB_APP_STATE_SECRET=$(openssl rand -hex 32)
GITHUB_WEBHOOK_PAYLOAD_RETENTION_DAYS=7
FRONTEND_URL=https://SEU-FRONT
```

`GITHUB_APP_STATE_SECRET` é opcional: sem ele o `JWT_ACCESS_SECRET` é usado. Em produção, defina o próprio.

## 3. Migrations

```bash
cd apps/backend
npm run migration:run
```

Cria `github_installations`, `github_app_repositories`, `github_webhook_deliveries`, `github_review_runs` e adiciona `origin`/`head_sha` em `analyses`.

## 4. Processos que precisam estar de pé

| Processo | Papel |
| --- | --- |
| `apps/backend` | Recebe o webhook e roda o worker da fila `github-review` |
| `apps/ai-api` | Executa a pipeline de agentes |
| Redis | Fila BullMQ |
| PostgreSQL | Persistência |

O worker roda dentro do mesmo processo Nest. Se você escalar horizontalmente, o BullMQ distribui os jobs e o `jobId` determinístico evita processamento duplo.

## 5. Ligar um repositório

1. No Cast, vá em **Integrações** e clique em `Instalar Cast Review no GitHub`.
2. Escolha a conta e os repositórios. Você volta para `/integrations` e a instalação aparece vinculada.
3. Antes de ligar qualquer repositório, configure a **chave da OpenAI** em Configurações.
4. Em cada repositório, clique em `Configurar` e defina modelos, teto mensal e branches de destino.
5. Clique em `Ligar automação`.

A automação recusa ser ligada sem chave, sem modelos ou sem teto mensal. É proposital: automação sem orçamento definido é como o custo escapa.

## 6. O que acontece a cada PR

| Momento | Efeito |
| --- | --- |
| PR aberta contra uma branch alvo | Check Run `Cast Review` aparece como *in progress*, análise roda |
| Novo commit na PR | Execução anterior vira `superseded`, nova análise roda sobre o head novo |
| Análise conclui | Check Run vira `neutral` (ou `success` se aprovado) com contagem de findings novos, recorrentes e reabertos |
| Falha do Cast | Check Run vira `failure` com o motivo — não bloqueia merge |

O check nunca é obrigatório por padrão. Torná-lo obrigatório em branch protection é uma decisão sua, e o PRD recomenda esperar medir falsos positivos antes.

## 7. Testar sem esperar uma PR real

Em **Integrações → Configurar**, o campo `Rodar PR agora` enfileira uma execução para qualquer PR aberta. O histórico de execuções logo abaixo mostra status, motivo de skip, custo e link para o relatório.

## 8. Diagnóstico

| Sintoma | Onde olhar |
| --- | --- |
| Webhook não chega | Advanced → Recent Deliveries na página da App; resposta 401 = secret errado |
| Nada é enfileirado | Histórico de execuções mostra o motivo do skip; ou a entrega ficou `ignored` |
| `configuration_required` | Falta chave da OpenAI, modelos ou teto mensal |
| `budget_exceeded` | Teto mensal atingido; aumente o valor ou espere o mês virar |
| Check não conclui | Verifique se `ai-api` e Redis estão de pé; a execução fica `running` e o retry do BullMQ tenta 3 vezes |

Reprocessar uma execução que falhou: botão `reprocessar` na linha do histórico.
