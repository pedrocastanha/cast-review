import { useEffect, useState } from 'react';
import type { ApproveStagePayload, ApprovePublishPayload } from '../../api/analyses.api';
import type { Annotation } from '../../types';
import { Button } from '../ui/Button';
import { ExcerptCommentEditor } from './ExcerptCommentEditor';
import { ReportMarkdown } from './ReportMarkdown';

export type ApprovalGateStage = 'prd' | 'spec' | 'publish';

export type ApprovalGatePayload = ApproveStagePayload | ApprovePublishPayload;

interface ApprovalGateProps {
  analysisId: string;
  stage: ApprovalGateStage;
  content: string;
  iteration: number | null;
  apiKeys: { openai: string };
  models: { testReviewer: string; architectureReviewer: string };
  onApprove: (payload: ApprovalGatePayload) => void | Promise<void>;
  onReject: (payload: ApprovalGatePayload) => void | Promise<void>;
}

const STAGE_LABELS: Record<ApprovalGateStage, string> = {
  prd: 'PRD',
  spec: 'Especificação técnica',
  publish: 'Publicação',
};

export function ApprovalGate({
  analysisId,
  stage,
  content,
  iteration,
  apiKeys,
  models,
  onApprove,
  onReject,
}: ApprovalGateProps) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setAnnotations([]);
    setConfirmingPublish(false);
    setSubmitting(false);
  }, [stage, iteration]);

  const runAction = async (action: (payload: ApprovalGatePayload) => void | Promise<void>, payload: ApprovalGatePayload) => {
    setSubmitting(true);
    try {
      await action(payload);
    } finally {
      setSubmitting(false);
    }
  };

  const handleApproveStage = () => {
    if (stage === 'publish') return;
    void runAction(onApprove, {
      stage,
      decision: 'approve',
      models,
      apiKeys,
    });
  };

  const handleRejectStage = () => {
    if (stage === 'publish' || annotations.length === 0) return;
    void runAction(onReject, {
      stage,
      decision: 'reject',
      annotations,
      models,
      apiKeys,
    });
  };

  const handleApprovePublishClick = () => {
    if (!confirmingPublish) {
      setConfirmingPublish(true);
      return;
    }
    void runAction(onApprove, { decision: 'approve' });
  };

  const handleRejectPublish = () => {
    void runAction(onReject, { decision: 'reject' });
  };

  return (
    <div
      data-analysis-id={analysisId}
      className="rounded-sm border border-state-draft/40 bg-state-draft-dim/40 px-5 py-5"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-mono text-xs tracking-[0.14em] text-ink-faint uppercase">
          Aprovação · {STAGE_LABELS[stage]}
        </h2>
        {iteration !== null && (
          <span className="font-mono text-xs tabular-nums text-ink-faint">
            Iteração {iteration}
          </span>
        )}
      </div>

      {stage === 'publish' ? (
        <div className="flex flex-col gap-4">
          <div className="max-h-80 overflow-auto rounded-sm border border-border bg-surface-1 p-3">
            <ReportMarkdown markdown={content} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {!confirmingPublish && (
              <Button type="button" variant="danger" disabled={submitting} onClick={handleRejectPublish}>
                Rejeitar
              </Button>
            )}
            {confirmingPublish && (
              <Button
                type="button"
                variant="ghost"
                disabled={submitting}
                onClick={() => setConfirmingPublish(false)}
              >
                Cancelar
              </Button>
            )}
            <Button
              type="button"
              variant="primary"
              loading={submitting}
              onClick={handleApprovePublishClick}
            >
              {confirmingPublish ? 'Confirmar publicação?' : 'Aprovar publicação'}
            </Button>
          </div>
          {confirmingPublish && (
            <p className="font-mono text-[11px] text-ink-faint">
              Publicar comenta na PR de verdade e não pode ser desfeito.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <ExcerptCommentEditor content={content} onAnnotationsChange={setAnnotations} />

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="danger"
              disabled={annotations.length === 0 || submitting}
              onClick={handleRejectStage}
            >
              Pedir revisão
            </Button>
            <Button type="button" variant="primary" loading={submitting} onClick={handleApproveStage}>
              Aprovar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
