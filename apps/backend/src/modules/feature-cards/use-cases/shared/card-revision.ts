import type { FeatureCard } from '../../entities/feature-card.entity';
import { FeatureCardRevision } from '../../entities/feature-card-revision.entity';

export function cardRevision(card: FeatureCard, actorId: string) {
  return new FeatureCardRevision({
    cardId: card.id,
    actorId,
    version: card.version,
    snapshot: JSON.parse(JSON.stringify(card)),
  });
}
