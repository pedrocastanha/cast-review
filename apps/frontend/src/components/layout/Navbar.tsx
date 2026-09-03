import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../hooks/useTheme';

const NAV_ITEMS = [
  {
    to: '/projects',
    label: 'Projetos',
    icon: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  },
  {
    to: '/repos',
    label: 'Repositórios',
    icon: <path d="M5 4h13v16H6a2 2 0 0 1 0-4h12" />,
  },
  {
    to: '/chat',
    label: 'Chat',
    icon: <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 0 1 11 4h2a8 8 0 0 1 8 8z" />,
  },
  {
    to: '/benchmarks',
    label: 'Benchmark Lab',
    icon: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  },
  {
    to: '/integrations',
    label: 'Integrações',
    icon: <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7L12.5 19.5" />,
  },
  {
    to: '/settings',
    label: 'Configurações',
    icon: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10-1.4 1.4" />
      </>
    ),
  },
];

function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Usar tema claro' : 'Usar tema escuro'}
      className={`inline-flex min-h-11 items-center gap-2.5 rounded-sm text-sm text-machine-fg-3 transition-colors hover:bg-machine-2 hover:text-machine-fg ${compact ? 'min-w-11 justify-center' : 'px-2'}`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className="size-4">
        {isDark ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4" />
          </>
        ) : (
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5" />
        )}
      </svg>
      {compact ? null : isDark ? 'Tema claro' : 'Tema escuro'}
    </button>
  );
}

export function Navbar() {
  const { user, logout } = useAuth();

  return (
    <aside className="sticky top-0 z-20 flex flex-col border-b border-black/60 bg-machine text-machine-fg lg:h-screen lg:border-r lg:border-b-0">
      <div className="flex items-center justify-between gap-4 px-4 py-3 lg:block lg:px-5 lg:pt-6 lg:pb-7">
        <Link to="/projects" className="inline-flex min-h-11 items-center gap-2.5">
          <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-md bg-accent">
            <span className="block h-3 w-0.5 skew-x-[-20deg] rounded-sm bg-white" />
          </span>
          <span className="font-display text-base leading-none tracking-tight">
            <b className="font-extrabold">Cast</b> <i className="font-normal text-machine-fg-2 not-italic">Review</i>
          </span>
        </Link>
        <div className="flex items-center gap-1 lg:hidden">
          <ThemeToggle compact />
          <button type="button" onClick={logout} className="inline-flex min-h-11 min-w-11 items-center justify-center text-sm text-machine-fg-3 transition-colors hover:text-machine-fg">
            Sair
          </button>
        </div>
      </div>

      <nav aria-label="Navegação principal" className="flex gap-0.5 overflow-x-auto border-t border-machine-line px-2 py-1.5 lg:flex-col lg:border-0 lg:px-3 lg:py-0">
        <p className="hidden px-2 pb-2 font-mono text-[10px] tracking-[0.16em] text-machine-fg-3 uppercase lg:block">Workspace</p>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex min-h-11 shrink-0 items-center gap-2.5 rounded-sm px-2.5 text-sm font-medium transition-colors ${
                isActive ? 'bg-machine-3 text-white' : 'text-machine-fg-2 hover:bg-machine-2 hover:text-machine-fg'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={`size-4 shrink-0 ${isActive ? 'text-machine-accent' : 'opacity-85'}`}>
                  {item.icon}
                </svg>
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto hidden border-t border-machine-line px-5 py-4 lg:block">
        {user && (
          <div className="mb-2 flex items-center gap-2.5">
            <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-machine-3 to-machine text-xs font-bold text-machine-fg">
              {user.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-machine-fg">{user.name}</p>
              <p className="truncate font-mono text-[11px] text-machine-fg-3">
                {user.githubConnected ? user.githubLogin : 'GitHub desconectado'}
              </p>
            </div>
          </div>
        )}
        <ThemeToggle />
        <button type="button" onClick={logout} className="flex min-h-11 w-full items-center rounded-sm px-2 text-sm text-machine-fg-3 transition-colors hover:bg-machine-2 hover:text-machine-fg">
          Sair da conta
        </button>
      </div>
    </aside>
  );
}
