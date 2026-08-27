import { Link, useParams } from 'react-router-dom';
import { ChatPanel } from '../components/chat/ChatPanel';
import { Breadcrumb } from '../components/ui/Breadcrumb';

export function ProjectChatPage() {
  const { id = '' } = useParams();

  return (
    <div>
      <Breadcrumb
        items={[{ label: 'Projetos', to: '/projects' }, { label: 'Chat' }]}
      />

      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-2xl leading-[1.1] font-bold text-ink">
          Chat do projeto
        </h1>
        <Link
          to={`/projects/${encodeURIComponent(id)}`}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-sm border border-border-strong bg-surface-1 px-4 text-sm font-semibold text-ink transition-colors hover:border-ink-faint hover:bg-surface-2"
        >
          Ver grafo
        </Link>
      </header>

      <ChatPanel
        scope={{ mode: 'project', projectId: id }}
        emptyHint="Abra uma conversa para perguntar sobre os repositórios deste projeto. O agente atravessa os repos e enxerga as ligações HTTP entre eles."
      />
    </div>
  );
}
