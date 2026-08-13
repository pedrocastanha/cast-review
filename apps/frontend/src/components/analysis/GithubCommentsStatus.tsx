import type { GithubCommentsResult } from '../../types';

export function GithubCommentsStatus({ result }: { result: GithubCommentsResult }) {
  if (result.status === 'empty') {
    return <p className="font-mono text-xs text-ink-faint">Nada a comentar na PR</p>;
  }

  if (result.status === 'error') {
    return (
      <p className="font-mono text-xs text-state-closed">
        Não deu pra comentar na PR
        {result.errorMessage ? ` · ${result.errorMessage}` : ''}
      </p>
    );
  }

  const label = `Postado na PR · ${result.posted} comentário${result.posted === 1 ? '' : 's'}`;
  if (result.htmlUrl) {
    return (
      <a
        href={result.htmlUrl}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-xs text-ink hover:text-accent"
      >
        {label} ↗
      </a>
    );
  }

  return <p className="font-mono text-xs text-ink">{label}</p>;
}
