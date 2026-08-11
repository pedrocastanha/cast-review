/**
 * Contratos compartilhados entre módulos Nest e (conceitualmente) o front.
 *
 * POR QUÊ ESTE ARQUIVO
 * --------------------
 * Mantém os shapes de request/response num único lugar tipado.
 * O Python tem o espelho em schemas.py — a fronteira é HTTP JSON,
 * não import cruzado de código.
 */

/** Body de POST /auth/validate */
export interface ValidatePatDtoShape {
  /** GitHub Personal Access Token (classic ou fine-grained). */
  token: string;
}

/** Resposta de autenticação bem-sucedida. */
export interface AuthUser {
  login: string;
  id: number;
  name: string | null;
  avatarUrl: string;
}

/** Arquivo relacionado resolvido pelo Context Builder. */
export interface RelatedFile {
  path: string;
  content: string;
}

/**
 * Pacote rico por arquivo alterado — enviado ao Python em /agent/run.
 * camelCase alinhado ao AgentRunRequest do ai-api.
 */
export interface ChangedFileContext {
  path: string;
  diff: string;
  fullContent: string;
  relatedFiles: RelatedFile[];
}

/** Envelope de evento SSE/WS repassado 1:1 do Python ao front. */
export type AgentEventType =
  | 'change_analysis_done'
  | 'spec_generated'
  | 'test_reviewer_done'
  | 'architecture_reviewer_done'
  | 'report_ready'
  | 'error';

export interface AgentEvent {
  type: AgentEventType;
  payload: Record<string, unknown>;
}

/** Body de `POST /agent/run` no ai-api — espelha `AgentRunRequest` em schemas.py. */
export interface AgentRunRequest {
  diff: string;
  changedFiles: ChangedFileContext[];
  conventions: string;
  models: {
    testReviewer: string;
    architectureReviewer: string;
  };
  apiKeys: {
    anthropic: string;
  };
}
