import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { benchmarksApi } from '../../api/benchmarks.api';
import { ApiError } from '../../api/http';

export function SaveBenchmarkButton({ analysisId }: { analysisId: string }) {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const benchmarkCase = await benchmarksApi.createFromAnalysis(analysisId);
      navigate(`/benchmarks?case=${encodeURIComponent(benchmarkCase.id)}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar o benchmark.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="inline-flex min-h-10 items-center rounded-sm border border-accent px-3.5 font-mono text-xs tracking-wide text-accent transition-colors hover:bg-accent hover:text-accent-ink disabled:cursor-wait disabled:opacity-60"
      >
        {saving ? 'Congelando caso…' : 'Salvar como benchmark'}
      </button>
      {error && <p className="text-xs text-state-closed">{error}</p>}
    </div>
  );
}
