import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/http';
import { usersApi } from '../api/users.api';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { useAuth } from '../context/AuthContext';

export function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [token, setToken] = useState('');
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [tokenMessage, setTokenMessage] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const [removingToken, setRemovingToken] = useState(false);

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setUsername(user.username ?? '');
    setEmail(user.email);
  }, [user]);

  if (!user) return null;

  const profileSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setProfileMessage(null);
    setSavingProfile(true);
    try {
      await usersApi.update(user.id, { name: name.trim(), username: username.trim() || undefined, email: email.trim() });
      await refreshUser();
      setProfileMessage('Informações salvas.');
    } catch (error) {
      setProfileMessage(error instanceof ApiError ? error.message : 'Não foi possível salvar suas informações.');
    } finally {
      setSavingProfile(false);
    }
  };

  const tokenSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setTokenMessage(null);
    setSavingToken(true);
    try {
      await usersApi.update(user.id, { githubToken: token.trim() });
      setToken('');
      await refreshUser();
      setTokenMessage('Token do GitHub atualizado.');
    } catch (error) {
      setTokenMessage(error instanceof ApiError ? error.message : 'Não foi possível atualizar o token.');
    } finally {
      setSavingToken(false);
    }
  };

  const disconnect = async () => {
    setTokenMessage(null);
    setRemovingToken(true);
    try {
      await usersApi.disconnectGithub(user.id);
      await refreshUser();
      setTokenMessage('GitHub desconectado.');
    } catch (error) {
      setTokenMessage(error instanceof ApiError ? error.message : 'Não foi possível desconectar o GitHub.');
    } finally {
      setRemovingToken(false);
    }
  };

  return (
    <div>
      <header className="mb-8 border-b border-border pb-6">
        <p className="mb-2 font-mono text-xs tracking-[0.14em] text-accent uppercase">Área pessoal · 02</p>
        <h1 className="font-display text-xl font-semibold text-ink sm:text-2xl">Configurações</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-ink-faint">Gerencie suas informações e a conexão usada para ler os repositórios.</p>
      </header>

      <div className="grid gap-8 xl:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface-1/45 p-5 sm:p-6">
          <div className="mb-6"><p className="font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">Perfil</p><h2 className="mt-2 font-display text-lg font-semibold text-ink">Suas informações</h2></div>
          <form onSubmit={profileSubmit} className="flex flex-col gap-4">
            <Field label="Nome" value={name} onChange={(event) => setName(event.target.value)} required />
            <Field label="Usuário" value={username} onChange={(event) => setUsername(event.target.value)} hint="Opcional. Usado para seu identificador no Cast Review." />
            <Field label="E-mail" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            {profileMessage && <p className="text-sm text-ink-dim">{profileMessage}</p>}
            <Button type="submit" loading={savingProfile} className="self-start">Salvar perfil</Button>
          </form>
        </section>

        <section className="rounded-lg border border-border bg-surface-1/45 p-5 sm:p-6">
          <div className="mb-6"><p className="font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">Integração</p><h2 className="mt-2 font-display text-lg font-semibold text-ink">GitHub</h2></div>
          <div className="mb-6 rounded-sm border border-border bg-surface px-4 py-3">
            {user.githubConnected ? (
              <><p className="text-sm text-ink">Conectado como <span className="font-mono text-state-open">{user.githubLogin}</span></p><p className="mt-1 font-mono text-xs text-ink-faint">Token salvo · •••• {user.githubTokenLastFour ?? '—'}</p></>
            ) : <p className="text-sm text-ink-faint">Nenhuma conta do GitHub conectada.</p>}
          </div>
          <form onSubmit={tokenSubmit} className="flex flex-col gap-4">
            <Field label={user.githubConnected ? 'Novo personal access token' : 'Personal access token'} type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="ghp_…" hint="Pedimos somente o token. Guardamos os quatro últimos caracteres separadamente para identificação." required />
            {tokenMessage && <p className="text-sm text-ink-dim">{tokenMessage}</p>}
            <div className="flex flex-wrap gap-3"><Button type="submit" loading={savingToken}>{user.githubConnected ? 'Trocar token' : 'Conectar GitHub'}</Button>{user.githubConnected && <Button type="button" variant="danger" onClick={disconnect} loading={removingToken}>Desconectar</Button>}</div>
          </form>
        </section>
      </div>
    </div>
  );
}
