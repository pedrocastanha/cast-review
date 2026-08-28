import { useEffect, useMemo, useState } from 'react';
import type { CreateChatThreadPayload } from '../../api/chat.api';
import { projectsApi } from '../../api/projects.api';
import { repositoriesApi } from '../../api/repositories.api';
import type { Project, Repository } from '../../types';

interface ScopePickerProps {
  scope: CreateChatThreadPayload | null;
  onChange: (scope: CreateChatThreadPayload) => void;
}

function scopeLabel(
  scope: CreateChatThreadPayload,
  projects: Project[],
): string {
  if (scope.mode === 'repository') return scope.repoId;
  return (
    projects.find((project) => project.id === scope.projectId)?.name ??
    'projeto'
  );
}

export function ScopePicker({ scope, onChange }: ScopePickerProps) {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void repositoriesApi.list().then(setRepositories).catch(() => setRepositories([]));
    void projectsApi.list().then(setProjects).catch(() => setProjects([]));
  }, []);

  const needle = query.trim().toLowerCase();
  const visibleRepos = useMemo(
    () =>
      repositories
        .filter((repository) => repository.fullName.toLowerCase().includes(needle))
        .slice(0, 40),
    [repositories, needle],
  );
  const visibleProjects = useMemo(
    () => projects.filter((project) => project.name.toLowerCase().includes(needle)),
    [projects, needle],
  );

  const current = scope
    ? scopeLabel(scope, projects)
    : 'Escolher repositório ou projeto';

  const pick = (next: CreateChatThreadPayload) => {
    onChange(next);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-border-strong bg-surface-1 px-3 text-left transition-colors hover:border-ink-faint"
      >
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{current}</span>
        <span aria-hidden="true" className="shrink-0 text-ink-faint">
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open && (
        <div className="absolute top-full left-0 z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-border-strong bg-surface-1 shadow-[0_16px_40px_rgba(0,0,0,.22)]">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filtrar…"
            className="min-h-10 w-full border-b border-border bg-transparent px-3 text-sm text-ink outline-none placeholder:text-ink-faint"
          />

          {visibleProjects.length > 0 && (
            <p className="px-3 pt-2 font-mono text-[10.5px] tracking-[0.08em] text-ink-faint uppercase">
              Projetos
            </p>
          )}
          {visibleProjects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => pick({ mode: 'project', projectId: project.id })}
              className="block w-full cursor-pointer truncate px-3 py-1.5 text-left text-[13px] text-ink-dim transition-colors hover:bg-accent-soft hover:text-ink"
            >
              {project.name}
            </button>
          ))}

          {visibleRepos.length > 0 && (
            <p className="px-3 pt-2 font-mono text-[10.5px] tracking-[0.08em] text-ink-faint uppercase">
              Repositórios
            </p>
          )}
          {visibleRepos.map((repository) => (
            <button
              key={repository.id}
              type="button"
              onClick={() =>
                pick({ mode: 'repository', repoId: repository.fullName })
              }
              className="block w-full cursor-pointer truncate px-3 py-1.5 text-left font-mono text-[11.5px] text-ink-dim transition-colors hover:bg-accent-soft hover:text-ink"
            >
              {repository.fullName}
            </button>
          ))}

          {visibleProjects.length === 0 && visibleRepos.length === 0 && (
            <p className="px-3 py-3 text-sm text-ink-faint">Nada encontrado.</p>
          )}
        </div>
      )}
    </div>
  );
}
