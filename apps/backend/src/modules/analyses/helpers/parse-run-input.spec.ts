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

  it('defaults impact scope to repository mode', () => {
    const dto = parseRunAnalysisBody(baseBody());

    expect(dto.impactScope).toEqual({ mode: 'repository' });
  });

  it('accepts a project impact scope with a valid UUID', () => {
    const dto = parseRunAnalysisBody(
      baseBody({
        impactScope: {
          mode: 'project',
          projectId: '2d597fd5-0dfd-448d-85c4-4ee143c4832c',
        },
      }),
    );

    expect(dto.impactScope).toEqual({
      mode: 'project',
      projectId: '2d597fd5-0dfd-448d-85c4-4ee143c4832c',
    });
  });

  it.each([
    { mode: 'repository', projectId: '2d597fd5-0dfd-448d-85c4-4ee143c4832c' },
    { mode: 'project' },
    { mode: 'project', projectId: 'not-a-uuid' },
    { mode: 'everything' },
  ])('rejects invalid impact scope %#', (impactScope) => {
    expect(() => parseRunAnalysisBody(baseBody({ impactScope }))).toThrow(
      BadRequestException,
    );
  });

  it('rejects an invalid policy value', () => {
    expect(() =>
      parseRunAnalysisBody(baseBody({ policies: { prd: 'sometimes' } })),
    ).toThrow(BadRequestException);
  });
});
