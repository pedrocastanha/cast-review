export interface PullRequestEventFacts {
  installationId: string | null;
  githubRepoId: string | null;
  owner: string;
  repo: string;
  fullName: string;
  pullNumber: number;
  headSha: string;
  baseRef: string;
  draft: boolean;
  state: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function extractPullRequestFacts(
  payload: Record<string, unknown>,
): PullRequestEventFacts | null {
  const pull = asRecord(payload.pull_request);
  const repository = asRecord(payload.repository);
  const installation = asRecord(payload.installation);
  const head = pull ? asRecord(pull.head) : null;
  const base = pull ? asRecord(pull.base) : null;
  const owner = repository ? asRecord(repository.owner) : null;

  if (!pull || !repository || !head || !base) return null;
  if (typeof pull.number !== 'number' || typeof head.sha !== 'string')
    return null;

  return {
    installationId:
      installation && typeof installation.id === 'number'
        ? String(installation.id)
        : null,
    githubRepoId:
      typeof repository.id === 'number' ? String(repository.id) : null,
    owner: typeof owner?.login === 'string' ? owner.login : '',
    repo: typeof repository.name === 'string' ? repository.name : '',
    fullName:
      typeof repository.full_name === 'string' ? repository.full_name : '',
    pullNumber: pull.number,
    headSha: head.sha,
    baseRef: typeof base.ref === 'string' ? base.ref : '',
    draft: pull.draft === true,
    state: typeof pull.state === 'string' ? pull.state : 'open',
  };
}

export function redactPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const facts = extractPullRequestFacts(payload);
  return {
    action: payload.action ?? null,
    ...(facts
      ? {
          repository: facts.fullName,
          pullNumber: facts.pullNumber,
          headSha: facts.headSha,
          baseRef: facts.baseRef,
          draft: facts.draft,
          state: facts.state,
        }
      : {}),
  };
}
