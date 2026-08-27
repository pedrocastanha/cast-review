import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/http';
import { projectsApi } from '../api/projects.api';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { Spinner } from '../components/ui/Spinner';
import { useAuth } from '../context/AuthContext';
import { useRepositories } from '../hooks/useRepositories';

export function ProjectFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { repos, loading: reposLoading, error: reposError } = useRepositories(Boolean(user?.githubConnected));
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [loadingProject, setLoadingProject] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    projectsApi.get(id)
      .then((project) => {
        setName(project.name);
        setDescription(project.description ?? '');
        setSelected(project.repositories.map((repo) => repo.fullName));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Falha ao carregar projeto.'))
      .finally(() => setLoadingProject(false));
  }, [id]);

  const filtered = useMemo(() => (repos ?? []).filter((repo) => `${repo.fullName} ${repo.description ?? ''}`.toLowerCase().includes(query.toLowerCase())), [repos, query]);
  const toggle = (fullName: string) => setSelected((current) => current.includes(fullName) ? current.filter((item) => item !== fullName) : [...current, fullName]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (selected.length === 0) { setError('Selecione pelo menos um repositório.'); return; }
    setSaving(true); setError(null);
    try {
      const payload = { name, description, repositories: selected };
      const project = id ? await projectsApi.update(id, payload) : await projectsApi.create(payload);
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao salvar projeto.');
    } finally { setSaving(false); }
  };

  if (loadingProject) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <form onSubmit={submit}>
      <header className="mb-8 border-b border-border pb-6">
        <Link to={id ? `/projects/${id}` : '/projects'} className="font-mono text-xs text-ink-faint hover:text-ink">← voltar</Link>
        <p className="mt-6 font-mono text-xs tracking-[0.14em] text-accent uppercase">Definição do sistema</p>
        <h1 className="mt-2 font-display text-xl font-bold text-ink sm:text-2xl">{editing ? 'Editar projeto' : 'Conectar repositórios'}</h1>
      </header>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,0.75fr)_minmax(24rem,1.25fr)]">
        <section className="space-y-5">
          <Field label="Nome do projeto" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={80} placeholder="Ex.: Plataforma Cast" />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="project-description" className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Descrição</label>
            <textarea id="project-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={5} placeholder="Qual produto esses repositórios entregam juntos?" className="rounded-sm border border-border bg-surface-1 px-3 py-2.5 text-sm leading-6 text-ink placeholder:text-ink-faint focus-visible:border-accent focus-visible:outline-none" />
          </div>
          <aside className="border border-border bg-surface-1 px-4 py-3 text-xs leading-5 text-ink-faint">
            O vínculo é explícito. As conexões técnicas exibidas depois só aparecem quando método e rota HTTP coincidem nos códigos indexados.
          </aside>
        </section>

        <section>
          <div className="flex items-end justify-between gap-4">
            <Field label="Buscar repositório" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="owner/repository" className="w-full" />
            <span className="mb-3 shrink-0 font-mono text-xs text-accent">{selected.length} selecionados</span>
          </div>
          {selected.length > 0 && <div className="mt-4 flex flex-wrap gap-2" aria-label="Repositórios selecionados">
            {selected.map((fullName) => <button key={fullName} type="button" onClick={() => toggle(fullName)} aria-label={`Remover ${fullName}`} className="inline-flex min-h-11 items-center gap-2 border border-accent/40 bg-accent-soft px-3 font-mono text-[10px] text-ink transition-colors hover:border-accent hover:bg-accent-soft">
              {fullName}<span aria-hidden="true" className="text-accent">×</span>
            </button>)}
          </div>}
          {!user?.githubConnected && <div className="mt-4 border border-border bg-surface-1 p-4">
            <p className="text-sm text-ink">Conecte o GitHub para selecionar repositórios.</p>
            <Link to="/settings" className="mt-3 inline-flex min-h-11 items-center font-semibold text-accent hover:text-accent-hover">Abrir configurações →</Link>
          </div>}
          {reposLoading && <div className="flex justify-center py-12"><Spinner /></div>}
          {(reposError || error) && <p className="mt-4 border border-fail/40 bg-fail-soft px-4 py-3 text-sm text-fail">{reposError || error}</p>}
          {repos && <div className="mt-4 max-h-[30rem] overflow-y-auto border border-border">
            {filtered.map((repo) => {
              const checked = selected.includes(repo.fullName);
              return <label key={repo.id} className={`flex min-h-16 cursor-pointer items-center gap-4 border-b border-border px-4 py-3 last:border-b-0 ${checked ? 'bg-accent-soft' : 'bg-surface-1 hover:bg-surface-2'}`}>
                <input type="checkbox" checked={checked} onChange={() => toggle(repo.fullName)} className="size-4 accent-[var(--color-accent)]" />
                <span className="min-w-0 flex-1"><span className="block truncate font-mono text-xs text-ink">{repo.fullName}</span><span className="mt-1 block truncate text-xs text-ink-faint">{repo.description || (repo.private ? 'Repositório privado' : 'Repositório público')}</span></span>
                <span className="font-mono text-[9px] uppercase text-ink-faint">{repo.defaultBranch}</span>
              </label>;
            })}
            {filtered.length === 0 && <p className="px-4 py-8 text-center text-sm text-ink-faint">Nenhum repositório corresponde a “{query}”.</p>}
          </div>}
        </section>
      </div>
      <footer className="mt-8 flex justify-end gap-3 border-t border-border pt-6">
        <Link to={id ? `/projects/${id}` : '/projects'} className="inline-flex min-h-11 items-center px-3 text-sm text-ink-dim hover:text-ink">Cancelar</Link>
        <Button type="submit" loading={saving} disabled={!user?.githubConnected || !name.trim() || selected.length === 0}>{editing ? 'Salvar projeto' : 'Criar projeto'}</Button>
      </footer>
    </form>
  );
}
