import type { Finding, PrdPayload, ReportPayload, ReviewComment, SpecPayload } from '../../types';
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
    </li>
  );
}

function stringList(items: string[] | undefined) {
  return items?.filter((item) => item.trim().length > 0) ?? [];
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

export function ReportView({ report }: { report: ReportPayload }) {
  const results = report.results ?? [];
  const comments: ReviewComment[] =
    report.comments?.length
      ? report.comments
      : results.flatMap((result) =>
          result.findings.map((finding) => ({ reviewer: result.name, ...finding })),
        );
  const files = report.changeAnalysis?.files ?? [];

  return (
    <div className="flex flex-col gap-8">
      {report.changeAnalysis && (
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
          {files.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1">
              {files.map((file) => (
                <li key={file.path} className="font-mono text-xs text-ink-faint">
                  <span className="text-ink-dim">{file.kind}</span>
                  <span className="mx-2">·</span>
                  {file.path}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {results.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {results.map((result) => (
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

      {report.prd && <PrdBlock prd={report.prd} />}
      {report.spec && <SpecBlock spec={report.spec} />}

      {comments.length > 0 && (
        <section>
          <h3 className="mb-2 font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">
            Comentários
          </h3>
          <ul>
            {comments.map((comment, index) => (
              <CommentRow key={`${comment.reviewer}-${comment.title}-${index}`} comment={comment} />
            ))}
          </ul>
        </section>
      )}

      {report.markdown && <ReportMarkdown markdown={report.markdown} />}
    </div>
  );
}
