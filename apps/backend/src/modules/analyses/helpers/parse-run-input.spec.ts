import { BadRequestException } from '@nestjs/common';
import { parseRunAnalysisBody } from './parse-run-input';

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    models: { testReviewer: 'gpt-4', architectureReviewer: 'gpt-4' },
    apiKeys: { openai: 'sk-test' },
    ...overrides,
  };
}

describe('parseRunAnalysisBody', () => {
  it('carries policies through when the body includes them', () => {
    const dto = parseRunAnalysisBody(
      baseBody({ policies: { prd: 'auto', spec: 'manual' } }),
    );

    expect(dto.policies).toEqual({ prd: 'auto', spec: 'manual' });
  });

  it('leaves policies undefined when the body omits them', () => {
    const dto = parseRunAnalysisBody(baseBody());

    expect(dto.policies).toBeUndefined();
  });

  it('rejects an invalid policy value', () => {
    expect(() =>
      parseRunAnalysisBody(baseBody({ policies: { prd: 'sometimes' } })),
    ).toThrow(BadRequestException);
  });
});
