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
      navigate('/repos', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center px-5 py-8 sm:px-8 sm:py-12">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-lg border border-border bg-surface/80 shadow-[0_24px_90px_oklch(5%_0.01_350_/_0.3)] backdrop-blur-sm md:grid-cols-[0.9fr_1.1fr]">
        <aside className="border-b border-border bg-surface-1/70 p-7 md:border-r md:border-b-0 md:p-10">
          <p className="font-display text-base font-semibold tracking-tight text-ink">CAST<span className="text-accent">·</span>REVIEW</p>
          <div className="mt-12 hidden md:block">
            <p className="font-mono text-xs tracking-[0.14em] text-accent uppercase">Code review, com contexto</p>
            <p className="mt-4 max-w-xs font-display text-xl leading-tight text-ink">Menos ruído. Decisões de revisão mais claras.</p>
            <p className="mt-4 max-w-xs text-sm leading-6 text-ink-faint">Centralize pull requests, análises e evidências técnicas em um só lugar.</p>
          </div>
        </aside>
        <div className="w-full p-7 sm:p-10">
          <p className="mb-2 font-mono text-xs tracking-[0.18em] text-ink-faint uppercase">Acesso à plataforma</p>
          <h1 className="mb-8 font-display text-2xl font-semibold text-ink">Entrar</h1>

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
            <p className="rounded-sm border border-state-closed/40 bg-state-closed-dim px-3 py-2 text-sm text-ink">
              {error}
            </p>
          )}

          <Button type="submit" loading={loading} className="mt-2 w-full">
            Entrar
          </Button>
          </form>

          <p className="mt-6 text-sm text-ink-faint">
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
