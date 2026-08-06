jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({})),
}));

import { Test } from '@nestjs/testing';
import { GithubService } from '../github/github.service';
import { ContextBuilderService } from './context-builder.service';

describe('ContextBuilderService', () => {
  let service: ContextBuilderService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ContextBuilderService,
        { provide: GithubService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(ContextBuilderService);
  });

  describe('extractRelativeImports', () => {
    it('captures ES modules and require relatives', () => {
      const source = `
        import { Offer } from './offer.entity';
        import type { X } from "../shared/types";
        const z = require('./utils/helpers');
        import lodash from 'lodash';
      `;
      const imports = service.extractRelativeImports(source);
      expect(imports).toEqual([
        './offer.entity',
        '../shared/types',
        './utils/helpers',
      ]);
    });

    it('returns empty for empty source', () => {
      expect(service.extractRelativeImports('')).toEqual([]);
    });
  });

  describe('expandPathCandidates', () => {
    it('resolves relative import from file directory', () => {
      const candidates = service.expandPathCandidates(
        'src/offers/offers.service.ts',
        './offer.entity',
      );
      expect(candidates[0]).toBe('src/offers/offer.entity.ts');
      expect(candidates).toContain('src/offers/offer.entity/index.ts');
    });

    it('keeps extension when already present', () => {
      const candidates = service.expandPathCandidates('src/a.ts', './b.json');
      expect(candidates).toEqual(['src/b.json']);
    });
  });
});
