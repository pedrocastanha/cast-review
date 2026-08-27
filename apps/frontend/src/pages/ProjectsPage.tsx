import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/http';
import { projectsApi } from '../api/projects.api';
import { PageHead } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Chip } from '../components/ui/Pill';
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
      <PageHead
        eyebrow="Workspace"
        title="Projetos"
        description="Agrupe os repositórios que entregam o mesmo produto. Nos projetos, a revisão enxerga os contratos HTTP que atravessam a fronteira entre eles."
        actions={
          <Link to="/projects/new" className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-sm border border-accent bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition-colors hover:border-accent-hover hover:bg-accent-hover">
            Criar projeto
          </Link>
        }
      />

      {loading && <div className="flex justify-center py-16"><Spinner size="lg" /></div>}
      {error && <p className="rounded-sm border border-fail/40 bg-fail-soft px-4 py-3 text-sm text-fail">{error}</p>}
      {!loading && !error && projects.length === 0 && (
        <EmptyState
          title="Seu mapa começa com um projeto"
          description="Selecione dois ou mais repositórios relacionados. O Cast Review indexa cada base e comprova as conexões encontradas."
          action={<Link to="/projects/new" className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-sm border border-accent bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover">Criar primeiro projeto</Link>}
        />
      )}
      {!loading && projects.length > 0 && (
        <section aria-label="Projetos" className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(20rem,100%),1fr))]">
          {projects.map((project) => (
            <Link key={project.id} to={`/projects/${project.id}`} className="group flex flex-col gap-3.5 rounded-md border border-border bg-surface-1 p-5 shadow-card transition-colors hover:border-border-strong">
              <h2 className="font-display text-lg font-bold text-ink group-hover:text-accent">{project.name}</h2>
              <p className="-mt-1.5 line-clamp-2 text-sm text-ink-dim">{project.description || 'Sem descrição.'}</p>
              <div className="flex flex-wrap gap-1.5">
                {project.repositories.slice(0, 4).map((repo) => <Chip key={repo.id}>{repo.name}</Chip>)}
                {project.repositories.length > 4 && <span className="px-1 py-0.5 font-mono text-xs text-ink-faint">+{project.repositories.length - 4}</span>}
              </div>
              <div className="mt-auto flex gap-6 border-t border-border pt-3">
                <div className="flex flex-col">
                  <b className="font-display text-lg leading-tight font-bold text-ink">{project.repositories.length}</b>
                  <span className="font-mono text-[10.5px] tracking-[0.1em] text-ink-faint uppercase">repositórios</span>
                </div>
              </div>
            </Link>
          ))}
          <Link to="/projects/new" className="grid min-h-[11.875rem] cursor-pointer place-items-center rounded-md border border-dashed border-border-strong text-sm font-semibold text-ink-dim transition-colors hover:border-accent hover:text-accent">
            + Agrupar repositórios
          </Link>
        </section>
      )}
    </div>
  );
}
