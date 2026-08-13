import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/http';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { useAuth } from '../context/AuthContext';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await register({ name, username: username || undefined, email, password });
      navigate('/login', { replace: true, state: { registeredEmail: email } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível criar a conta.');
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
            <p className="font-mono text-xs tracking-[0.14em] text-accent uppercase">Revisões que viram histórico</p>
            <p className="mt-4 max-w-xs font-display text-xl leading-tight text-ink">Comece com seu GitHub e preserve o contexto.</p>
            <p className="mt-4 max-w-xs text-sm leading-6 text-ink-faint">Cada análise fica vinculada à pull request para o time consultar depois.</p>
          </div>
        </aside>
        <div className="w-full p-7 sm:p-10">
          <p className="mb-2 font-mono text-xs tracking-[0.18em] text-ink-faint uppercase">Configurar acesso</p>
          <h1 className="mb-8 font-display text-2xl font-semibold text-ink">Criar conta</h1>

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field
            label="Nome"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Field
            label="Usuário (opcional)"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Field
            label="E-mail"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Field
            label="Senha"
            type="password"
            autoComplete="new-password"
            hint="Mínimo de 6 caracteres."
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
            Criar conta
          </Button>
          </form>

          <p className="mt-6 text-sm text-ink-faint">
            Já tem conta?{' '}
            <Link to="/login" className="text-ink underline decoration-border-strong underline-offset-4 hover:text-accent">
              Entrar
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
