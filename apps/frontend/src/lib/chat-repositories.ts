export function activeRepositoryQuery(
  value: string,
  caret: number,
): string | null {
  const match = value.slice(0, caret).match(/^\/([^\s]*)$/);
  return match?.[1] ?? null;
}

export function insertRepositoryMarker(
  value: string,
  caret: number,
  repoId: string,
): string {
  const active = activeRepositoryQuery(value, caret);
  if (active === null) return value;
  const current = value.match(/^\/\S*/)?.[0] ?? value.slice(0, caret);
  const suffix = value.slice(current.length).trimStart();
  return `/${repoId}${suffix ? ` ${suffix}` : ' '}`;
}

export function repositoryHintFor(
  value: string,
  selectedRepoId: string | null,
): string | null {
  if (!selectedRepoId) return null;
  const repoId = value.match(/^\/([^\s]+)/)?.[1];
  return repoId === selectedRepoId ? selectedRepoId : null;
}
