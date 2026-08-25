import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/http';
import { projectsApi } from '../api/projects.api';
import { EmptyState } from '../components/ui/EmptyState';
import { Spinner } from '../components/ui/Spinner';
import type { Project } from '../types';

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    projectsApi.list()
      .then(setProjects)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Falha ao carregar projetos.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <header className="mb-8 flex flex-col justify-between gap-5 border-b border-border pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 font-mono text-xs tracking-[0.14em] text-accent uppercase">System intelligence · 01</p>
          <h1 className="font-display text-xl font-semibold text-ink sm:text-2xl">Mapa dos seus sistemas</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-faint">
            Agrupe repositórios que entregam o mesmo produto e descubra contratos HTTP que atravessam suas fronteiras.
          </p>
        </div>
        <Link to="/projects/new" className="inline-flex min-h-11 items-center justify-center rounded-sm border border-accent bg-accent px-4.5 py-2.5 text-sm font-semibold tracking-wide text-accent-ink transition-colors hover:bg-accent-hover">
          Novo projeto
        </Link>
      </header>

      {loading && <div className="flex justify-center py-16"><Spinner size="lg" /></div>}
      {error && <p className="border border-state-closed/40 bg-state-closed-dim px-4 py-3 text-sm text-ink">{error}</p>}
      {!loading && !error && projects.length === 0 && (
        <EmptyState
          title="Seu mapa começa com um projeto"
          description="Selecione dois ou mais repositórios relacionados. O Cast Review indexa cada base e comprova as conexões encontradas."
          action={<Link to="/projects/new" className="inline-flex min-h-11 items-center justify-center rounded-sm border border-accent bg-accent px-4.5 py-2.5 text-sm font-semibold text-accent-ink">Criar primeiro projeto</Link>}
        />
      )}
      {!loading && projects.length > 0 && (
        <section aria-label="Projetos" className="flex flex-col gap-2">
          {projects.map((project, index) => (
            <Link key={project.id} to={`/projects/${project.id}`} className="group grid gap-5 border border-border bg-surface-1 p-5 transition-colors hover:border-border-strong hover:bg-surface-2 md:grid-cols-[9rem_minmax(0,1fr)_auto] md:items-center">
              <div className="flex items-center justify-between gap-3 md:block">
                <span className="font-mono text-[10px] tracking-[0.12em] text-ink-faint uppercase">Projeto {String(index + 1).padStart(2, '0')}</span>
                <span className="font-mono text-[10px] text-state-open md:mt-2 md:block">{project.repositories.length} repos</span>
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-lg font-semibold text-ink group-hover:text-accent">{project.name}</h2>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink-faint">{project.description || 'Sem descrição.'}</p>
              </div>
              <div className="flex flex-wrap gap-1.5 md:max-w-72 md:justify-end">
                {project.repositories.slice(0, 4).map((repo) => <span key={repo.id} className="border border-border px-2 py-1 font-mono text-[10px] text-ink-dim">{repo.name}</span>)}
                {project.repositories.length > 4 && <span className="px-2 py-1 font-mono text-[10px] text-ink-faint">+{project.repositories.length - 4}</span>}
              </div>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
