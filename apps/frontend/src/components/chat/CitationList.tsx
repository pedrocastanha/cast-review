import { Link } from 'react-router-dom';
import {
  citationGithubUrl,
  citationGraphUrl,
  groupCitations,
} from '../../lib/chat-citations';
import type { ChatCitation } from '../../types';

interface CitationListProps {
  citations: ChatCitation[];
  shaByRepo: Record<string, string>;
}

export function CitationList({ citations, shaByRepo }: CitationListProps) {
  if (citations.length === 0) return null;
  const groups = groupCitations(citations);

  return (
    <details className="group/evidence mt-4 rounded-lg border border-border bg-surface-1">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 font-mono text-[10.5px] text-ink-dim marker:hidden hover:text-ink">
        <span className="grid size-5 place-items-center rounded border border-border bg-surface-2 text-[10px] text-accent">
          {citations.length}
        </span>
        <span className="font-semibold tracking-[0.08em] uppercase">
          Evidências
        </span>
        <span className="text-ink-faint">
          {groups.length} repo{groups.length === 1 ? '' : 's'}
        </span>
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
          className="ml-auto size-3.5 text-ink-faint transition-transform group-open/evidence:rotate-180"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </summary>

      <div className="border-t border-border px-3 py-3">
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.repoId}>
              <h3 className="flex items-center gap-2 font-mono text-[10px] tracking-[0.08em] text-accent uppercase">
                <span className="size-1.5 rounded-full bg-accent" />
                {group.repoId}
              </h3>
              <ul className="mt-1.5 divide-y divide-border border-y border-border">
                {group.citations.map((citation) => {
                  const githubUrl = citationGithubUrl(citation, shaByRepo);
                  const graphUrl = citationGraphUrl(citation);
                  return (
                    <li
                      key={`${citation.repoId}:${citation.path}:${citation.line}:${citation.symbolId}`}
                      className="flex min-w-0 items-center gap-2 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        {githubUrl ? (
                          <a
                            href={githubUrl}
                            target="_blank"
                            rel="noreferrer"
                            title={`${citation.repoId} → ${citation.path}`}
                            className="block truncate font-mono text-[11px] text-ink-dim transition-colors hover:text-accent"
                          >
                            {citation.path}
                            {citation.line !== null ? `:${citation.line}` : ''}
                          </a>
                        ) : (
                          <span className="block truncate font-mono text-[11px] text-ink-dim">
                            {citation.path}
                            {citation.line !== null ? `:${citation.line}` : ''}
                          </span>
                        )}
                        {citation.symbolName && (
                          <span className="mt-0.5 block truncate font-mono text-[10px] text-ink-faint">
                            {citation.symbolName}
                          </span>
                        )}
                      </div>
                      {graphUrl && (
                        <Link
                          to={graphUrl}
                          className="shrink-0 rounded-md border border-border px-2 py-1 font-mono text-[9px] text-ink-faint transition-colors hover:border-accent hover:text-accent"
                        >
                          grafo
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </details>
  );
}
