import type { Finding, ReportPayload } from '../../types';
import { ReportMarkdown } from './ReportMarkdown';

function scoreTone(score: number) {
  if (score >= 90) return 'text-state-open';
  if (score >= 70) return 'text-ink';
  return 'text-state-closed';
}

function FindingRow({ finding }: { finding: Finding }) {
  const tone =
    finding.status === 'fail'
      ? 'text-state-closed'
      : finding.status === 'warning'
        ? 'text-accent'
        : 'text-state-open';

  return (
    <li className="border-b border-border py-2 last:border-0">
      <p className="text-sm text-ink">
        <span className={`font-mono text-xs uppercase ${tone}`}>{finding.status}</span>
        <span className="mx-2 text-ink-faint">·</span>
        {finding.title}
      </p>
      {finding.detail && <p className="mt-1 text-xs text-ink-faint">{finding.detail}</p>}
      {finding.conventionRef && (
        <p className="mt-1 font-mono text-xs text-ink-dim">ref: {finding.conventionRef}</p>
      )}
    </li>
  );
}

export function ReportView({ report }: { report: ReportPayload }) {
  return (
    <div className="flex flex-col gap-8">
      {report.results?.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {report.results.map((result) => (
            <div key={result.name} className="rounded-sm border border-border px-4 py-3">
              <p className="font-mono text-[10px] tracking-wider text-ink-faint uppercase">
                {result.name.replaceAll('_', ' ')}
              </p>
              <p className={`font-display text-2xl font-semibold ${scoreTone(result.score)}`}>
                {result.score}
              </p>
            </div>
          ))}
        </div>
      )}

      {report.results?.some((result) => result.findings.length > 0) && (
        <div>
          <h3 className="mb-2 font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">
            Findings
          </h3>
          <ul>
            {report.results.flatMap((result) =>
              result.findings.map((finding, index) => (
                <FindingRow key={`${result.name}-${index}`} finding={finding} />
              )),
            )}
          </ul>
        </div>
      )}

      {report.markdown && <ReportMarkdown markdown={report.markdown} />}
    </div>
  );
}
