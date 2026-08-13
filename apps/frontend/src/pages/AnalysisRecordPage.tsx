import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { analysesApi } from '../api/analyses.api';
import { ApiError } from '../api/http';
import { hasReviewContent } from '../lib/assemble-report';
import { AnalysisStatusBadge } from '../components/analysis/AnalysisStatusBadge';
import { ReportView } from '../components/analysis/ReportView';
import { ThoughtLog } from '../components/analysis/ThoughtLog';
import { Spinner } from '../components/ui/Spinner';
import { GithubCommentsStatus } from '../components/analysis/GithubCommentsStatus';
import { formatUsageHeadline } from '../lib/format-usage';
import type { AnalysisRecord } from '../types';

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function AnalysisRecordPage() {
  const { owner = '', repo = '', analysisId = '' } = useParams();
  const [record, setRecord] = useState<AnalysisRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!analysisId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    analysesApi
      .getById(analysisId)
      .then((data) => {
        if (!cancelled) setRecord(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Não foi possível carregar essa análise.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  const pullsPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`;
  const thoughts = record?.thoughts ?? {};
  const hasThoughts = Object.values(thoughts).some((text) => text.length > 0);

  return (
    <div>
      <div className="mb-8">
        <Link to={pullsPath} className="text-sm text-ink-faint hover:text-ink">
          ← Pull requests
        </Link>
        <p className="mt-3 mb-1 font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">
          Análise salva
        </p>
        <h1 className="font-display text-xl font-semibold text-ink">
          {record ? `PR #${record.pullNumber}` : 'Análise'}
        </h1>
        <p className="mt-1 font-mono text-xs text-ink-faint">
          {owner}/{repo}
        </p>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      )}

      {!loading && error && (
        <p className="rounded-sm border border-state-closed/40 bg-state-closed-dim px-4 py-3 text-sm">
          {error}
        </p>
      )}

      {!loading && record && (
        <div className="flex flex-col gap-8">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-border py-4 font-mono text-xs">
            <div>
              <dt className="text-ink-faint">Status</dt>
              <dd className="mt-1">
                <AnalysisStatusBadge status={record.status} />
              </dd>
            </div>
            <div>
              <dt className="text-ink-faint">Quando</dt>
              <dd className="mt-1.5 text-ink">
                {Number.isNaN(new Date(record.createdAt).getTime())
                  ? '—'
                  : dateTimeFormatter.format(new Date(record.createdAt))}
              </dd>
            </div>
            {record.models && (
              <div className="col-span-2">
                <dt className="text-ink-faint">Modelos</dt>
                <dd className="mt-0.5 text-ink">
                  {record.models.testReviewer} · {record.models.architectureReviewer}
                </dd>
              </div>
            )}
            {record.report?.usage && (
              <div className="col-span-2">
                <dt className="text-ink-faint">Custo</dt>
                <dd className="mt-0.5 text-ink tabular-nums">
                  {formatUsageHeadline(record.report.usage)}
                  {record.status === 'error' && !record.report.usage.costComplete && ' · parcial'}
                </dd>
              </div>
            )}
            {record.report?.githubComments && (
              <div className="col-span-2">
                <dt className="text-ink-faint">GitHub</dt>
                <dd className="mt-0.5">
                  <GithubCommentsStatus result={record.report.githubComments} />
                </dd>
              </div>
            )}
          </dl>

          {record.errorMessage && (
            <p className="rounded-sm border border-state-closed/40 bg-state-closed-dim px-4 py-3 text-sm">
              {record.errorMessage}
            </p>
          )}

          {hasThoughts && (
            <section>
              <h2 className="mb-3 font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">
                Pensamento
              </h2>
              <ThoughtLog thoughts={thoughts} running={record.status === 'running'} />
            </section>
          )}

          {hasReviewContent(record.report) && record.report && (
            <ReportView report={record.report} />
          )}

          {!record.report?.markdown &&
            !record.report?.results?.length &&
            !record.report?.prd &&
            record.status === 'running' && (
              <p className="font-mono text-xs text-ink-faint">
                Essa análise ainda está rodando. O review aparece aqui conforme os agentes terminam.
              </p>
            )}
        </div>
      )}
    </div>
  );
}
