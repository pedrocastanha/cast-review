import type { ProjectIndexStatus } from '../types';
import type { CardStatus, FeatureCard } from '../types/feature-cards.ts';

export function groupCards(cards: FeatureCard[], featureId = '', search = '') {
  const groups: Record<CardStatus, FeatureCard[]> = { draft: [], ready: [], in_progress: [], review: [], done: [] };
  const needle = search.trim().toLocaleLowerCase();
  for (const card of cards) {
    if (!card.active || (featureId && card.id !== featureId && card.parentId !== featureId)) continue;
    if (needle && !`${card.title} ${card.area}`.toLocaleLowerCase().includes(needle)) continue;
    groups[card.status].push(card);
  }
  for (const group of Object.values(groups)) group.sort((a, b) => Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)) || a.title.localeCompare(b.title));
  return groups;
}

export function staleCardRepositories(card: FeatureCard, status: ProjectIndexStatus | null) {
  const current = new Map((status?.repositories ?? []).map((repo) => [repo.repository, repo]));
  return card.snapshot.repositories.filter((repo) => {
    const indexed = current.get(repo.repoId);
    return !repo.included || !repo.sha || !indexed || indexed.status !== 'indexed' || indexed.sha !== repo.sha || indexed.stale;
  }).map((repo) => repo.repoId);
}
