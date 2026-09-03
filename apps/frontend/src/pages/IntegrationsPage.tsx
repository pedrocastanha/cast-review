import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { githubAppApi } from '../api/github-app.api';
import { ApiError } from '../api/http';
import { Button } from '../components/ui/Button';
import { Card, PageHead } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { StatusDot } from '../components/ui/List';
import { Pill } from '../components/ui/Pill';
import { Spinner } from '../components/ui/Spinner';
import { RepositoryAutomationCard } from '../components/github-app/RepositoryAutomationCard';
import type { GithubInstallationSummary } from '../types';

const STATE_STORAGE_KEY = 'cast:github-app:install-state';

function statusTone(installation: GithubInstallationSummary) {
  if (installation.paused) return 'warn' as const;
  if (installation.status === 'active') return 'pass' as const;
  return 'fail' as const;
}

function statusLabel(installation: GithubInstallationSummary) {
  if (installation.paused) return 'pausada';
  if (installation.status === 'active') return 'ativa';
  if (installation.status === 'suspended') return 'suspensa no GitHub';
  if (installation.status === 'deleted') return 'removida';
  return 'pendente';
}

export function IntegrationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [installations, setInstallations] = useState<GithubInstallationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      setInstallations(await githubAppApi.list());
    } catch (error) {
      setMessage(
        error instanceof ApiError ? error.message : 'Não foi possível carregar as instalações.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const installationId = searchParams.get('installation_id');
    if (!installationId) {
      void load();
      return;
    }

    const state = searchParams.get('state') ?? sessionStorage.getItem(STATE_STORAGE_KEY) ?? '';
    setSearchParams({}, { replace: true });
    sessionStorage.removeItem(STATE_STORAGE_KEY);

    githubAppApi
      .link(installationId, state)
      .then(() => setMessage('Instalação vinculada. Ative os repositórios que devem ser revisados.'))
      .catch((error) =>
        setMessage(
          error instanceof ApiError ? error.message : 'Não foi possível vincular a instalação.',
        ),
      )
      .finally(() => void load());
  }, [load, searchParams, setSearchParams]);

  const startInstall = async () => {
    setMessage(null);
    setStarting(true);
    try {
      const { url, state } = await githubAppApi.installUrl();
      sessionStorage.setItem(STATE_STORAGE_KEY, state);
      window.location.href = url;
    } catch (error) {
      setMessage(
        error instanceof ApiError ? error.message : 'Não foi possível iniciar a instalação.',
      );
      setStarting(false);
    }
  };

  const runAction = async (
    id: string,
    action: () => Promise<unknown>,
    successMessage: string,
  ) => {
    setBusyId(id);
    setMessage(null);
    try {
      await action();
      setMessage(successMessage);
      await load();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'A ação falhou.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHead
        eyebrow="Integrações"
        title="Revisão automática no GitHub"
        description="Instale o Cast Review como GitHub App para revisar toda pull request aberta contra as branches que você escolher, e revisar de novo a cada novo commit."
        actions={
          <Button onClick={startInstall} loading={starting}>
            Instalar Cast Review no GitHub
          </Button>
        }
      />

      {message && (
        <Card className="mb-5 border-accent/35 bg-accent-soft p-4">
          <p className="text-sm text-ink">{message}</p>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : installations.length === 0 ? (
        <EmptyState
          title="Nenhuma instalação vinculada"
          description="Depois de instalar a App no GitHub, volte aqui para escolher os repositórios. Instalar não liga a automação: cada repositório começa desligado."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {installations.map((installation) => (
            <Card key={installation.id} className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <StatusDot on={installation.status === 'active' && !installation.paused} />
                    <h2 className="font-display text-lg font-bold text-ink">
                      {installation.accountLogin}
                    </h2>
                    <Pill tone={statusTone(installation)}>{statusLabel(installation)}</Pill>
                  </div>
                  <p className="mt-1.5 font-mono text-[11.5px] text-ink-faint">
                    installation {installation.installationId} ·{' '}
                    {installation.repositorySelection === 'all'
                      ? 'todos os repositórios'
                      : 'repositórios selecionados'}
                    {installation.lastEventAt
                      ? ` · último evento ${new Date(installation.lastEventAt).toLocaleString('pt-BR')}`
                      : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    loading={busyId === installation.id}
                    onClick={() =>
                      runAction(
                        installation.id,
                        () => githubAppApi.refresh(installation.id),
                        'Repositórios sincronizados com o GitHub.',
                      )
                    }
                  >
                    Sincronizar
                  </Button>
                  <Button
                    variant="secondary"
                    loading={busyId === installation.id}
                    onClick={() =>
                      runAction(
                        installation.id,
                        () =>
                          installation.paused
                            ? githubAppApi.resume(installation.id)
                            : githubAppApi.pause(installation.id),
                        installation.paused
                          ? 'Instalação retomada.'
                          : 'Instalação pausada: nenhum novo job será enfileirado.',
                      )
                    }
                  >
                    {installation.paused ? 'Retomar' : 'Pausar tudo'}
                  </Button>
                  <Button
                    variant="danger"
                    loading={busyId === installation.id}
                    onClick={() =>
                      runAction(
                        installation.id,
                        () => githubAppApi.unlink(installation.id),
                        'Vínculo revogado no Cast.',
                      )
                    }
                  >
                    Revogar vínculo
                  </Button>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-1.5">
                {Object.entries(installation.permissions).map(([permission, level]) => (
                  <span
                    key={permission}
                    className="rounded-sm border border-border bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-ink-dim"
                  >
                    {permission}: {level}
                  </span>
                ))}
              </div>

              <div className="mt-6 flex flex-col gap-4">
                {installation.repositories.length === 0 ? (
                  <p className="text-sm text-ink-dim">
                    Nenhum repositório concedido a esta instalação.
                  </p>
                ) : (
                  installation.repositories.map((repository) => (
                    <RepositoryAutomationCard
                      key={repository.id}
                      repository={repository}
                      installationPaused={installation.paused}
                      onChanged={load}
                    />
                  ))
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
