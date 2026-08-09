import { useState, type FormEvent } from 'react';
import { usersApi } from '../../api/users.api';
import { ApiError } from '../../api/http';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { useAuth } from '../../context/AuthContext';

interface GithubTokenModalProps {
  onClose: () => void;
}

export function GithubTokenModal({ onClose }: GithubTokenModalProps) {
  const { user, refreshUser } = useAuth();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState(false);

  if (!user) return null;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await usersApi.update(user.id, { githubToken: token.trim() });
      await refreshUser();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar o token.');
    } finally {
      setLoading(false);
    }
  };

  const onRemove = async () => {
    setError(null);
    setRemoving(true);

    try {
      await usersApi.disconnectGithub(user.id);
      await refreshUser();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível remover o token.');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Modal title="Conectar GitHub" onClose={onClose}>
      {user.githubConnected && (
        <p className="mb-4 text-sm text-ink-dim">
          Conectado como <span className="font-mono text-state-open">{user.githubLogin}</span>. Cole um
          novo token pra trocar, ou remova abaixo.
        </p>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field
          label="Personal access token"
          type="password"
          placeholder="ghp_..."
          value={token}
          onChange={(e) => setToken(e.target.value)}
          hint="Precisa do escopo repo (ou public_repo). Fica cifrado no banco."
          autoComplete="off"
          required
        />

        {error && (
          <p className="rounded-sm border border-state-closed/40 bg-state-closed-dim px-3 py-2 text-sm text-ink">
            {error}
          </p>
        )}

        <div className="mt-2 flex items-center justify-between gap-3">
          {user.githubConnected ? (
            <Button type="button" variant="danger" onClick={onRemove} loading={removing}>
              Remover
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" loading={loading}>
            Salvar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
