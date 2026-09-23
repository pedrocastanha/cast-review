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
  return rightSideContentLines(patch).map((entry) => entry.line);
}

function rightSideContentLines(
  patch: string,
): Array<{ line: number; content: string }> {
  const lines: Array<{ line: number; content: string }> = [];
  let newLine = 0;

  for (const raw of patch.split('\n')) {
    const header = raw.match(HUNK_HEADER);
    if (header) {
      newLine = Number(header[1]);
      continue;
    }
    if (!newLine || raw.startsWith('\\')) continue;
    if (raw.startsWith('-')) continue;
    if (raw.startsWith('+')) {
      lines.push({ line: newLine, content: raw.slice(1).replace(/\r$/, '') });
      newLine += 1;
      continue;
    }
    if (raw.startsWith(' ')) {
      lines.push({ line: newLine, content: raw.slice(1).replace(/\r$/, '') });
      newLine += 1;
    }
  }

  return lines;
}

export function resolveAnchor(
  path: string | undefined,
  line: number | undefined,
  evidence: string | undefined,
  files: PullFileForAnchor[],
): ResolvedAnchor | null {
  if (!path || !line || line <= 0 || !evidence?.trim()) return null;
  const normalized = normalizeRepoPath(path);
  if (!normalized) return null;

  const file = files.find(
    (item) => normalizeRepoPath(item.filename) === normalized,
  );
  if (!file || file.status === 'removed' || !file.patch?.trim()) return null;

  const rightSideContent = rightSideContentLines(file.patch);
  const rights = rightSideContent.map((entry) => entry.line);
  if (rights.length === 0) return null;

  const startIndex = rights.indexOf(line);
  if (startIndex < 0) return null;

  const evidenceLines = evidence.replace(/\r\n?/g, '\n').split('\n');
  const contentByLine = new Map<number, string>();
  for (const entry of rightSideContent) {
    contentByLine.set(entry.line, entry.content);
  }
  if (
    evidenceLines.length > 10 ||
    !evidenceLines.some((item) => item.trim()) ||
    evidenceLines.some(
      (expected, offset) =>
        contentByLine.get(line + offset) !== expected,
    )
  ) {
    return null;
  }

  if (evidenceLines.length > 1) {
    const endLine = line + evidenceLines.length - 1;
    const endIndex = rights.indexOf(endLine);
    if (endIndex - startIndex === evidenceLines.length - 1) {
      return { path: file.filename, line: endLine, startLine: line };
    }
    return null;
  }

  return { path: file.filename, line };
}
