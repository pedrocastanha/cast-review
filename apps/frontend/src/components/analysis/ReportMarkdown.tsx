function inline(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={index} className="rounded-sm bg-surface-3 px-1 font-mono text-[0.8em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
}

function headingClass(level: number) {
  if (level === 1) return 'font-display text-lg font-semibold text-ink';
  if (level === 2) return 'mt-2 font-display text-base font-semibold text-ink';
  return 'font-mono text-xs tracking-wide text-ink-faint uppercase';
}

export function ReportMarkdown({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');

  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed text-ink-dim">
      {lines.map((line, index) => {
        if (!line.trim()) return <div key={index} className="h-2" />;
        const heading = /^(#{1,3})\s+(.*)$/.exec(line);
        if (heading) {
          const Tag = heading[1].length === 1 ? 'h2' : heading[1].length === 2 ? 'h3' : 'h4';
          return (
            <Tag key={index} className={headingClass(heading[1].length)}>
              {heading[2]}
            </Tag>
          );
        }
        if (line.startsWith('- ')) {
          return (
            <p key={index} className="pl-4 before:mr-2 before:content-['–']">
              {inline(line.slice(2))}
            </p>
          );
        }
        return <p key={index}>{inline(line)}</p>;
      })}
    </div>
  );
}
