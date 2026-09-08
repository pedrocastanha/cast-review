import { useEffect, useState } from 'react';
import { credentialStore, lastFour, type SessionCredentials } from '../../api/credential-store';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field } from '../ui/Field';
import { StatusDot } from '../ui/List';

function useSessionCredentials(): SessionCredentials {
  const [credentials, setCredentials] = useState(credentialStore.get());
  useEffect(() => credentialStore.subscribe(setCredentials) as () => void, []);
  return credentials;
}

function ActiveBadge({ value }: { value: string | null }) {
  if (!value) {
    return <span className="font-mono text-[11px] text-ink-faint">não informada</span>;
  }

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-pass">
      <StatusDot on />
      ativa nesta aba · ····{lastFour(value)}
    </span>
  );
}

export function EphemeralCredentials() {
  const credentials = useSessionCredentials();
  const [githubDraft, setGithubDraft] = useState('');
  const [openaiDraft, setOpenaiDraft] = useState('');

  const applyGithub = () => {
    credentialStore.setGithubToken(githubDraft);
    setGithubDraft('');
  };

  const applyOpenai = () => {
    credentialStore.setOpenaiKey(openaiDraft);
    setOpenaiDraft('');
  };

  const anyActive = Boolean(credentials.githubToken || credentials.openaiKey);

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-ink">
            Testar sem salvar nada
          </h2>
          <p className="mt-1 max-w-[62ch] text-sm leading-6 text-ink-dim">
            Use suas credenciais só nesta aba. Elas ficam na memória do navegador,
            viajam em cada requisição e somem no F5.
          </p>
        </div>
        {anyActive && (
          <Button variant="secondary" onClick={() => credentialStore.clear()}>
            Descartar agora
          </Button>
        )}
      </div>

      <ul className="mb-5 space-y-1.5 border-y border-border py-3.5 text-[13px] leading-6 text-ink-dim">
        <li>
          <span className="text-ink">Nada vai para o banco.</span> O backend não
          grava essas credenciais em lugar nenhum.
        </li>
        <li>
          <span className="text-ink">Nada vai para o localStorage</span> nem para o
          sessionStorage — os dois são legíveis por qualquer script da página e
          sobrevivem ao fechar o navegador. A memória do JavaScript, não.
        </li>
        <li>
          <span className="text-ink">F5, nova aba ou logout apagam tudo</span> e você
          informa de novo.
        </li>
        <li>
          Em troca, o review automático da GitHub App não roda: ele acontece quando
          você não está na tela, e aí não existe sessão de onde tirar a credencial.
        </li>
      </ul>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Field
            label="GitHub token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="ghp_..."
            value={githubDraft}
            onChange={(event) => setGithubDraft(event.target.value)}
          />
          <div className="flex items-center justify-between gap-2">
            <ActiveBadge value={credentials.githubToken} />
            <Button
              variant="secondary"
              disabled={!githubDraft.trim()}
              onClick={applyGithub}
            >
              Usar nesta sessão
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Field
            label="OpenAI key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-..."
            value={openaiDraft}
            onChange={(event) => setOpenaiDraft(event.target.value)}
          />
          <div className="flex items-center justify-between gap-2">
            <ActiveBadge value={credentials.openaiKey} />
            <Button
              variant="secondary"
              disabled={!openaiDraft.trim()}
              onClick={applyOpenai}
            >
              Usar nesta sessão
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
