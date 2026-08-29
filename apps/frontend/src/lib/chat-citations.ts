import type { ChatCitation } from '../types';

export interface CitationGroup {
  repoId: string;
  citations: ChatCitation[];
}

export function groupCitations(citations: ChatCitation[]): CitationGroup[] {
  const groups = new Map<string, ChatCitation[]>();
  for (const citation of citations) {
    const current = groups.get(citation.repoId) ?? [];
    current.push(citation);
    groups.set(citation.repoId, current);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'pt-BR'))
    .map(([repoId, items]) => ({
      repoId,
      citations: [...items].sort(
        (left, right) =>
          left.path.localeCompare(right.path, 'pt-BR') ||
          (left.line ?? 0) - (right.line ?? 0),
      ),
    }));
}

function pathSegments(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

export function citationGithubUrl(
  citation: ChatCitation,
  shaByRepo: Record<string, string>,
): string | null {
  const sha = citation.sha ?? shaByRepo[citation.repoId];
  if (!sha) return null;
  const anchor = citation.line !== null ? `#L${citation.line}` : '';
  return `https://github.com/${pathSegments(citation.repoId)}/blob/${encodeURIComponent(sha)}/${pathSegments(citation.path)}${anchor}`;
}

export function citationGraphUrl(citation: ChatCitation): string | null {
  if (!citation.symbolId) return null;
  return `/repos/${pathSegments(citation.repoId)}/graph?focus=${encodeURIComponent(citation.symbolId)}`;
}
