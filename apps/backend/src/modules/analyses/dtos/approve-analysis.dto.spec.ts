import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApproveAnalysisDto } from './approve-analysis.dto';

describe('ApproveAnalysisDto', () => {
  it('rejects prd+reject with empty annotations array', async () => {
    const dto = plainToInstance(ApproveAnalysisDto, {
      stage: 'prd',
      decision: 'reject',
      annotations: [],
    });

    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    const annotationsError = errors.find((e) => e.property === 'annotations');
    expect(annotationsError).toBeDefined();
    expect(annotationsError?.constraints).toHaveProperty('annotationsRequiredOnReject');
  });

  it('rejects prd+reject with annotations omitted entirely', async () => {
    const dto = plainToInstance(ApproveAnalysisDto, {
      stage: 'prd',
      decision: 'reject',
    });

    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    const annotationsError = errors.find((e) => e.property === 'annotations');
    expect(annotationsError).toBeDefined();
    expect(annotationsError?.constraints).toHaveProperty('annotationsRequiredOnReject');
  });

  it('accepts prd+reject with at least one annotation and the required models', async () => {
    const dto = plainToInstance(ApproveAnalysisDto, {
      stage: 'prd',
      decision: 'reject',
      annotations: [{ excerpt: 'some code', note: 'please fix' }],
      models: { testReviewer: 'gpt-4', architectureReviewer: 'gpt-4' },
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('accepts publish+approve with no annotations at all', async () => {
    const dto = plainToInstance(ApproveAnalysisDto, {
      stage: 'publish',
      decision: 'approve',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('accepts publish+reject with no annotations (rule only applies to prd/spec)', async () => {
    const dto = plainToInstance(ApproveAnalysisDto, {
      stage: 'publish',
      decision: 'reject',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('requires models when stage is spec', async () => {
    const dto = plainToInstance(ApproveAnalysisDto, {
      stage: 'spec',
      decision: 'approve',
    });

    const errors = await validate(dto);
    const properties = errors.map((e) => e.property);

    expect(properties).toEqual(expect.arrayContaining(['models']));
    expect(properties).not.toContain('apiKeys');
  });

  it('accepts spec+approve when models are provided', async () => {
    const dto = plainToInstance(ApproveAnalysisDto, {
      stage: 'spec',
      decision: 'approve',
      models: { testReviewer: 'gpt-4', architectureReviewer: 'gpt-4' },
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('does not require apiKeys/models when stage is publish', async () => {
    const dto = plainToInstance(ApproveAnalysisDto, {
      stage: 'publish',
      decision: 'approve',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
