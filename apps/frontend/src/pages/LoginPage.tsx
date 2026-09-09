import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/http';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { useAuth } from '../context/AuthContext';
import { useInstanceInfo } from '../hooks/useInstanceInfo';

export function LoginPage() {
  const { login, loginAsGuest } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { registeredEmail?: string } };

  const [identifier, setIdentifier] = useState(location.state?.registeredEmail ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const instance = useInstanceInfo();
  const ephemeral = instance?.credentialsMode === 'ephemeral';
  const demoAvailable = instance?.demoLogin === true;

  const onGuest = async () => {
    setError(null);
    setGuestLoading(true);
    try {
      await loginAsGuest();
      navigate('/projects', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Não foi possível abrir a sessão de teste.',
      );
    } finally {
      setGuestLoading(false);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const payload = identifier.includes('@')
        ? { email: identifier, password }
        : { username: identifier, password };

      await login(payload);
      navigate('/projects', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center px-5 py-8 sm:px-8 sm:py-12">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-md border border-border bg-surface-1 shadow-card md:grid-cols-[0.9fr_1.1fr]">
        <aside className="border-b border-border bg-machine p-7 text-machine-fg md:border-r md:border-b-0 md:p-10">
          <span className="inline-flex items-center gap-2.5">
            <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-md bg-accent">
              <span className="block h-3 w-0.5 skew-x-[-20deg] rounded-sm bg-white" />
            </span>
            <span className="font-display text-base leading-none tracking-tight">
              <b className="font-extrabold">Cast</b> <i className="font-normal text-machine-fg-2 not-italic">Review</i>
            </span>
          </span>
          <div className="mt-12 hidden md:block">
            <p className="font-mono text-[11px] tracking-[0.14em] text-machine-accent uppercase">Code review, com contexto</p>
            <p className="mt-4 max-w-xs font-display text-xl leading-tight font-bold">Menos ruído. Decisões de revisão mais claras.</p>
            <p className="mt-4 max-w-xs text-sm leading-6 text-machine-fg-2">Centralize pull requests, análises e evidências técnicas em um só lugar.</p>
            {ephemeral && (
              <div className="mt-8 max-w-xs border-t border-machine-fg-2/25 pt-6">
                <p className="font-mono text-[11px] tracking-[0.14em] text-machine-accent uppercase">
                  Instância de demonstração
                </p>
                <p className="mt-3 font-display text-base leading-snug font-bold">
                  Teste aqui sem salvar nada.
                </p>
                <p className="mt-3 text-[13px] leading-6 text-machine-fg-2">
                  Seu token do GitHub e sua chave da OpenAI ficam só na memória
                  desta aba. Não vão para o banco, não vão para o localStorage, e
                  somem no F5.
                </p>
              </div>
            )}
          </div>
        </aside>
        <div className="w-full p-7 sm:p-10">
          <p className="mb-2 font-mono text-[11px] tracking-[0.14em] text-ink-faint uppercase">Acesso à plataforma</p>
          <h1 className="mb-8 font-display text-2xl font-bold text-ink">Entrar</h1>

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field
            label="E-mail ou usuário"
            type="text"
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
          />
          <Field
            label="Senha"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error && (
            <p className="rounded-sm border border-fail/40 bg-fail-soft px-3 py-2 text-sm text-fail">
              {error}
            </p>
          )}

          <Button type="submit" loading={loading} className="mt-2 w-full">
            Entrar
          </Button>
          </form>

          {demoAvailable && (
            <div className="mt-6">
              <div className="mb-4 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="font-mono text-[10.5px] tracking-[0.12em] text-ink-faint uppercase">
                  ou
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                loading={guestLoading}
                onClick={onGuest}
              >
                Entrar como visitante
              </Button>
              <p className="mt-2.5 text-[13px] leading-6 text-ink-dim">
                Sessão temporária, sem cadastro. A conta e tudo que você criar nela
                são apagados quando a sessão expira.
              </p>
            </div>
          )}

          {ephemeral && (
            <div className="mt-6 rounded-sm border border-border bg-surface-2 px-3.5 py-3">
              <p className="text-[13px] leading-6 text-ink-dim">
                <span className="font-semibold text-ink">
                  Esta instância não guarda credenciais.
                </span>{' '}
                Depois de entrar, informe seu token e sua chave em Configurações:
                eles valem só enquanto a aba estiver aberta.
              </p>
            </div>
          )}

          <p className="mt-6 text-sm text-ink-dim">
            Ainda não tem conta?{' '}
            <Link to="/register" className="text-ink underline decoration-border-strong underline-offset-4 hover:text-accent">
              Criar conta
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
