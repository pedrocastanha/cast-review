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
  const apiKeys = body.apiKeys;

  if (
    !isRecord(models) ||
    !isNonEmptyString(models.testReviewer) ||
    !isNonEmptyString(models.architectureReviewer)
  ) {
    throw new BadRequestException(
      'models.testReviewer e models.architectureReviewer são obrigatórios',
    );
  }

  if (!isRecord(apiKeys) || !isNonEmptyString(apiKeys.openai)) {
    throw new BadRequestException('apiKeys.openai é obrigatório');
  }

  return {
    models: {
      testReviewer: models.testReviewer,
      architectureReviewer: models.architectureReviewer,
    },
    apiKeys: { openai: apiKeys.openai },
    policies: parsePolicies(body.policies),
  } as RunAnalysisDto;
}

function parsePolicies(
  raw: unknown,
): RunAnalysisDto['policies'] | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    throw new BadRequestException('policies deve ser um objeto');
  }

  const prd = raw.prd;
  const spec = raw.spec;
  if (prd !== undefined && prd !== 'manual' && prd !== 'auto') {
    throw new BadRequestException('policies.prd deve ser "manual" ou "auto"');
  }
  if (spec !== undefined && spec !== 'manual' && spec !== 'auto') {
    throw new BadRequestException(
      'policies.spec deve ser "manual" ou "auto"',
    );
  }

  return {
    prd: prd as 'manual' | 'auto' | undefined,
    spec: spec as 'manual' | 'auto' | undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
