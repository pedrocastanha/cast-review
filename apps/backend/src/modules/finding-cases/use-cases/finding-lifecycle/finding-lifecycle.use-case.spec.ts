import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { AnalysisReview } from '../../../analyses/analyses.types';
import { Analysis } from '../../../analyses/analysis.entity';
import type { AnalysisRepository } from '../../../analyses/analysis.repository';
import type { FindingCaseRepository } from '../../finding-case.repository';
import type { FindingCaseEventRepository } from '../../finding-case-event.repository';
import type { FindingOccurrenceRepository } from '../../finding-occurrence.repository';
import { FindingLifecycleUseCase } from './finding-lifecycle.use-case';

function review(): AnalysisReview {
  return {
    results: [{ name: 'test_reviewer', score: 85, findings: [] }],
    comments: [
      {
        reviewer: 'test_reviewer',
        status: 'fail',
        title: 'Regra sem teste',
        detail: 'Nenhum teste cobre a regra.',
        businessRule: 'Criar usuário exige e-mail',
        path: 'src/users.ts',
        line: 12,
      },
    ],
  };
}

function finding(
  title: string,
  businessRule: string,
): AnalysisReview['comments'][number] {
  return {
    reviewer: 'test_reviewer',
    status: 'fail',
    title,
    detail: `Detalhe de ${title}`,
    businessRule,
    path: 'src/users.ts',
    line: 12,
  };
}

function analysis(): Analysis {
  return Object.assign(new Analysis({}), {
    id: 'analysis-current',
    requestedBy: 'user-1',
    owner: 'Acme',
    repo: 'Api',
    pullNumber: 42,
    status: 'running',
    report: null,
    thoughts: null,
    errorMessage: null,
    models: {
      testReviewer: 'gpt-5.4-mini',
      architectureReviewer: 'gpt-5.4-mini',
    },
    impactScope: null,
    finishedAt: null,
    approvalStage: null,
    publishPolicy: null,
    prdIterations: [],
    specIterations: [],
    resumedCount: 0,
    createdAt: new Date('2026-09-01T12:00:00.000Z'),
  });
}

function harness() {
  const cases: Array<Record<string, unknown>> = [];
  const occurrences: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  let id = 0;
  const create = (prefix: string) => (input: Record<string, unknown>) => ({
    id: `${prefix}-${++id}`,
    ...input,
  });
  const managerQuery = jest.fn(async () => []);
  const transaction = jest.fn(async (work: (manager: object) => unknown) =>
    work({ query: managerQuery }),
  );
  const caseRepository = {
    datasource: { transaction },
    find: jest.fn(async () => cases),
    findOne: jest.fn(
      async (options?: { where?: { id?: string } }) =>
        cases.find((item) => item.id === options?.where?.id) ?? null,
    ),
    create: jest.fn(create('case')),
    save: jest.fn(async (item) => {
      cases.push(item);
      return item;
    }),
    update: jest.fn(
      async (caseId: string, changes: Record<string, unknown>) => {
        const current = cases.find((item) => item.id === caseId);
        if (current) Object.assign(current, changes);
        return { affected: current ? 1 : 0 };
      },
    ),
  };
  const occurrenceRepository = {
    find: jest.fn(async (options?: { where?: { analysisId?: string } }) =>
      options?.where?.analysisId
        ? occurrences.filter(
            (item) => item.analysisId === options.where?.analysisId,
          )
        : occurrences,
    ),
    create: jest.fn(create('occurrence')),
    save: jest.fn(async (item) => {
      occurrences.push(item);
      return item;
    }),
  };
  const eventRepository = {
    find: jest.fn(async (options?: { where?: { analysisId?: string } }) =>
      options?.where?.analysisId
        ? events.filter((item) => item.analysisId === options.where?.analysisId)
        : events,
    ),
    create: jest.fn(create('event')),
    save: jest.fn(async (item) => {
      events.push(item);
      return item;
    }),
  };
  const queryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn(async () => null),
  };
  const analysisRepository = {
    createQueryBuilder: jest.fn(() => queryBuilder),
    findOne: jest.fn(async () => null),
  };
  const service = new FindingLifecycleUseCase(
    caseRepository as unknown as FindingCaseRepository,
    occurrenceRepository as unknown as FindingOccurrenceRepository,
    eventRepository as unknown as FindingCaseEventRepository,
    analysisRepository as unknown as AnalysisRepository,
  );
  return {
    service,
    cases,
    occurrences,
    events,
    transaction,
    managerQuery,
    queryBuilder,
    caseRepository,
    occurrenceRepository,
    eventRepository,
    analysisRepository,
  };
}

describe('FindingLifecycleUseCase', () => {
  it('persiste um finding novo e devolve metadata por comentário', async () => {
    const { service, cases, occurrences, events, transaction, managerQuery } =
      harness();

    const result = await service.reconcile({
      analysis: analysis(),
      review: review(),
      owner: 'Acme',
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(managerQuery).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      ['user-1|acme|api|42'],
    );
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      requestedBy: 'user-1',
      owner: 'acme',
      repo: 'api',
      pullNumber: 42,
      state: 'active',
      disposition: 'unreviewed',
      firstSeenAnalysisId: 'analysis-current',
      lastSeenAnalysisId: 'analysis-current',
    });
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({
      analysisId: 'analysis-current',
      classification: 'new',
      severity: 'fail',
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      analysisId: 'analysis-current',
      type: 'first_seen',
    });
    expect(result.summary).toMatchObject({
      status: 'available',
      baselineAnalysisId: null,
      newCount: 1,
      recurringCount: 0,
      reopenedCount: 0,
      notObservedCount: 0,
      acknowledgedCount: 0,
    });
    expect(result.metadataByCommentIndex.get(0)).toMatchObject({
      classification: 'new',
      disposition: 'unreviewed',
      firstSeenAnalysisId: 'analysis-current',
      previousOccurrenceAnalysisId: null,
    });
  });

  it('reconcilia recorrente, novo e não observado na análise seguinte', async () => {
    const { service, cases, occurrences, events } = harness();
    const firstReview: AnalysisReview = {
      results: [{ name: 'test_reviewer', score: 70, findings: [] }],
      comments: [
        finding('Finding X', 'Regra X'),
        finding('Finding Y', 'Regra Y'),
      ],
    };
    await service.reconcile({
      analysis: analysis(),
      review: firstReview,
      owner: 'Acme',
    });
    const nextAnalysis = analysis();
    nextAnalysis.id = 'analysis-next';
    nextAnalysis.createdAt = new Date('2026-09-01T13:00:00.000Z');
    const nextReview: AnalysisReview = {
      results: [{ name: 'test_reviewer', score: 70, findings: [] }],
      comments: [
        finding('Finding X reformulado', 'Regra X'),
        finding('Finding Z', 'Regra Z'),
      ],
    };

    const result = await service.reconcile({
      analysis: nextAnalysis,
      review: nextReview,
      owner: 'ACME',
    });

    expect(result.summary).toMatchObject({
      newCount: 1,
      recurringCount: 1,
      reopenedCount: 0,
      notObservedCount: 1,
    });
    expect(result.metadataByCommentIndex.get(0)).toMatchObject({
      classification: 'recurring',
      firstSeenAnalysisId: 'analysis-current',
      previousOccurrenceAnalysisId: 'analysis-current',
    });
    expect(result.metadataByCommentIndex.get(1)).toMatchObject({
      classification: 'new',
    });
    expect(cases).toHaveLength(3);
    expect(
      cases.find(
        (item) =>
          item.fingerprintMaterial ===
          'v1|test_reviewer|src/users.ts|stable:regra y',
      ),
    ).toMatchObject({
      state: 'resolved',
      resolvedInAnalysisId: 'analysis-next',
    });
    expect(occurrences.map((item) => item.classification)).toEqual([
      'new',
      'new',
      'recurring',
      'new',
    ]);
    expect(events.slice(-3).map((item) => item.type)).toEqual([
      'seen_again',
      'first_seen',
      'not_observed',
    ]);
  });

  it('reabre case sem apagar false positive', async () => {
    const { service, cases } = harness();
    await service.reconcile({
      analysis: analysis(),
      review: review(),
      owner: 'Acme',
    });
    Object.assign(cases[0], {
      disposition: 'false_positive',
      dispositionNote: 'Cobertura indireta aceita.',
    });
    const middle = analysis();
    middle.id = 'analysis-middle';
    middle.createdAt = new Date('2026-09-01T13:00:00.000Z');
    await service.reconcile({
      analysis: middle,
      review: {
        results: [{ name: 'test_reviewer', score: 100, findings: [] }],
        comments: [],
      },
      owner: 'Acme',
    });
    const latest = analysis();
    latest.id = 'analysis-latest';
    latest.createdAt = new Date('2026-09-01T14:00:00.000Z');

    const result = await service.reconcile({
      analysis: latest,
      review: review(),
      owner: 'Acme',
    });

    expect(result.summary).toMatchObject({
      reopenedCount: 1,
      acknowledgedCount: 1,
      suppressedFromGithubCount: 1,
    });
    expect(result.metadataByCommentIndex.get(0)).toMatchObject({
      classification: 'reopened',
      disposition: 'false_positive',
      firstSeenAnalysisId: 'analysis-current',
      previousOccurrenceAnalysisId: 'analysis-current',
    });
    expect(cases[0]).toMatchObject({
      state: 'active',
      disposition: 'false_positive',
      dispositionNote: 'Cobertura indireta aceita.',
      resolvedInAnalysisId: null,
      reopenedCount: 1,
      lastSeenAnalysisId: 'analysis-latest',
    });
  });

  it('semeia a análise anterior como baseline antes de reconciliar', async () => {
    const { service, cases, occurrences, queryBuilder } = harness();
    const previous = analysis();
    previous.id = 'analysis-previous';
    previous.status = 'completed';
    previous.createdAt = new Date('2026-09-01T11:00:00.000Z');
    previous.report = review();
    queryBuilder.getOne.mockResolvedValue(previous);

    const result = await service.reconcile({
      analysis: analysis(),
      review: review(),
      owner: 'Acme',
    });

    expect(result.summary).toMatchObject({
      baselineAnalysisId: 'analysis-previous',
      newCount: 0,
      recurringCount: 1,
    });
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      firstSeenAnalysisId: 'analysis-previous',
      lastSeenAnalysisId: 'analysis-current',
    });
    expect(occurrences.map((item) => item.analysisId)).toEqual([
      'analysis-previous',
      'analysis-current',
    ]);
  });

  it('é idempotente ao reconciliar novamente a mesma análise', async () => {
    const { service, cases, occurrences, events } = harness();
    const current = analysis();
    const first = await service.reconcile({
      analysis: current,
      review: review(),
      owner: 'Acme',
    });

    const repeated = await service.reconcile({
      analysis: current,
      review: review(),
      owner: 'Acme',
    });

    expect(repeated.summary).toEqual(first.summary);
    expect(repeated.metadataByCommentIndex.get(0)).toEqual(
      first.metadataByCommentIndex.get(0),
    );
    expect(cases).toHaveLength(1);
    expect(occurrences).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it('carrega somente as disposições atuais dos cases pedidos pelo usuário', async () => {
    const { service, cases, caseRepository } = harness();
    cases.push(
      { id: 'case-1', disposition: 'accepted_risk' },
      { id: 'case-2', disposition: 'unreviewed' },
    );

    const result = await service.currentDispositions(
      ['case-1', 'case-2'],
      'user-1',
    );

    expect(caseRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ requestedBy: 'user-1' }),
      }),
    );
    expect(result).toEqual(
      new Map([
        ['case-1', 'accepted_risk'],
        ['case-2', 'unreviewed'],
      ]),
    );
  });

  describe('API de lifecycle', () => {
    it('retorna 404 quando a análise não pertence ao usuário', async () => {
      const { service } = harness();

      await expect(
        service.listForAnalysis('analysis-current', 'other-user', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('retorna 409 quando o lifecycle da análise está indisponível', async () => {
      const { service, analysisRepository } = harness();
      const current = analysis();
      current.report = {
        results: [],
        comments: [],
        findingLifecycle: {
          status: 'unavailable',
          baselineAnalysisId: null,
          modelChanged: false,
          newCount: 0,
          recurringCount: 0,
          reopenedCount: 0,
          notObservedCount: 0,
          acknowledgedCount: 0,
          suppressedFromGithubCount: 0,
          errorCode: 'reconciliation_failed',
        },
      };
      analysisRepository.findOne.mockResolvedValue(current);

      await expect(
        service.listForAnalysis(current.id, current.requestedBy, {}),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('valida view, limit e cursor fechado', async () => {
      const { service, analysisRepository } = harness();
      const current = analysis();
      current.report = {
        results: [],
        comments: [],
        findingLifecycle: {
          status: 'available',
          baselineAnalysisId: null,
          modelChanged: false,
          newCount: 0,
          recurringCount: 0,
          reopenedCount: 0,
          notObservedCount: 0,
          acknowledgedCount: 0,
          suppressedFromGithubCount: 0,
        },
      };
      analysisRepository.findOne.mockResolvedValue(current);

      await expect(
        service.listForAnalysis(current.id, current.requestedBy, {
          view: 'invalid',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.listForAnalysis(current.id, current.requestedBy, {
          limit: '101',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.listForAnalysis(current.id, current.requestedBy, {
          cursor: 'not-a-cursor',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lista ocorrências com filtro e cursor estável', async () => {
      const { service, cases, occurrences, analysisRepository } = harness();
      const current = analysis();
      const summary = {
        status: 'available' as const,
        baselineAnalysisId: null,
        modelChanged: false,
        newCount: 2,
        recurringCount: 0,
        reopenedCount: 0,
        notObservedCount: 0,
        acknowledgedCount: 0,
        suppressedFromGithubCount: 0,
      };
      current.report = { results: [], comments: [], findingLifecycle: summary };
      analysisRepository.findOne.mockResolvedValue(current);
      cases.push(
        {
          id: 'case-b',
          requestedBy: 'user-1',
          state: 'active',
          disposition: 'unreviewed',
          dispositionNote: null,
          matchBasis: 'stable_anchor',
          firstSeenAnalysisId: current.id,
        },
        {
          id: 'case-a',
          requestedBy: 'user-1',
          state: 'active',
          disposition: 'unreviewed',
          dispositionNote: null,
          matchBasis: 'title_fallback',
          firstSeenAnalysisId: current.id,
        },
      );
      occurrences.push(
        {
          id: 'occ-b',
          caseId: 'case-b',
          analysisId: current.id,
          classification: 'new',
          severity: 'fail',
          reviewer: 'test_reviewer',
          title: 'B',
          detail: 'B',
          createdAt: new Date('2026-09-01T14:00:00.000Z'),
        },
        {
          id: 'occ-a',
          caseId: 'case-a',
          analysisId: current.id,
          classification: 'new',
          severity: 'warning',
          reviewer: 'test_reviewer',
          title: 'A',
          detail: 'A',
          createdAt: new Date('2026-09-01T13:00:00.000Z'),
        },
      );

      const first = await service.listForAnalysis(
        current.id,
        current.requestedBy,
        { limit: '1' },
      );
      const second = await service.listForAnalysis(
        current.id,
        current.requestedBy,
        { limit: '1', cursor: first.nextCursor ?? undefined },
      );

      expect(first.data.map((item) => item.caseId)).toEqual(['case-b']);
      expect(first.hasMore).toBe(true);
      expect(first.summary).toEqual(summary);
      expect(second.data.map((item) => item.caseId)).toEqual(['case-a']);
      expect(second.hasMore).toBe(false);
    });
  });
});
