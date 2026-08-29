import { BadRequestException } from '@nestjs/common';
import type { RunAnalysisDto } from '../dtos/run-analysis.dto';

export function parsePullNumber(raw: string): number {
  const pullNumber = Number(raw);
  if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
    throw new BadRequestException('pullNumber deve ser um inteiro positivo');
  }
  return pullNumber;
}

export function parseOptionalPullNumber(
  raw: string | undefined,
): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  return parsePullNumber(raw);
}

export function parseRunAnalysisBody(body: unknown): RunAnalysisDto {
  if (!isRecord(body)) {
    throw new BadRequestException('Body da análise inválido');
  }

  const models = body.models;

  if (
    !isRecord(models) ||
    !isNonEmptyString(models.testReviewer) ||
    !isNonEmptyString(models.architectureReviewer)
  ) {
    throw new BadRequestException(
      'models.testReviewer e models.architectureReviewer são obrigatórios',
    );
  }

  return {
    models: {
      testReviewer: models.testReviewer,
      architectureReviewer: models.architectureReviewer,
    },
    policies: parsePolicies(body.policies),
    impactScope: parseImpactScope(body.impactScope),
  } as RunAnalysisDto;
}

function parseImpactScope(raw: unknown): RunAnalysisDto['impactScope'] {
  if (raw === undefined) return { mode: 'repository' };
  if (!isRecord(raw)) {
    throw new BadRequestException('impactScope deve ser um objeto');
  }

  if (raw.mode === 'repository') {
    if (raw.projectId !== undefined) {
      throw new BadRequestException(
        'impactScope.projectId não é permitido no modo repository',
      );
    }
    return { mode: 'repository' };
  }

  if (raw.mode === 'project') {
    if (!isNonEmptyString(raw.projectId) || !isUuid(raw.projectId)) {
      throw new BadRequestException(
        'impactScope.projectId deve ser um UUID válido no modo project',
      );
    }
    return { mode: 'project', projectId: raw.projectId };
  }

  throw new BadRequestException(
    'impactScope.mode deve ser "repository" ou "project"',
  );
}

function parsePolicies(raw: unknown): RunAnalysisDto['policies'] | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    throw new BadRequestException('policies deve ser um objeto');
  }

  const prd = raw.prd;
  const spec = raw.spec;
  const publish = raw.publish;
  if (prd !== undefined && prd !== 'manual' && prd !== 'auto') {
    throw new BadRequestException('policies.prd deve ser "manual" ou "auto"');
  }
  if (spec !== undefined && spec !== 'manual' && spec !== 'auto') {
    throw new BadRequestException('policies.spec deve ser "manual" ou "auto"');
  }
  if (
    publish !== undefined &&
    publish !== 'manual' &&
    publish !== 'auto_safe' &&
    publish !== 'auto'
  ) {
    throw new BadRequestException(
      'policies.publish deve ser "manual", "auto_safe" ou "auto"',
    );
  }

  return {
    prd: prd as 'manual' | 'auto' | undefined,
    spec: spec as 'manual' | 'auto' | undefined,
    publish: publish as 'manual' | 'auto_safe' | 'auto' | undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
