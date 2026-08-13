export type PullFileForAnchor = {
  filename: string;
  status: string;
  patch?: string;
};

export type ResolvedAnchor = {
  path: string;
  line: number;
  startLine?: number;
};

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function normalizeRepoPath(path: string): string {
  let next = path.trim().replaceAll('\\', '/');
  while (next.startsWith('./')) next = next.slice(2);
  next = next.replace(/^\/+/, '');
  const parts = next.split('/').filter((part) => part && part !== '.');
  if (parts.some((part) => part === '..')) return '';
  return parts.join('/');
}

export function rightSideLines(patch: string): number[] {
  const lines: number[] = [];
  let newLine = 0;

  for (const raw of patch.split('\n')) {
    const header = raw.match(HUNK_HEADER);
    if (header) {
      newLine = Number(header[1]);
      continue;
    }
    if (!newLine || raw.startsWith('\\')) continue;
    if (raw.startsWith('-')) continue;
    if (raw.startsWith('+') || raw.startsWith(' ')) {
      lines.push(newLine);
      newLine += 1;
    }
  }

  return lines;
}

export function resolveAnchor(
  path: string | undefined,
  line: number | undefined,
  files: PullFileForAnchor[],
  endLine?: number,
): ResolvedAnchor | null {
  if (!path || !line || line <= 0) return null;
  const normalized = normalizeRepoPath(path);
  if (!normalized) return null;

  const file = files.find(
    (item) => normalizeRepoPath(item.filename) === normalized,
  );
  if (!file || file.status === 'removed' || !file.patch?.trim()) return null;

  const rights = rightSideLines(file.patch);
  if (rights.length === 0) return null;

  const anchored =
    rights.find((value) => value === line) ??
    rights.reduce((best, value) =>
      Math.abs(value - line) < Math.abs(best - line) ? value : best,
    );

  if (endLine && endLine > anchored && rights.includes(endLine)) {
    return { path: file.filename, line: endLine, startLine: anchored };
  }

  return { path: file.filename, line: anchored };
}

/** Primeiro arquivo da PR com hunk RIGHT — usado quando o finding não trouxe path. */
export function fallbackAnchor(files: PullFileForAnchor[]): ResolvedAnchor | null {
  for (const file of files) {
    if (file.status === 'removed' || !file.patch?.trim()) continue;
    const rights = rightSideLines(file.patch);
    if (rights.length === 0) continue;
    return { path: file.filename, line: rights[0] };
  }
  return null;
}
