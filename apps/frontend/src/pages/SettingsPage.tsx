import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/http';
import { usersApi } from '../api/users.api';
import { Button } from '../components/ui/Button';
import { Card, PageHead } from '../components/ui/Card';
import { Field } from '../components/ui/Field';
import { StatusDot } from '../components/ui/List';
import { useAuth } from '../context/AuthContext';

export function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [token, setToken] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [tokenMessage, setTokenMessage] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const [removingToken, setRemovingToken] = useState(false);
  const [openaiMessage, setOpenaiMessage] = useState<string | null>(null);
  const [savingOpenai, setSavingOpenai] = useState(false);
  const [removingOpenai, setRemovingOpenai] = useState(false);

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

  const openaiSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setOpenaiMessage(null);
    setSavingOpenai(true);
    try {
      await usersApi.update(user.id, { openaiKey: openaiKey.trim() });
      setOpenaiKey('');
      await refreshUser();
      setOpenaiMessage('Chave da OpenAI salva.');
    } catch (error) {
      setOpenaiMessage(error instanceof ApiError ? error.message : 'Não foi possível salvar a chave.');
    } finally {
      setSavingOpenai(false);
    }
  };

  const disconnectOpenai = async () => {
    setOpenaiMessage(null);
    setRemovingOpenai(true);
    try {
      await usersApi.disconnectOpenai(user.id);
      await refreshUser();
      setOpenaiMessage('Chave da OpenAI removida.');
    } catch (error) {
      setOpenaiMessage(error instanceof ApiError ? error.message : 'Não foi possível remover a chave.');
    } finally {
      setRemovingOpenai(false);
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
      <PageHead
        eyebrow="Conta"
        title="Configurações"
        description="Seus dados e a conexão usada para ler os repositórios."
      />

      <div className="grid items-start gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(21.25rem,100%),1fr))]">
        <Card className="p-6">
          <h2 className="font-display text-lg font-bold text-ink">Seu perfil</h2>
          <p className="mt-1 mb-5 text-sm text-ink-dim">Como você aparece nas revisões publicadas.</p>
          <form onSubmit={profileSubmit} className="flex flex-col gap-4">
            <Field label="Nome" value={name} onChange={(event) => setName(event.target.value)} required />
            <Field label="Usuário" value={username} onChange={(event) => setUsername(event.target.value)} hint="Opcional. Usado para seu identificador no Cast Review." />
            <Field label="E-mail" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            {profileMessage && <p className="text-sm text-ink-dim">{profileMessage}</p>}
            <Button type="submit" loading={savingProfile} className="self-start">Salvar perfil</Button>
          </form>
        </Card>

        <Card className="p-6">
          <h2 className="font-display text-lg font-bold text-ink">GitHub</h2>
          <p className="mt-1 mb-5 text-sm text-ink-dim">O token é usado para ler repositórios, pull requests e publicar comentários de revisão.</p>
          <div className={`mb-5 flex items-center gap-3 rounded-sm border px-4 py-3 ${user.githubConnected ? 'border-pass/35 bg-pass-soft' : 'border-border bg-surface-2'}`}>
            {user.githubConnected ? (
              <>
                <StatusDot on />
                <div>
                  <p className="font-mono text-sm font-semibold text-pass">{user.githubLogin}</p>
                  <p className="font-mono text-[11.5px] text-pass/75">token salvo · final {user.githubTokenLastFour ?? '—'}</p>
                </div>
              </>
            ) : (
              <>
                <StatusDot on={false} />
                <p className="text-sm text-ink-dim">Nenhuma conta do GitHub conectada.</p>
              </>
            )}
          </div>
          <form onSubmit={tokenSubmit} className="flex flex-col gap-4">
            <Field label={user.githubConnected ? 'Novo personal access token' : 'Personal access token'} type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="ghp_…" hint="Pedimos somente o token. Guardamos os quatro últimos caracteres separadamente para identificação." required />
            {tokenMessage && <p className="text-sm text-ink-dim">{tokenMessage}</p>}
            <div className="flex flex-wrap gap-3"><Button type="submit" loading={savingToken}>{user.githubConnected ? 'Trocar token' : 'Conectar GitHub'}</Button>{user.githubConnected && <Button type="button" variant="danger" onClick={disconnect} loading={removingToken}>Desconectar</Button>}</div>
          </form>
        </Card>

        <Card className="p-6">
          <h2 className="font-display text-lg font-bold text-ink">OpenAI</h2>
          <p className="mt-1 mb-5 text-sm text-ink-dim">A chave alimenta o chat, as revisões de pull request e o Benchmark Lab. Ela é guardada cifrada no banco e nunca volta para o navegador.</p>
          <div className={`mb-5 flex items-center gap-3 rounded-sm border px-4 py-3 ${user.openaiConnected ? 'border-pass/35 bg-pass-soft' : 'border-border bg-surface-2'}`}>
            {user.openaiConnected ? (
              <>
                <StatusDot on />
                <div>
                  <p className="font-mono text-sm font-semibold text-pass">chave salva</p>
                  <p className="font-mono text-[11.5px] text-pass/75">final {user.openaiKeyLastFour ?? '—'}</p>
                </div>
              </>
            ) : (
              <>
                <StatusDot on={false} />
                <p className="text-sm text-ink-dim">Nenhuma chave da OpenAI configurada.</p>
              </>
            )}
          </div>
          <form onSubmit={openaiSubmit} className="flex flex-col gap-4">
            <Field label={user.openaiConnected ? 'Nova chave' : 'Chave da OpenAI'} type="password" autoComplete="off" value={openaiKey} onChange={(event) => setOpenaiKey(event.target.value)} placeholder="sk-…" hint="Guardamos os quatro últimos caracteres separadamente só para você identificar a chave." required />
            {openaiMessage && <p className="text-sm text-ink-dim">{openaiMessage}</p>}
            <div className="flex flex-wrap gap-3"><Button type="submit" loading={savingOpenai}>{user.openaiConnected ? 'Trocar chave' : 'Salvar chave'}</Button>{user.openaiConnected && <Button type="button" variant="danger" onClick={disconnectOpenai} loading={removingOpenai}>Remover</Button>}</div>
          </form>
        </Card>
      </div>
    </div>
  );
}
