import type { ChatMention } from '../types';

export const MAX_MENTIONS = 10;

export function activeMentionQuery(value: string, caret: number): string | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;
  const fragment = before.slice(at + 1);
  if (/\s/.test(fragment)) return null;
  return fragment;
}

export function insertMention(
  value: string,
  caret: number,
  path: string,
): string {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1) return value;
  return `${value.slice(0, at)}@${path} ${value.slice(caret)}`;
}

export function addMention(
  current: ChatMention[],
  mention: ChatMention,
): ChatMention[] {
  const exists = current.some(
    (item) => item.repoId === mention.repoId && item.path === mention.path,
  );
  if (exists || current.length >= MAX_MENTIONS) return current;
  return [...current, mention];
}

export function usedMentions(
  value: string,
  mentions: ChatMention[],
): ChatMention[] {
  return mentions.filter((mention) => value.includes(`@${mention.path}`));
}
