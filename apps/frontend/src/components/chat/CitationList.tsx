import type { ChatCitation } from '../../types';

interface CitationListProps {
  citations: ChatCitation[];
  shaByRepo: Record<string, string>;
}

function githubLink(citation: ChatCitation, sha: string | undefined): string | null {
  if (!sha) return null;
  const anchor = citation.line !== null ? `#L${citation.line}` : '';
  return `https://github.com/${citation.repoId}/blob/${sha}/${citation.path}${anchor}`;
}

export function CitationList({ citations, shaByRepo }: CitationListProps) {
  if (citations.length === 0) return null;

  const chip =
    'inline-flex max-w-full items-baseline gap-1.5 rounded-md border border-border bg-surface-1 px-2 py-1 font-mono text-[11px] text-ink-dim';

  return (
    <div className="mt-4">
      <p className="font-mono text-[10px] tracking-[0.1em] text-ink-faint uppercase">
        Evidência
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {citations.map((citation) => {
          const href = githubLink(citation, shaByRepo[citation.repoId]);
          const label = (
            <>
              <span className="truncate">{citation.path.split('/').pop()}</span>
              {citation.line !== null && (
                <span className="text-ink-faint">:{citation.line}</span>
              )}
              {citation.symbolName && (
                <span className="truncate text-accent">{citation.symbolName}</span>
              )}
            </>
          );

          return (
            <li
              key={`${citation.repoId}:${citation.path}:${citation.line}:${citation.symbolId}`}
            >
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  title={`${citation.repoId} → ${citation.path}`}
                  className={`${chip} transition-colors hover:border-accent hover:text-ink`}
                >
                  {label}
                </a>
              ) : (
                <span title={`${citation.repoId} → ${citation.path}`} className={chip}>
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
