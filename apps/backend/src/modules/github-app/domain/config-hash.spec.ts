import { defaultRepositoryConfig } from './github-app.types';
import { budgetMonthFor, hashRepositoryConfig } from './config-hash';

describe('hashRepositoryConfig', () => {
  it('is stable for the same configuration', () => {
    const config = defaultRepositoryConfig();
    expect(hashRepositoryConfig(config)).toBe(
      hashRepositoryConfig({ ...config }),
    );
  });

  it('changes when a setting that affects the analysis changes', () => {
    const base = defaultRepositoryConfig();
    const withModels = {
      ...base,
      models: { testReviewer: 'gpt-5.4', architectureReviewer: 'gpt-5.4' },
    };
    expect(hashRepositoryConfig(base)).not.toBe(
      hashRepositoryConfig(withModels),
    );
  });

  it('ignores settings that only gate the event, not the analysis', () => {
    const base = defaultRepositoryConfig();
    const withEvents = {
      ...base,
      includeDrafts: true,
      baseBranches: ['main'],
      events: { opened: false, reopened: false, synchronize: true },
    };
    expect(hashRepositoryConfig(base)).toBe(hashRepositoryConfig(withEvents));
  });
});

describe('budgetMonthFor', () => {
  it('formats the UTC month as YYYY-MM', () => {
    expect(budgetMonthFor(new Date('2026-09-01T02:00:00Z'))).toBe('2026-09');
    expect(budgetMonthFor(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12');
  });
});
