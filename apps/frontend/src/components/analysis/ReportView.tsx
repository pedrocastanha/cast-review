import type { Finding, PrdPayload, ReportPayload, ReviewComment, SpecPayload } from '../../types';
import { formatTokens, formatUsd } from '../../lib/format-usage';
import { ReportMarkdown } from './ReportMarkdown';

function scoreTone(score: number) {
  if (score >= 90) return 'text-state-open';
  if (score >= 70) return 'text-ink';
  return 'text-state-closed';
}

function reviewerLabel(name: string) {
  return name.replaceAll('_', ' ');
}

function CommentRow({ comment }: { comment: ReviewComment | (Finding & { reviewer?: string }) }) {
  const tone =
    comment.status === 'fail'
      ? 'text-state-closed'
      : comment.status === 'warning'
        ? 'text-accent'
        : 'text-state-open';

  return (
    <li className="border-b border-border py-3 last:border-0">
      <p className="text-sm text-ink">
        <span className={`font-mono text-xs uppercase ${tone}`}>{comment.status}</span>
        {comment.reviewer && (
          <>
            <span className="mx-2 text-ink-faint">·</span>
            <span className="font-mono text-xs text-ink-faint">{reviewerLabel(comment.reviewer)}</span>
          </>
        )}
        <span className="mx-2 text-ink-faint">·</span>
        {comment.title}
      </p>
      {comment.detail && <p className="mt-1 text-xs text-ink-faint">{comment.detail}</p>}
      {comment.businessRule && (
        <p className="mt-1 font-mono text-xs text-ink-dim">regra: {comment.businessRule}</p>
      )}
      {comment.conventionRef && (
        <p className="mt-1 font-mono text-xs text-ink-dim">ref: {comment.conventionRef}</p>
      )}
      {comment.path && (
        <p className="mt-1 font-mono text-xs text-ink-dim">
          {comment.path}
          {comment.line ? `:${comment.line}` : ''}
        </p>
      )}
      {comment.evidenceId && (
        <p className="mt-1 font-mono text-[10px] tracking-wide text-accent uppercase">
          evidência {comment.evidenceId}
        </p>
      )}
    </li>
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

function PrdBlock({ prd }: { prd: PrdPayload }) {
  const goals = stringList(prd.goals);
  const nonGoals = stringList(prd.nonGoals);

  return (
    <section>
      <h3 className="mb-2 font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">PRD</h3>
      <div className="rounded-sm border border-border px-4 py-3">
        {prd.title && <p className="font-display text-base font-semibold text-ink">{prd.title}</p>}
        {prd.whatChanged && <p className="mt-2 text-sm text-ink-dim">{prd.whatChanged}</p>}
        {prd.problem && prd.problem !== prd.whatChanged && (
          <p className="mt-2 text-sm text-ink-faint">{prd.problem}</p>
        )}
        {prd.userImpact && (
          <p className="mt-2 text-xs text-ink-faint">
            Impacto: {prd.userImpact}
          </p>
        )}
        {goals.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-xs text-ink-dim">
            {goals.map((goal) => (
              <li key={goal}>— {goal}</li>
            ))}
          </ul>
        )}
        {nonGoals.length > 0 && (
          <p className="mt-3 font-mono text-[10px] tracking-wide text-ink-faint uppercase">
            Fora de escopo: {nonGoals.join(' · ')}
          </p>
        )}
      </div>
    </section>
  );
}

function SpecBlock({ spec }: { spec: SpecPayload }) {
  const contracts = stringList(spec.newContracts);
  const rules = stringList(spec.businessRules);

  return (
    <section>
      <h3 className="mb-2 font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">
        Implementation Spec
      </h3>
      <div className="rounded-sm border border-border px-4 py-3">
        {spec.summary && <p className="text-sm text-ink">{spec.summary}</p>}
        {contracts.length > 0 && (
          <div className="mt-3">
            <p className="font-mono text-[10px] tracking-wider text-ink-faint uppercase">Contratos</p>
            <ul className="mt-1 flex flex-col gap-1 text-xs text-ink-dim">
              {contracts.map((item) => (
                <li key={item} className="font-mono">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
        {rules.length > 0 && (
          <div className="mt-3">
            <p className="font-mono text-[10px] tracking-wider text-ink-faint uppercase">
              Regras de negócio
            </p>
            <ul className="mt-1 flex flex-col gap-1 text-xs text-ink-dim">
              {rules.map((item) => (
                <li key={item}>— {item}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

const VERDICT_LABEL = {
  approve: 'Aprovar',
  comment: 'Comentar',
  request_changes: 'Pedir mudanças',
} as const;

const VERDICT_TONE = {
  approve: 'border-state-open text-state-open',
  comment: 'border-accent text-accent',
  request_changes: 'border-state-closed text-state-closed',
} as const;

type ReportFocus = 'all' | 'prd' | 'spec' | 'test' | 'architecture' | 'comments';

export function ReportView({ report, focus = 'all' }: { report: ReportPayload; focus?: ReportFocus }) {
  const results = report.results ?? [];
  const comments: ReviewComment[] = (
    report.comments?.length
      ? report.comments
      : results.flatMap((result) =>
          (result.findings ?? []).map((finding) => ({ reviewer: result.name, ...finding })),
        )
  ).slice().sort((left, right) => {
    const rank = { fail: 0, warning: 1, pass: 2 };
    return (rank[left.status] ?? 3) - (rank[right.status] ?? 3);
  });
  const files = report.changeAnalysis?.files ?? [];
  const visibleFiles = files.slice(0, 12);
  const hiddenFiles = Math.max(0, files.length - visibleFiles.length);
  const visibleResults = results.filter((result) =>
    focus === 'test' ? result.name.toLowerCase().includes('test') : focus === 'architecture' ? result.name.toLowerCase().includes('architecture') : true,
  );
  const visibleComments = comments.filter((item) =>
    focus === 'test' ? item.reviewer.toLowerCase().includes('test') : focus === 'architecture' ? item.reviewer.toLowerCase().includes('architecture') : true,
  );
  const visibleActionable = visibleComments.filter((item) => item.status !== 'pass');

  return (
    <div className="flex flex-col gap-8">
      {focus === 'all' && (report.verdict || report.overallScore !== undefined) && (
        <section className={`rounded-sm border px-4 py-4 ${report.verdict ? VERDICT_TONE[report.verdict] : 'border-border'}`}>
          <p className="font-mono text-[10px] tracking-wider uppercase">Veredito</p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-display text-xl font-semibold">
                {report.verdict ? VERDICT_LABEL[report.verdict] : 'Em análise'}
              </p>
              {report.headline && <p className="mt-1 text-sm text-ink">{report.headline}</p>}
              {report.conventionsSource === 'default' && (
                <p className="mt-2 font-mono text-[10px] tracking-wide text-ink-faint uppercase">
                  Convenções padrão Cast Review
                </p>
              )}
            </div>
            <div className="text-right">
              {report.overallScore !== undefined && (
                <p className={`font-display text-4xl font-semibold ${scoreTone(report.overallScore)}`}>
                  {report.overallScore}
                </p>
              )}
              {report.usage && (
                <p className="mt-1 font-mono text-[10px] tracking-wide text-ink-faint tabular-nums uppercase">
                  {formatUsd(report.usage.costUsd, false)} · {formatTokens(report.usage.totalTokens)} tok
                  {!report.usage.costComplete && ' · parcial'}
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {focus === 'all' && report.changeAnalysis && (
        <section>
          <h3 className="mb-2 font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">
            Mudanças
          </h3>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-sm border border-border px-2 py-1 font-mono text-xs text-ink-dim">
              {files.length} {files.length === 1 ? 'arquivo' : 'arquivos'}
            </span>
            <span className="rounded-sm border border-border px-2 py-1 font-mono text-xs text-ink-dim">
              testes {report.changeAnalysis.hasTests ? 'sim' : 'não'}
            </span>
            <span className="rounded-sm border border-border px-2 py-1 font-mono text-xs text-ink-dim">
              migration {report.changeAnalysis.hasMigration ? 'sim' : 'não'}
            </span>
          </div>
          {visibleFiles.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1">
              {visibleFiles.map((file) => (
                <li key={file.path} className="font-mono text-xs text-ink-faint">
                  <span className="text-ink-dim">{file.kind}</span>
                  <span className="mx-2">·</span>
                  {file.path}
                </li>
              ))}
              {hiddenFiles > 0 && (
                <li className="font-mono text-xs text-ink-faint">+ {hiddenFiles} arquivos</li>
              )}
            </ul>
          )}
        </section>
      )}

      {visibleResults.length > 0 && (focus === 'all' || focus === 'test' || focus === 'architecture') && (
        <div className="grid grid-cols-2 gap-3">
          {visibleResults.map((result) => (
            <div key={result.name} className="rounded-sm border border-border px-4 py-3">
              <p className="font-mono text-[10px] tracking-wider text-ink-faint uppercase">
                {reviewerLabel(result.name)}
              </p>
              <p className={`font-display text-2xl font-semibold ${scoreTone(result.score)}`}>
                {result.score}
              </p>
            </div>
          ))}
        </div>
      )}

      {focus === 'all' && report.usage && report.usage.steps.length > 0 && (
        <section>
          <h3 className="mb-2 font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">
            Custo por etapa
          </h3>
          <ul className="flex flex-col border-y border-border">
            {report.usage.steps.map((step) => (
              <li
                key={step.step}
                className={`flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-0 font-mono text-xs tabular-nums ${
                  step.skipped ? 'text-ink-faint' : 'text-ink'
                }`}
              >
                <span>
                  {step.label}
                  <span className="ml-2 text-ink-faint">{step.model ?? '—'}</span>
                </span>
                <span>
                  {step.skipped
                    ? 'sem LLM'
                    : `${formatTokens(step.promptTokens)} in / ${formatTokens(step.completionTokens)} out · ${formatUsd(step.costUsd)}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(focus === 'all' || focus === 'prd') && report.prd && <PrdBlock prd={report.prd} />}
      {(focus === 'all' || focus === 'spec') && report.spec && <SpecBlock spec={report.spec} />}

      {(focus === 'all' || focus === 'comments' || focus === 'test' || focus === 'architecture') && visibleActionable.length > 0 && (
        <section>
          <h3 className="mb-2 font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">
            O que precisa de atenção
          </h3>
          <ul>
            {visibleActionable.map((comment, index) => (
              <CommentRow key={`${comment.reviewer}-${comment.title}-${index}`} comment={comment} />
            ))}
          </ul>
        </section>
      )}

      {(focus === 'all' || focus === 'comments' || focus === 'test' || focus === 'architecture') && visibleComments.some((item) => item.status === 'pass') && (
        <section>
          <h3 className="mb-2 font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">
            O que passou
          </h3>
          <ul>
            {visibleComments
              .filter((item) => item.status === 'pass')
              .map((comment, index) => (
                <CommentRow key={`pass-${comment.reviewer}-${comment.title}-${index}`} comment={comment} />
              ))}
          </ul>
        </section>
      )}

      {focus === 'all' && report.markdown && <ReportMarkdown markdown={report.markdown} />}
    </div>
  );
}
