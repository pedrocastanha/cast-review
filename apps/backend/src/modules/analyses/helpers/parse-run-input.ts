import { BadRequestException } from '@nestjs/common';
import type { RunAnalysisDto } from '../dtos/run-analysis.dto';

export function parsePullNumber(raw: string): number {
  const pullNumber = Number(raw);
  if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
    throw new BadRequestException('pullNumber deve ser um inteiro positivo');
  }
  return pullNumber;
}

export function parseRunAnalysisBody(body: unknown): RunAnalysisDto {
  if (!isRecord(body)) {
    throw new BadRequestException('Body da análise inválido');
  }

  const models = body.models;
  const apiKeys = body.apiKeys;

  if (!isRecord(models) || !isNonEmptyString(models.testReviewer) || !isNonEmptyString(models.architectureReviewer)) {
    throw new BadRequestException('models.testReviewer e models.architectureReviewer são obrigatórios');
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
  } as RunAnalysisDto;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
