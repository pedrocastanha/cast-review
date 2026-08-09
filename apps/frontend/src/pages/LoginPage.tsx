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
    <div className="grid min-h-screen place-items-center px-6 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-2 font-mono text-xs tracking-[0.18em] text-ink-faint uppercase">
          Cast · Review
        </p>
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
  );
}
