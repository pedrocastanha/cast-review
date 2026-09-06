import type { ProjectIndexStatus } from '../types';
import { CARD_COLUMNS, type CardStatus, type FeatureCard } from '../types/feature-cards.ts';

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

/** Dependências que ainda não foram concluídas — o que de fato bloqueia o card. */
export function blockingCards(card: FeatureCard, byId: Map<string, FeatureCard>) {
  return card.dependsOn
    .map((id) => byId.get(id))
    .filter((dependency): dependency is FeatureCard => Boolean(dependency?.active) && dependency!.status !== 'done');
}

/** Etapa vizinha no fluxo, ou null nas pontas. */
export function adjacentStatus(status: CardStatus, delta: 1 | -1): CardStatus | null {
  const index = CARD_COLUMNS.findIndex((column) => column.status === status);
  if (index < 0) return null;
  return CARD_COLUMNS[index + delta]?.status ?? null;
}

/** Procedência do card: SHA curto do contexto usado, ou hipótese não ancorada em código. */
export function cardSeal(card: FeatureCard) {
  const anchored = card.snapshot.repositories.find((repo) => repo.included && repo.sha);
  return { grounded: card.snapshot.confidence === 'grounded', sha: anchored?.sha?.slice(0, 7) ?? null };
}
