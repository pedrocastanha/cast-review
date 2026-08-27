import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/http';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { registeredEmail?: string } };

  const [identifier, setIdentifier] = useState(location.state?.registeredEmail ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
            minLength={6}
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
