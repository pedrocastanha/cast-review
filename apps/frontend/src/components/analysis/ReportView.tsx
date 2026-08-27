import { useState } from 'react';
import type { Finding, PrdPayload, ReportPayload, ReviewComment, SpecPayload } from '../../types';
import { formatTokens, formatUsd } from '../../lib/format-usage';
import { Card } from '../ui/Card';
import { Eyebrow, Pill } from '../ui/Pill';
import { ReportMarkdown } from './ReportMarkdown';

function scoreTone(score: number) {
  if (score >= 90) return 'bg-pass';
  if (score >= 70) return 'bg-warn';
  return 'bg-fail';
}

function reviewerLabel(name: string) {
  return name.replaceAll('_', ' ');
}

type Severity = 'fail' | 'warning' | 'pass';

const SEV_LABEL: Record<Severity, string> = { fail: 'falha', warning: 'aviso', pass: 'ok' };
const SEV_BORDER: Record<Severity, string> = {
  fail: 'border-l-fail',
  warning: 'border-l-warn',
  pass: 'border-l-pass',
};
const SEV_BADGE: Record<Severity, string> = {
  fail: 'bg-fail-soft text-fail',
  warning: 'bg-warn-soft text-warn',
  pass: 'bg-pass-soft text-pass',
};

function FindingCard({ comment }: { comment: ReviewComment | (Finding & { reviewer?: string }) }) {
  const [open, setOpen] = useState(false);
  const severity = comment.status as Severity;
  const hasBody = Boolean(comment.detail || comment.businessRule || comment.path || comment.conventionRef);

  return (
    <article
      className={`overflow-hidden rounded-md border border-l-[3px] border-border bg-surface-1 shadow-card ${SEV_BORDER[severity]}`}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        disabled={!hasBody}
        className="flex w-full cursor-pointer items-start gap-3.5 px-4.5 py-3.5 text-left disabled:cursor-default"
      >
        <span
          className={`mt-0.5 shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.1em] uppercase ${SEV_BADGE[severity]}`}
        >
          {SEV_LABEL[severity]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] leading-snug font-semibold text-ink">{comment.title}</span>
          {comment.reviewer && (
            <span className="mt-1 block font-mono text-[11.5px] text-ink-faint">
              {reviewerLabel(comment.reviewer)}
            </span>
          )}
        </span>
        {hasBody && (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            className={`mt-1 size-3.5 shrink-0 text-ink-faint transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        )}
      </button>

      {open && hasBody && (
        <div className="animate-fade-up border-t border-border px-4.5 pb-4.5">
          <div className="mt-4 grid overflow-hidden rounded-sm border border-border sm:grid-cols-2">
            {comment.businessRule && (
              <div className="border-b border-border bg-surface-2 px-4 py-3.5 sm:border-r sm:border-b-0">
                <h4 className="mb-2 font-mono text-[10px] tracking-[0.12em] text-ink-faint uppercase">
                  O que foi especificado
                </h4>
                <p className="text-sm leading-relaxed text-ink-dim">{comment.businessRule}</p>
              </div>
            )}
            {comment.detail && (
              <div className="bg-surface-1 px-4 py-3.5">
                <h4 className="mb-2 font-mono text-[10px] tracking-[0.12em] text-ink-faint uppercase">
                  O que o código faz
                </h4>
                <p className="text-sm leading-relaxed text-ink">{comment.detail}</p>
              </div>
            )}
          </div>

          <div className="mt-3.5 flex flex-wrap gap-2">
            {comment.path && (
              <span className="inline-flex items-center gap-2 rounded-sm border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-ink-dim">
                {comment.path}
                {comment.line ? `:${comment.line}` : ''}
              </span>
            )}
            {comment.conventionRef && (
              <span className="inline-flex items-center gap-2 rounded-sm border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-ink-dim">
                ref: {comment.conventionRef}
              </span>
            )}
            {comment.evidenceId && (
              <span className="inline-flex items-center gap-2 rounded-sm bg-accent-soft px-2.5 py-1.5 font-mono text-xs text-accent">
                evidência {comment.evidenceId}
              </span>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function stringList(items: unknown) {
  if (typeof items === 'string' && items.trim()) return [items.trim()];
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [item.trim()];
    if (item && typeof item === 'object' && 'title' in item) {
      const title = (item as { title?: unknown }).title;
      return typeof title === 'string' && title.trim() ? [title.trim()] : [];
    }
    return [];
  });
}

function DocSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 first:mt-0">
      <h3 className="mb-2 font-mono text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">{title}</h3>
      {children}
    </div>
  );
}

function DocList({ items, muted = false }: { items: string[]; muted?: boolean }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item) => (
        <li key={item} className="relative pl-5 text-sm leading-relaxed text-ink">
          <span
            aria-hidden="true"
            className={`absolute top-2.5 left-1 size-1.5 rounded-full ${
              muted ? 'border border-border-strong' : 'bg-border-strong'
            }`}
          />
          {item}
        </li>
      ))}
    </ul>
  );
}

function PrdBlock({ prd }: { prd: PrdPayload }) {
  const goals = stringList(prd.goals);
  const nonGoals = stringList(prd.nonGoals);

  return (
    <Card className="max-w-[51.25rem] p-7 sm:p-8">
      <Eyebrow className="mb-2.5">O que a revisão entendeu da task</Eyebrow>
      {prd.title && <h2 className="mb-4 font-display text-xl leading-tight font-bold text-ink">{prd.title}</h2>}
      {prd.problem && (
        <DocSection title="Problema">
          <p className="text-sm leading-relaxed text-ink">{prd.problem}</p>
        </DocSection>
      )}
      {prd.whatChanged && (
        <DocSection title="O que mudou">
          <p className="text-sm leading-relaxed text-ink">{prd.whatChanged}</p>
        </DocSection>
      )}
      {goals.length > 0 && (
        <DocSection title="Objetivos">
          <DocList items={goals} />
        </DocSection>
      )}
      {nonGoals.length > 0 && (
        <DocSection title="Fora do escopo">
          <DocList items={nonGoals} muted />
        </DocSection>
      )}
      {prd.userImpact && (
        <DocSection title="Impacto para quem usa">
          <p className="text-sm leading-relaxed text-ink">{prd.userImpact}</p>
        </DocSection>
      )}
    </Card>
  );
}

function SpecBlock({ spec }: { spec: SpecPayload }) {
  const contracts = stringList(spec.newContracts);
  const rules = stringList(spec.businessRules);

  return (
    <Card className="max-w-[51.25rem] p-7 sm:p-8">
      <Eyebrow className="mb-2.5">Como o código implementa o PRD</Eyebrow>
      <h2 className="mb-4 font-display text-xl leading-tight font-bold text-ink">Especificação de implementação</h2>
      {spec.summary && <p className="text-sm leading-relaxed text-ink">{spec.summary}</p>}
      {contracts.length > 0 && (
        <DocSection title="Contratos novos ou alterados">
          <ul className="flex flex-col gap-1.5">
            {contracts.map((item) => (
              <li key={item} className="font-mono text-sm leading-relaxed text-ink-dim">
                {item}
              </li>
            ))}
          </ul>
        </DocSection>
      )}
      {rules.length > 0 && (
        <DocSection title="Regras de negócio verificadas">
          <DocList items={rules} />
        </DocSection>
      )}
    </Card>
  );
}

const VERDICT_LABEL = {
  approve: 'Aprovar',
  comment: 'Comentar',
  request_changes: 'Pedir mudanças',
} as const;

const VERDICT_SUB = {
  approve: 'a revisão não encontrou nada que impeça o merge',
  comment: 'a revisão não bloqueia o merge, mas achou algo que vale responder',
  request_changes: 'a revisão encontrou algo que precisa ser resolvido antes do merge',
} as const;

const VERDICT_COLOR = {
  approve: 'text-pass',
  comment: 'text-accent',
  request_changes: 'text-fail',
} as const;

type ReportFocus = 'all' | 'prd' | 'spec' | 'test' | 'architecture' | 'comments';
type Filter = 'attention' | 'ok' | 'all';

export function ReportView({ report, focus = 'all' }: { report: ReportPayload; focus?: ReportFocus }) {
  const [filter, setFilter] = useState<Filter>('attention');
  const results = report.results ?? [];
  const comments: ReviewComment[] = (
    report.comments?.length
      ? report.comments
      : results.flatMap((result) => (result.findings ?? []).map((finding) => ({ reviewer: result.name, ...finding })))
  )
    .slice()
    .sort((left, right) => {
      const rank = { fail: 0, warning: 1, pass: 2 };
      return (rank[left.status] ?? 3) - (rank[right.status] ?? 3);
    });

  const files = report.changeAnalysis?.files ?? [];
  const visibleFiles = files.slice(0, 12);
  const hiddenFiles = Math.max(0, files.length - visibleFiles.length);
  const visibleResults = results.filter((result) =>
    focus === 'test'
      ? result.name.toLowerCase().includes('test')
      : focus === 'architecture'
        ? result.name.toLowerCase().includes('architecture')
        : true,
  );
  const visibleComments = comments.filter((item) =>
    focus === 'test'
      ? item.reviewer.toLowerCase().includes('test')
      : focus === 'architecture'
        ? item.reviewer.toLowerCase().includes('architecture')
        : true,
  );

  const failCount = visibleComments.filter((item) => item.status === 'fail').length;
  const warnCount = visibleComments.filter((item) => item.status === 'warning').length;
  const passCount = visibleComments.filter((item) => item.status === 'pass').length;
  const filtered = visibleComments.filter((item) =>
    filter === 'all' ? true : filter === 'attention' ? item.status !== 'pass' : item.status === 'pass',
  );

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: 'attention', label: 'Precisa de atenção', count: failCount + warnCount },
    { id: 'ok', label: 'Conferido', count: passCount },
    { id: 'all', label: 'Tudo', count: visibleComments.length },
  ];

  return (
    <div className="flex flex-col gap-6">
      {focus === 'all' && (report.verdict || report.overallScore !== undefined) && (
        <section className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <Card className="flex flex-col gap-4 p-6 sm:px-6.5">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className={`font-display text-3xl leading-none font-bold ${report.verdict ? VERDICT_COLOR[report.verdict] : 'text-ink'}`}>
                {report.verdict ? VERDICT_LABEL[report.verdict] : 'Em análise'}
              </h2>
              {report.verdict && <span className="text-sm text-ink-dim">{VERDICT_SUB[report.verdict]}</span>}
            </div>
            {report.headline && <p className="max-w-[58ch] text-[15px] leading-relaxed text-ink">{report.headline}</p>}
            <div className="flex flex-wrap gap-2">
              {failCount > 0 && <Pill tone="fail" dot>{failCount} {failCount === 1 ? 'falha' : 'falhas'}</Pill>}
              {warnCount > 0 && <Pill tone="warn" dot>{warnCount} {warnCount === 1 ? 'aviso' : 'avisos'}</Pill>}
              {passCount > 0 && <Pill tone="pass" dot>{passCount} {passCount === 1 ? 'conferido' : 'conferidos'}</Pill>}
            </div>
          </Card>

          <Card className="flex flex-col gap-4.5 p-6">
            {results.map((result) => (
              <div key={result.name} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-ink-dim">{reviewerLabel(result.name)}</span>
                  <b className="font-display text-[17px] font-bold text-ink">{result.score}</b>
                </div>
                <div className="h-[5px] overflow-hidden rounded-sm border border-border bg-surface-2">
                  <i
                    className={`block h-full rounded-sm transition-[width] duration-700 ease-precise ${scoreTone(result.score)}`}
                    style={{ width: `${Math.max(0, Math.min(100, result.score))}%` }}
                  />
                </div>
              </div>
            ))}
            <div className="mt-auto flex flex-wrap justify-between gap-2.5 border-t border-border pt-3.5 font-mono text-[11.5px] text-ink-faint">
              {report.conventionsSource === 'default' && <span>convenções padrão</span>}
              {report.usage && (
                <span className="tabular-nums">
                  {formatTokens(report.usage.totalTokens)} tok · {formatUsd(report.usage.costUsd, false)}
                  {!report.usage.costComplete && ' · parcial'}
                </span>
              )}
            </div>
          </Card>
        </section>
      )}

      {(focus === 'all' || focus === 'comments' || focus === 'test' || focus === 'architecture') &&
        visibleComments.length > 0 && (
          <section>
            <div className="mb-4 flex flex-wrap gap-1.5">
              {filters.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={filter === item.id}
                  onClick={() => setFilter(item.id)}
                  className={`min-h-11 cursor-pointer rounded-full border px-3.5 text-sm font-semibold transition-colors ${
                    filter === item.id
                      ? 'border-ink bg-ink text-surface-1'
                      : 'border-border bg-surface-1 text-ink-dim hover:border-ink-faint hover:text-ink'
                  }`}
                >
                  {item.label}
                  <span className="ml-1.5 font-mono text-[11px] opacity-65">{item.count}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-3">
              {filtered.map((comment, index) => (
                <FindingCard key={`${comment.reviewer}-${comment.title}-${index}`} comment={comment} />
              ))}
              {filtered.length === 0 && (
                <p className="rounded-md border border-dashed border-border-strong px-4 py-8 text-center text-sm text-ink-dim">
                  Nenhum achado nesta categoria.
                </p>
              )}
            </div>
          </section>
        )}

      {visibleResults.length > 0 && focus !== 'all' && (focus === 'test' || focus === 'architecture') && (
        <section className="grid gap-4 sm:grid-cols-2">
          {visibleResults.map((result) => (
            <Card key={result.name} className="p-5">
              <Eyebrow>{reviewerLabel(result.name)}</Eyebrow>
              <p className="mt-2 font-display text-2xl font-bold text-ink">{result.score}</p>
            </Card>
          ))}
        </section>
      )}

      {(focus === 'all' || focus === 'prd') && report.prd && <PrdBlock prd={report.prd} />}
      {(focus === 'all' || focus === 'spec') && report.spec && <SpecBlock spec={report.spec} />}

      {focus === 'all' && report.changeAnalysis && (
        <section>
          <div className="mb-3.5 font-mono text-xs text-ink-faint">
            {files.length} {files.length === 1 ? 'arquivo' : 'arquivos'} ·{' '}
            {report.changeAnalysis.hasTests ? 'com testes' : 'sem testes'} ·{' '}
            {report.changeAnalysis.hasMigration ? 'com migration' : 'sem migration'}
          </div>
          {visibleFiles.length > 0 && (
            <div className="overflow-hidden rounded-md border border-border bg-surface-1 shadow-card">
              {visibleFiles.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center gap-3 border-b border-border px-4.5 py-2.5 font-mono text-[12.5px] last:border-b-0"
                >
                  <span className="shrink-0 rounded-sm bg-surface-2 px-1.5 py-0.5 text-[10px] tracking-[0.08em] text-ink-dim uppercase">
                    {file.kind}
                  </span>
                  <span className="truncate text-ink-dim">{file.path}</span>
                </div>
              ))}
              {hiddenFiles > 0 && (
                <p className="bg-surface-2 px-4.5 py-3 text-center text-sm text-ink-dim">
                  + {hiddenFiles} arquivos
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {focus === 'all' && report.usage && report.usage.steps.length > 0 && (
        <section className="overflow-x-auto">
          <table className="w-full min-w-[36rem] overflow-hidden rounded-md border border-border bg-surface-1 shadow-card">
            <thead>
              <tr>
                {['Etapa', 'Modelo', 'Entrada', 'Saída', 'Custo'].map((header, index) => (
                  <th
                    key={header}
                    className={`border-b border-border bg-surface-2 px-4.5 py-3 font-mono text-[10px] font-medium tracking-[0.12em] text-ink-faint uppercase ${
                      index > 1 ? 'text-right' : 'text-left'
                    }`}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.usage.steps.map((step) => (
                <tr key={step.step}>
                  <td className="border-b border-border px-4.5 py-3 text-sm text-ink">{step.label}</td>
                  <td className="border-b border-border px-4.5 py-3 font-mono text-xs text-ink-faint">
                    {step.skipped ? 'sem LLM' : (step.model ?? '—')}
                  </td>
                  <td className="border-b border-border px-4.5 py-3 text-right font-mono text-[13px] tabular-nums text-ink-dim">
                    {step.skipped ? '—' : formatTokens(step.promptTokens)}
                  </td>
                  <td className="border-b border-border px-4.5 py-3 text-right font-mono text-[13px] tabular-nums text-ink-dim">
                    {step.skipped ? '—' : formatTokens(step.completionTokens)}
                  </td>
                  <td className="border-b border-border px-4.5 py-3 text-right font-mono text-[13px] tabular-nums text-ink-dim">
                    {step.skipped ? '—' : formatUsd(step.costUsd)}
                  </td>
                </tr>
              ))}
              <tr className="bg-surface-2 font-bold">
                <td className="px-4.5 py-3 text-sm text-ink">Total</td>
                <td className="px-4.5 py-3 font-mono text-xs text-ink-faint">
                  {report.usage.steps.filter((step) => !step.skipped).length} etapas com LLM
                </td>
                <td className="px-4.5 py-3 text-right font-mono text-[13px] tabular-nums text-ink">
                  {formatTokens(report.usage.promptTokens)}
                </td>
                <td className="px-4.5 py-3 text-right font-mono text-[13px] tabular-nums text-ink">
                  {formatTokens(report.usage.completionTokens)}
                </td>
                <td className="px-4.5 py-3 text-right font-mono text-[13px] tabular-nums text-ink">
                  {formatUsd(report.usage.costUsd)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {focus === 'all' && report.markdown && <ReportMarkdown markdown={report.markdown} />}
    </div>
  );
}
