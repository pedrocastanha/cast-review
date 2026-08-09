import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export function Navbar() {
  const { user, logout } = useAuth();

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-8 py-5">
        <Link to="/repos" className="font-display text-base font-semibold tracking-tight text-ink">
          CAST<span className="text-accent">·</span>REVIEW
        </Link>

        <div className="flex items-center gap-4">
          {user && (
            <span className="hidden font-mono text-xs text-ink-faint sm:inline">
              {user.githubConnected ? (
                <span className="text-state-open">● {user.githubLogin}</span>
              ) : (
                <span className="text-ink-faint">● github desconectado</span>
              )}
            </span>
          )}
          <button
            type="button"
            onClick={logout}
            className="text-sm text-ink-dim transition-colors hover:text-ink"
          >
            Sair
          </button>
        </div>
      </div>
    </header>
  );
}
