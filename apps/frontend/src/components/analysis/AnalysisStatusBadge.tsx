import type { AnalysisStatus } from '../../types';

const labels: Record<AnalysisStatus, string> = {
  running: 'Rodando',
  completed: 'Concluída',
  error: 'Erro',
};

const styles: Record<AnalysisStatus, string> = {
  running: 'text-accent bg-accent-quiet/40',
  completed: 'text-state-open bg-state-open-dim',
  error: 'text-state-closed bg-state-closed-dim',
};

export function AnalysisStatusBadge({ status }: { status: AnalysisStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-mono text-xs font-medium tracking-wide uppercase ${styles[status]}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {labels[status]}
    </span>
  );
}
