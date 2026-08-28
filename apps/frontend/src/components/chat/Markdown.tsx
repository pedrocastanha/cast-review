import { Fragment, type ReactNode } from 'react';

const FENCE = /```(\w+)?\n([\s\S]*?)```/g;
const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).map((piece, index) => {
    const key = `${keyPrefix}-${index}`;

    if (piece.startsWith('`') && piece.endsWith('`') && piece.length > 1) {
      return (
        <code
          key={key}
          className="rounded-[3px] bg-surface-2 px-1 py-0.5 font-mono text-[0.86em] text-accent"
        >
          {piece.slice(1, -1)}
        </code>
      );
    }

    if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 3) {
      return (
        <strong key={key} className="font-semibold text-ink">
          {piece.slice(2, -2)}
        </strong>
      );
    }

    return <Fragment key={key}>{piece}</Fragment>;
  });
}

function CodeBlock({ language, code }: { language?: string; code: string }) {
  return (
    <div className="my-3 overflow-hidden rounded-sm border border-border">
      {language && (
        <div className="border-b border-border bg-surface-2 px-3 py-1 font-mono text-[10.5px] tracking-[0.08em] text-ink-faint uppercase">
          {language}
        </div>
      )}
      <pre className="overflow-x-auto bg-surface-2 p-3">
        <code className="font-mono text-[12.5px] leading-6 text-ink">{code}</code>
      </pre>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  FENCE.lastIndex = 0;
  match = FENCE.exec(text);
  while (match !== null) {
    if (match.index > cursor) {
      const chunk = text.slice(cursor, match.index);
      blocks.push(
        <span key={`t-${cursor}`} className="whitespace-pre-wrap">
          {renderInline(chunk, `t-${cursor}`)}
        </span>,
      );
    }
    blocks.push(
      <CodeBlock
        key={`c-${match.index}`}
        language={match[1]}
        code={match[2].replace(/\n$/, '')}
      />,
    );
    cursor = match.index + match[0].length;
    match = FENCE.exec(text);
  }

  if (cursor < text.length) {
    const chunk = text.slice(cursor);
    blocks.push(
      <span key={`t-${cursor}`} className="whitespace-pre-wrap">
        {renderInline(chunk, `t-${cursor}`)}
      </span>,
    );
  }

  return <>{blocks}</>;
}
