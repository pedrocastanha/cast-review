import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export function Navbar() {
  const { user, logout } = useAuth();

  return (
    <aside className="border-b border-border bg-surface/90 backdrop-blur-md lg:flex lg:min-h-screen lg:flex-col lg:border-r lg:border-b-0">
      <div className="flex items-center justify-between gap-4 px-5 py-4 lg:block lg:px-6 lg:py-7">
        <Link to="/repos" className="font-display text-base font-semibold tracking-tight text-ink">
          CAST<span className="text-accent">·</span>REVIEW
        </Link>
        <button type="button" onClick={logout} className="text-sm text-ink-dim transition-colors hover:text-ink lg:hidden">
          Sair
        </button>
      </div>

      <nav aria-label="Navegação principal" className="flex gap-1 overflow-x-auto border-t border-border px-3 py-2 lg:flex-col lg:border-0 lg:px-3 lg:py-0">
        <NavLink
          to="/repos"
          className={({ isActive }) =>
            `flex min-h-11 shrink-0 items-center gap-3 rounded-sm px-3 text-sm transition-colors ${
              isActive ? 'bg-surface-2 text-ink' : 'text-ink-faint hover:bg-surface-1 hover:text-ink'
            }`
          }
        >
          <span aria-hidden="true" className="grid size-5 place-items-center rounded-sm border border-current font-mono text-[10px]">01</span>
          Repositórios
        </NavLink>
        <NavLink
          to="/benchmarks"
          className={({ isActive }) =>
            `flex min-h-11 shrink-0 items-center gap-3 rounded-sm px-3 text-sm transition-colors ${
              isActive ? 'bg-surface-2 text-ink' : 'text-ink-faint hover:bg-surface-1 hover:text-ink'
            }`
          }
        >
          <span aria-hidden="true" className="grid size-5 place-items-center rounded-sm border border-current font-mono text-[10px]">02</span>
          Benchmark Lab
        </NavLink>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex min-h-11 shrink-0 items-center gap-3 rounded-sm px-3 text-sm transition-colors ${
              isActive ? 'bg-surface-2 text-ink' : 'text-ink-faint hover:bg-surface-1 hover:text-ink'
            }`
          }
        >
          <span aria-hidden="true" className="grid size-5 place-items-center rounded-sm border border-current font-mono text-[10px]">03</span>
          Configurações
        </NavLink>
      </nav>

      <div className="mt-auto hidden border-t border-border p-5 lg:block">
        {user && (
          <div className="mb-4">
            <p className="truncate text-sm font-medium text-ink">{user.name}</p>
            <p className="mt-1 truncate font-mono text-xs text-ink-faint">{user.githubConnected ? `GitHub · ${user.githubLogin}` : 'GitHub desconectado'}</p>
          </div>
        )}
        <button type="button" onClick={logout} className="text-sm text-ink-dim transition-colors hover:text-ink">Sair</button>
      </div>
    </aside>
  );
}
