import { createHash } from 'node:crypto';
import type { GithubAppRepositoryConfig } from './github-app.types';

export function hashRepositoryConfig(
  config: GithubAppRepositoryConfig,
): string {
  const material = JSON.stringify({
    models: config.models,
    impactScope: config.impactScope,
    publishPolicy: config.publishPolicy,
    staleIndexBehavior: config.staleIndexBehavior,
  });
  return createHash('sha256').update(material).digest('hex');
}

export function budgetMonthFor(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
