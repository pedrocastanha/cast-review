import {
  candidatePathsFor,
  extractRelativeImportPaths,
} from './import-resolver.helper';

describe('candidatePathsFor', () => {
  it('tenta extensões em import Nest com ponto no nome (analyses.service)', () => {
    expect(
      candidatePathsFor('apps/backend/src/modules/analyses/analyses.service'),
    ).toEqual([
      'apps/backend/src/modules/analyses/analyses.service.ts',
      'apps/backend/src/modules/analyses/analyses.service.tsx',
      'apps/backend/src/modules/analyses/analyses.service.js',
      'apps/backend/src/modules/analyses/analyses.service.jsx',
      'apps/backend/src/modules/analyses/analyses.service/index.ts',
      'apps/backend/src/modules/analyses/analyses.service/index.js',
    ]);
  });

  it('tenta arquivo e index em import sem extensão (types)', () => {
    expect(candidatePathsFor('apps/frontend/src/types')).toEqual([
      'apps/frontend/src/types.ts',
      'apps/frontend/src/types.tsx',
      'apps/frontend/src/types.js',
      'apps/frontend/src/types.jsx',
      'apps/frontend/src/types/index.ts',
      'apps/frontend/src/types/index.js',
    ]);
  });

  it('não altera path que já tem extensão de arquivo', () => {
    expect(candidatePathsFor('apps/ai-api/app/main.py')).toEqual([
      'apps/ai-api/app/main.py',
    ]);
    expect(candidatePathsFor('apps/frontend/src/types/index.ts')).toEqual([
      'apps/frontend/src/types/index.ts',
    ]);
    expect(
      candidatePathsFor('apps/frontend/src/components/ui/EmptyState.tsx'),
    ).toEqual(['apps/frontend/src/components/ui/EmptyState.tsx']);
  });
});

describe('extractRelativeImportPaths', () => {
  it('resolve import relativo Nest sem extensão', () => {
    const paths = extractRelativeImportPaths(
      'apps/backend/src/modules/analyses/analyses.module.ts',
      `import { AnalysesService } from './analyses.service';
       import { RepositoriesModule } from '../repositories/repositories.module';`,
    );

    expect(paths).toEqual([
      'apps/backend/src/modules/analyses/analyses.service',
      'apps/backend/src/modules/repositories/repositories.module',
    ]);
  });
});
