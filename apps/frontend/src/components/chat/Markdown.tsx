import { Fragment, type ReactNode } from 'react';

const FENCE = /```(\w+)?\n([\s\S]*?)```/g;
const INLINE =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\)|(?<![*\w])\*[^*\n]+\*(?![*\w]))/g;
const LINK = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

const HEADING_CLASS: Record<number, string> = {
  1: 'font-display text-[19px] leading-7 font-bold text-ink',
  2: 'font-display text-[17px] leading-7 font-bold text-ink',
  3: 'font-display text-[15.5px] leading-6 font-bold text-ink',
  4: 'text-[14.5px] leading-6 font-semibold text-ink',
  5: 'text-[13.5px] leading-6 font-semibold text-ink-dim',
  6: 'font-mono text-[11px] tracking-[0.08em] text-ink-faint uppercase',
};

interface ListItem {
  depth: number;
  content: string;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(INLINE)
    .filter((piece) => piece !== undefined && piece !== '')
    .map((piece, index) => {
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
            {renderInline(piece.slice(2, -2), `${key}-b`)}
          </strong>
        );
      }

      const link = LINK.exec(piece);
      if (link) {
        return (
          <a
            key={key}
            href={link[2]}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline underline-offset-2 hover:text-accent-hover"
          >
            {link[1]}
          </a>
        );
      }

      if (piece.startsWith('*') && piece.endsWith('*') && piece.length > 2) {
        return (
          <em key={key} className="italic">
            {renderInline(piece.slice(1, -1), `${key}-e`)}
          </em>
        );
      }

      return <Fragment key={key}>{piece}</Fragment>;
    });
}

function CodeBlock({ language, code }: { language?: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-sm border border-border">
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

function List({
  items,
  ordered,
  keyPrefix,
}: {
  items: ListItem[];
  ordered: boolean;
  keyPrefix: string;
}) {
  const base = Math.min(...items.map((item) => item.depth));
  const children = items.map((item, index) => {
    const level = Math.min(Math.round((item.depth - base) / 2), 3);
    return (
      <li
        key={`${keyPrefix}-i${index}`}
        className="ps-1 whitespace-pre-line"
        style={level > 0 ? { marginInlineStart: `${level * 1.1}rem` } : undefined}
      >
        {renderInline(item.content, `${keyPrefix}-i${index}`)}
      </li>
    );
  });

  const className = ordered
    ? 'list-decimal space-y-1 ps-5 marker:font-mono marker:text-[12px] marker:text-ink-faint'
    : 'list-disc space-y-1 ps-5 marker:text-ink-faint';

  return ordered ? (
    <ol className={className}>{children}</ol>
  ) : (
    <ul className={className}>{children}</ul>
  );
}

function parseBlocks(text: string, keyPrefix: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');

  let paragraph: string[] = [];
  let quote: string[] = [];
  let items: ListItem[] = [];
  let ordered = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const key = `${keyPrefix}-p${blocks.length}`;
    blocks.push(
      <p key={key} className="whitespace-pre-line">
        {renderInline(paragraph.join('\n'), key)}
      </p>,
    );
    paragraph = [];
  };

  const flushQuote = () => {
    if (quote.length === 0) return;
    const key = `${keyPrefix}-q${blocks.length}`;
    blocks.push(
      <blockquote
        key={key}
        className="border-s-2 border-border-strong ps-3 whitespace-pre-line text-ink-dim"
      >
        {renderInline(quote.join('\n'), key)}
      </blockquote>,
    );
    quote = [];
  };

  const flushList = () => {
    if (items.length === 0) return;
    const key = `${keyPrefix}-l${blocks.length}`;
    blocks.push(
      <List key={key} items={items} ordered={ordered} keyPrefix={key} />,
    );
    items = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushQuote();
    flushList();
  };

  for (const line of lines) {
    if (line.trim() === '') {
      flushAll();
      continue;
    }

    if (RULE.test(line)) {
      flushAll();
      blocks.push(
        <hr key={`${keyPrefix}-r${blocks.length}`} className="border-border" />,
      );
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const key = `${keyPrefix}-h${blocks.length}`;
      const Tag = `h${Math.min(level + 1, 6)}` as 'h2';
      blocks.push(
        <Tag key={key} className={`pt-1 ${HEADING_CLASS[level]}`}>
          {renderInline(heading[2], key)}
        </Tag>,
      );
      continue;
    }

    const quoted = QUOTE.exec(line);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
      continue;
    }

    const orderedItem = ORDERED.exec(line);
    if (orderedItem) {
      flushParagraph();
      flushQuote();
      if (items.length > 0 && !ordered) flushList();
      ordered = true;
      items.push({ depth: orderedItem[1].length, content: orderedItem[3] });
      continue;
    }

    const bulletItem = BULLET.exec(line);
    if (bulletItem) {
      flushParagraph();
      flushQuote();
      if (items.length > 0 && ordered) flushList();
      ordered = false;
      items.push({ depth: bulletItem[1].length, content: bulletItem[2] });
      continue;
    }

    if (items.length > 0) {
      items[items.length - 1].content += `\n${line.trim()}`;
      continue;
    }

    flushQuote();
    paragraph.push(line);
  }

  flushAll();
  return blocks;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  FENCE.lastIndex = 0;
  match = FENCE.exec(text);
  while (match !== null) {
    if (match.index > cursor) {
      blocks.push(...parseBlocks(text.slice(cursor, match.index), `t-${cursor}`));
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
    blocks.push(...parseBlocks(text.slice(cursor), `t-${cursor}`));
  }

  return <div className="space-y-3">{blocks}</div>;
}
