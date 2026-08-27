import type { AnalysisStatus } from '../../types';

const labels: Record<AnalysisStatus, string> = {
  running: 'Rodando',
  completed: 'Concluída',
  error: 'Erro',
  awaiting_approval: 'Aguardando aprovação',
};

const styles: Record<AnalysisStatus, string> = {
  running: 'text-accent bg-accent-soft',
  completed: 'text-state-open bg-state-open-dim',
  error: 'text-state-closed bg-state-closed-dim',
  awaiting_approval: 'text-state-draft bg-state-draft-dim',
};

export function AnalysisStatusBadge({ status }: { status: AnalysisStatus }) {
  const label = labels[status] ?? status;
  const tone = styles[status] ?? styles.running;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-mono text-xs font-medium tracking-wide uppercase ${tone}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
