import { Link } from 'react-router-dom';
import type { AnalysisRecord, PullRequest } from '../../types';
import { AnalysisHistoryList } from '../analysis/AnalysisHistoryList';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { PullRequestStatusBadge } from './PullRequestStatusBadge';

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

interface PullRequestDetailModalProps {
  pull: PullRequest;
  owner: string;
  repo: string;
  analyses: AnalysisRecord[];
  onClose: () => void;
}

export function PullRequestDetailModal({
  pull,
  owner,
  repo,
  analyses,
  onClose,
}: PullRequestDetailModalProps) {
  return (
    <Modal title={`#${pull.number}`} onClose={onClose} wide>
      <div className="flex flex-col gap-5">
        <div>
          <PullRequestStatusBadge pull={pull} />
          <h3 className="mt-3 font-display text-lg font-semibold text-ink">{pull.title}</h3>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-border py-4 font-mono text-xs">
          <div>
            <dt className="text-ink-faint">Autor</dt>
            <dd className="mt-0.5 text-ink">{pull.user ?? 'desconhecido'}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Branches</dt>
            <dd className="mt-0.5 text-ink">
              {pull.headRef} → {pull.baseRef}
            </dd>
          </div>
          <div>
            <dt className="text-ink-faint">Criada em</dt>
            <dd className="mt-0.5 text-ink">{dateTimeFormatter.format(new Date(pull.createdAt))}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Atualizada em</dt>
            <dd className="mt-0.5 text-ink">{dateTimeFormatter.format(new Date(pull.updatedAt))}</dd>
          </div>
        </dl>

        {analyses.length > 0 && (
          <div>
            <h4 className="mb-3 font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">
              Análises desta PR
            </h4>
            <AnalysisHistoryList
              owner={owner}
              repo={repo}
              analyses={analyses}
              emptyTitle="Nenhuma análise nesta PR"
            />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Link
            to={`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pull.number}/run`}
          >
            <Button className="w-full">Rodar análise</Button>
          </Link>
          <a href={pull.htmlUrl} target="_blank" rel="noreferrer">
            <Button variant="secondary" className="w-full">
              Abrir no GitHub ↗
            </Button>
          </a>
        </div>
      </div>
    </Modal>
  );
}
