import type { ChatMessage } from '../../types';
import { CitationList } from './CitationList';
import { Markdown } from './Markdown';
import { ToolTrace } from './ToolTrace';

interface MessageTurnProps {
  message: ChatMessage;
  shaByRepo: Record<string, string>;
}

export function MessageTurn({ message, shaByRepo }: MessageTurnProps) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-surface-2 px-4 py-2.5 text-[15px] leading-6 whitespace-pre-wrap text-ink">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <article className="text-[15px] leading-7 text-ink">
      <Markdown text={message.content} />

      {message.truncated && (
        <p className="mt-3 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-[13px] text-warn">
          Limite de investigação atingido — a resposta pode estar incompleta.
        </p>
      )}

      <ToolTrace calls={message.toolCalls} />
      <CitationList citations={message.citations} shaByRepo={shaByRepo} />

      <p className="mt-2 font-mono text-[10px] text-ink-faint">
        {message.model ?? 'modelo não registrado'}
        {message.usage
          ? ` · ${message.usage.promptTokens + message.usage.completionTokens} tokens · US$ ${message.usage.costUsd.toFixed(4)}`
          : ''}
      </p>
    </article>
  );
}
