import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { type EntityManager, In } from 'typeorm';
import type {
  AnalysisReview,
  FindingLifecycleMeta,
  FindingLifecycleSummary,
} from '../../../analyses/analyses.types';
import type { Analysis } from '../../../analyses/analysis.entity';
import type { AnalysisRepository } from '../../../analyses/analysis.repository';
import { fingerprintFindings } from '../../../analyses/helpers/finding-fingerprint.helper';
import { planFindingLifecycle } from '../../../analyses/helpers/finding-lifecycle.helper';
import type { FindingCase } from '../../finding-case.entity';
import type { FindingCaseRepository } from '../../finding-case.repository';
import type { FindingCaseEventRepository } from '../../finding-case-event.repository';
import type {
  FindingCaseEventType,
  FindingClassification,
  FindingDisposition,
} from '../../finding-cases.types';
import type { FindingOccurrence } from '../../finding-occurrence.entity';
import type { FindingOccurrenceRepository } from '../../finding-occurrence.repository';

export interface FindingLifecycleResult {
  summary: FindingLifecycleSummary;
  metadataByCommentIndex: Map<number, FindingLifecycleMeta>;
}

type LifecycleView = 'attention' | 'acknowledged' | 'not_observed' | 'all';

interface LifecycleCursor {
  version: 1;
  view: LifecycleView;
  rank: number;
  transitionedAt: string;
  caseId: string;
}

export interface LifecycleListItem {
  caseId: string;
  classification: FindingClassification | 'not_observed';
  state: 'active' | 'resolved';
  disposition: FindingDisposition;
  dispositionNote: string | null;
  matchBasis: 'stable_anchor' | 'title_fallback';
  firstSeenAnalysisId: string | null;
  previousOccurrenceAnalysisId: string | null;
  currentOccurrence: Record<string, unknown> | null;
  lastOccurrence?: Record<string, unknown> | null;
  transitionedAt: string;
}

export class FindingLifecycleUseCase {
  constructor(
    private readonly caseRepository: FindingCaseRepository,
    private readonly occurrenceRepository: FindingOccurrenceRepository,
    private readonly eventRepository: FindingCaseEventRepository,
    private readonly analysisRepository: AnalysisRepository,
  ) {}

  async currentDispositions(
    caseIds: string[],
    requestedBy: string,
  ): Promise<Map<string, FindingDisposition>> {
    const uniqueCaseIds = [...new Set(caseIds.filter(Boolean))];
    if (uniqueCaseIds.length === 0) return new Map();

    const cases = await this.caseRepository.find({
      where: { id: In(uniqueCaseIds), requestedBy },
    });
    return new Map(cases.map((item) => [item.id, item.disposition]));
  }

  async listForAnalysis(
    analysisId: string,
    requestedBy: string,
    query: { view?: string; limit?: string; cursor?: string },
  ): Promise<{
    data: LifecycleListItem[];
    summary: FindingLifecycleSummary;
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const view = this.parseView(query.view);
    const limit = this.parseLimit(query.limit);
    const cursor = query.cursor ? this.decodeCursor(query.cursor, view) : null;
    const analysis = await this.analysisRepository.findOne({
      where: { id: analysisId, requestedBy },
    });
    if (!analysis) throw new NotFoundException('Análise não encontrada');
    const summary = analysis.report?.findingLifecycle;
    if (summary?.status !== 'available') {
      throw new ConflictException('Lifecycle indisponível para esta análise');
    }

    const [currentOccurrences, transitionEvents] = await Promise.all([
      this.occurrenceRepository.find({ where: { analysisId } }),
      this.eventRepository.find({ where: { analysisId } }),
    ]);
    const notObservedEvents = transitionEvents.filter(
      (event) => event.type === 'not_observed',
    );
    const caseIds = [
      ...new Set([
        ...currentOccurrences.map((item) => item.caseId),
        ...notObservedEvents.map((item) => item.caseId),
      ]),
    ];
    if (caseIds.length === 0) {
      return { data: [], summary, nextCursor: null, hasMore: false };
    }
    const cases = await this.caseRepository.find({
      where: { id: In(caseIds), requestedBy },
    });
    const caseById = new Map(cases.map((item) => [item.id, item]));
    const lastOccurrences =
      notObservedEvents.length > 0
        ? await this.occurrenceRepository.find({
            where: {
              caseId: In(notObservedEvents.map((item) => item.caseId)),
            },
            order: { createdAt: 'DESC', id: 'DESC' },
          })
        : [];
    const lastOccurrenceByCase = new Map();
    for (const occurrence of lastOccurrences) {
      if (!lastOccurrenceByCase.has(occurrence.caseId)) {
        lastOccurrenceByCase.set(occurrence.caseId, occurrence);
      }
    }

    const observedItems = currentOccurrences.flatMap((occurrence) => {
      const findingCase = caseById.get(occurrence.caseId);
      if (!findingCase) return [];
      const transition = transitionEvents.find(
        (event) =>
          event.caseId === occurrence.caseId && event.type !== 'not_observed',
      );
      return [
        this.toListItem(
          findingCase,
          occurrence.classification,
          occurrence,
          occurrence.createdAt,
          null,
          typeof transition?.payload.previousOccurrenceAnalysisId === 'string'
            ? transition.payload.previousOccurrenceAnalysisId
            : null,
        ),
      ];
    });
    const notObservedItems = notObservedEvents.flatMap((event) => {
      const findingCase = caseById.get(event.caseId);
      if (!findingCase) return [];
      const lastOccurrence = lastOccurrenceByCase.get(event.caseId) ?? null;
      return [
        this.toListItem(
          findingCase,
          'not_observed',
          null,
          event.createdAt,
          lastOccurrence,
          typeof event.payload.previousOccurrenceAnalysisId === 'string'
            ? event.payload.previousOccurrenceAnalysisId
            : null,
        ),
      ];
    });
    const filtered = [...observedItems, ...notObservedItems]
      .filter((item) => this.matchesView(item, view))
      .sort(compareLifecycleItems);
    const afterCursor = cursor
      ? filtered.filter((item) => compareItemToCursor(item, cursor) > 0)
      : filtered;
    const page = afterCursor.slice(0, limit);
    const hasMore = afterCursor.length > limit;
    const last = page.at(-1);
    return {
      data: page,
      summary,
      hasMore,
      nextCursor:
        hasMore && last
          ? this.encodeCursor({
              version: 1,
              view,
              rank: lifecycleSortRank(last),
              transitionedAt: last.transitionedAt,
              caseId: last.caseId,
            })
          : null,
    };
  }

  private parseView(value?: string): LifecycleView {
    const view = value ?? 'attention';
    if (
      view !== 'attention' &&
      view !== 'acknowledged' &&
      view !== 'not_observed' &&
      view !== 'all'
    ) {
      throw new BadRequestException('view inválida');
    }
    return view;
  }

  private parseLimit(value?: string): number {
    if (value === undefined) return 50;
    if (!/^\d+$/.test(value)) throw new BadRequestException('limit inválido');
    const limit = Number(value);
    if (limit < 1 || limit > 100) {
      throw new BadRequestException('limit deve estar entre 1 e 100');
    }
    return limit;
  }

  private matchesView(item: LifecycleListItem, view: LifecycleView): boolean {
    if (view === 'all') return true;
    if (view === 'not_observed') return item.classification === 'not_observed';
    if (item.classification === 'not_observed') return false;
    const acknowledged = item.disposition !== 'unreviewed';
    return view === 'acknowledged' ? acknowledged : !acknowledged;
  }

  private toListItem(
    findingCase: FindingCase,
    classification: FindingClassification | 'not_observed',
    currentOccurrence: FindingOccurrence | null,
    transitionedAt: Date,
    lastOccurrence: FindingOccurrence | null,
    previousOccurrenceAnalysisId?: string | null,
  ): LifecycleListItem {
    const occurrence = currentOccurrence
      ? occurrencePayload(currentOccurrence)
      : null;
    return {
      caseId: findingCase.id,
      classification,
      state: findingCase.state,
      disposition: findingCase.disposition,
      dispositionNote: findingCase.dispositionNote,
      matchBasis: findingCase.matchBasis,
      firstSeenAnalysisId: findingCase.firstSeenAnalysisId,
      previousOccurrenceAnalysisId: previousOccurrenceAnalysisId ?? null,
      currentOccurrence: occurrence,
      ...(classification === 'not_observed'
        ? {
            lastOccurrence: lastOccurrence
              ? occurrencePayload(lastOccurrence)
              : null,
          }
        : {}),
      transitionedAt: transitionedAt.toISOString(),
    };
  }

  private encodeCursor(cursor: LifecycleCursor): string {
    const payload = Buffer.from(JSON.stringify(cursor)).toString('base64url');
    return `${payload}.${this.signCursor(payload)}`;
  }

  private decodeCursor(value: string, view: LifecycleView): LifecycleCursor {
    try {
      const [payload, signature] = value.split('.');
      if (!payload || !signature || !this.matchesCursor(payload, signature)) {
        throw new Error('signature');
      }
      const cursor = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as LifecycleCursor;
      if (
        cursor.version !== 1 ||
        cursor.view !== view ||
        !Number.isInteger(cursor.rank) ||
        !cursor.caseId ||
        !Number.isFinite(Date.parse(cursor.transitionedAt))
      ) {
        throw new Error('claims');
      }
      return cursor;
    } catch {
      throw new BadRequestException('cursor inválido');
    }
  }

  private matchesCursor(payload: string, signature: string): boolean {
    const expected = Buffer.from(this.signCursor(payload));
    const received = Buffer.from(signature);
    return (
      expected.length === received.length && timingSafeEqual(expected, received)
    );
  }

  private signCursor(payload: string): string {
    const secret = process.env.SECRET_ENCRYPTION_KEY?.trim();
    if (!secret && process.env.NODE_ENV !== 'test') {
      throw new Error('SECRET_ENCRYPTION_KEY não configurada');
    }
    return createHmac('sha256', secret || 'finding-lifecycle-test-secret')
      .update(payload)
      .digest('base64url');
  }

  async reconcile(input: {
    analysis: Analysis;
    review: AnalysisReview;
    owner: string;
  }): Promise<FindingLifecycleResult> {
    const owner = input.owner.trim().toLowerCase();
    const repo = input.analysis.repo.trim().toLowerCase();
    if (!owner || !repo) {
      throw new Error('Escopo canônico da análise é obrigatório');
    }

    return this.caseRepository.datasource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [
          `${input.analysis.requestedBy}|${owner}|${repo}|${input.analysis.pullNumber}`,
        ],
      );
      let existingCases = await this.caseRepository.find(
        {
          where: {
            requestedBy: input.analysis.requestedBy,
            owner,
            repo,
            pullNumber: input.analysis.pullNumber,
          },
        },
        manager,
      );
      const previous = await this.findPreviousAnalysis(
        input.analysis,
        owner,
        manager,
      );
      if (existingCases.length === 0 && previous?.report) {
        existingCases = await this.seedBaseline({
          analysis: previous,
          review: previous.report,
          owner,
          repo,
          manager,
        });
      }
      const entries = input.review.comments
        .map((finding, commentIndex) => ({ finding, commentIndex }))
        .filter(
          ({ finding }) =>
            finding.status === 'fail' || finding.status === 'warning',
        );
      const fingerprints = fingerprintFindings(
        entries.map((entry) => entry.finding),
      );
      const [persistedOccurrences, persistedEvents] = await Promise.all([
        this.occurrenceRepository.find(
          { where: { analysisId: input.analysis.id } },
          manager,
        ),
        this.eventRepository.find(
          { where: { analysisId: input.analysis.id } },
          manager,
        ),
      ]);
      if (persistedOccurrences.length > 0 || persistedEvents.length > 0) {
        const metadataByCommentIndex = new Map<number, FindingLifecycleMeta>();
        const caseByFingerprint = new Map(
          existingCases.map((item) => [item.fingerprint, item]),
        );
        const occurrenceByCaseId = new Map(
          persistedOccurrences.map((item) => [item.caseId, item]),
        );
        const eventByCaseId = new Map(
          persistedEvents.map((item) => [item.caseId, item]),
        );

        for (const fingerprint of fingerprints) {
          const findingCase = caseByFingerprint.get(fingerprint.fingerprint);
          const occurrence = findingCase
            ? occurrenceByCaseId.get(findingCase.id)
            : undefined;
          if (!findingCase || !occurrence) continue;
          const event = eventByCaseId.get(findingCase.id);
          const previousOccurrenceAnalysisId =
            typeof event?.payload.previousOccurrenceAnalysisId === 'string'
              ? event.payload.previousOccurrenceAnalysisId
              : null;
          for (const sourceIndex of fingerprint.sourceIndexes) {
            const commentIndex = entries[sourceIndex]?.commentIndex;
            if (commentIndex === undefined) continue;
            metadataByCommentIndex.set(commentIndex, {
              caseId: findingCase.id,
              classification: occurrence.classification,
              state: 'active',
              disposition: findingCase.disposition,
              matchBasis: findingCase.matchBasis,
              firstSeenAnalysisId:
                findingCase.firstSeenAnalysisId ?? input.analysis.id,
              previousOccurrenceAnalysisId,
            });
          }
        }

        const count = (classification: FindingClassification) =>
          persistedOccurrences.filter(
            (item) => item.classification === classification,
          ).length;
        const acknowledgedCount = persistedOccurrences.filter((occurrence) => {
          const findingCase = existingCases.find(
            (item) => item.id === occurrence.caseId,
          );
          return findingCase?.disposition !== 'unreviewed';
        }).length;
        return {
          summary: {
            status: 'available',
            baselineAnalysisId: previous?.id ?? null,
            modelChanged: Boolean(
              previous?.models &&
                JSON.stringify(previous.models) !==
                  JSON.stringify(input.analysis.models),
            ),
            newCount: count('new'),
            recurringCount: count('recurring'),
            reopenedCount: count('reopened'),
            notObservedCount: persistedEvents.filter(
              (event) => event.type === 'not_observed',
            ).length,
            acknowledgedCount,
            suppressedFromGithubCount: acknowledgedCount,
          },
          metadataByCommentIndex,
        };
      }
      const completedReviewers = new Set(
        input.review.results.map((result) => result.name.trim().toLowerCase()),
      );
      const plan = planFindingLifecycle({
        current: fingerprints,
        existingCases,
        completedReviewers,
      });
      const metadataByCommentIndex = new Map<number, FindingLifecycleMeta>();

      for (const observed of plan.observed) {
        const previousOccurrenceAnalysisId =
          observed.case?.lastSeenAnalysisId ?? null;
        let findingCase: FindingCase;
        let eventType: FindingCaseEventType;
        if (observed.case) {
          findingCase = observed.case as FindingCase;
          await this.caseRepository.update(
            findingCase.id,
            {
              state: 'active',
              lastSeenAnalysisId: input.analysis.id,
              resolvedInAnalysisId: null,
              reopenedCount: observed.nextReopenedCount,
            },
            manager,
          );
          Object.assign(findingCase, {
            state: 'active',
            lastSeenAnalysisId: input.analysis.id,
            resolvedInAnalysisId: null,
            reopenedCount: observed.nextReopenedCount,
          });
          eventType =
            observed.classification === 'reopened' ? 'reopened' : 'seen_again';
        } else {
          findingCase = await this.caseRepository.save(
            this.caseRepository.create(
              {
                id: randomUUID(),
                requestedBy: input.analysis.requestedBy,
                owner,
                repo,
                pullNumber: input.analysis.pullNumber,
                reviewer: observed.finding.finding.reviewer
                  .trim()
                  .toLowerCase(),
                fingerprintVersion: observed.finding.fingerprintVersion,
                fingerprint: observed.finding.fingerprint,
                fingerprintMaterial: observed.finding.fingerprintMaterial,
                matchBasis: observed.finding.matchBasis,
                state: 'active',
                disposition: 'unreviewed',
                dispositionNote: null,
                firstSeenAnalysisId: input.analysis.id,
                lastSeenAnalysisId: input.analysis.id,
                resolvedInAnalysisId: null,
                reopenedCount: 0,
              },
              manager,
            ),
            undefined,
            manager,
          );
          eventType = 'first_seen';
        }
        await this.saveOccurrenceAndEvent({
          findingCase,
          analysisId: input.analysis.id,
          classification: observed.classification,
          eventType,
          previousOccurrenceAnalysisId,
          observed,
          manager,
        });
        for (const sourceIndex of observed.finding.sourceIndexes) {
          const commentIndex = entries[sourceIndex]?.commentIndex;
          if (commentIndex === undefined) continue;
          metadataByCommentIndex.set(commentIndex, {
            caseId: findingCase.id,
            classification: observed.classification,
            state: 'active',
            disposition: observed.nextDisposition,
            matchBasis: observed.finding.matchBasis,
            firstSeenAnalysisId:
              findingCase.firstSeenAnalysisId ?? input.analysis.id,
            previousOccurrenceAnalysisId,
          });
        }
      }

      for (const notObserved of plan.notObserved) {
        await this.caseRepository.update(
          notObserved.id,
          {
            state: 'resolved',
            resolvedInAnalysisId: input.analysis.id,
          },
          manager,
        );
        Object.assign(notObserved, {
          state: 'resolved',
          resolvedInAnalysisId: input.analysis.id,
        });
        await this.eventRepository.save(
          this.eventRepository.create(
            {
              id: randomUUID(),
              caseId: notObserved.id,
              analysisId: input.analysis.id,
              actorId: null,
              type: 'not_observed',
              payload: { fromState: 'active', toState: 'resolved' },
            },
            manager,
          ),
          undefined,
          manager,
        );
      }

      const count = (classification: FindingClassification) =>
        plan.observed.filter((item) => item.classification === classification)
          .length;
      const acknowledgedCount = plan.observed.filter(
        (item) => item.nextDisposition !== 'unreviewed',
      ).length;

      return {
        summary: {
          status: 'available',
          baselineAnalysisId: previous?.id ?? null,
          modelChanged: Boolean(
            previous?.models &&
              JSON.stringify(previous.models) !==
                JSON.stringify(input.analysis.models),
          ),
          newCount: count('new'),
          recurringCount: count('recurring'),
          reopenedCount: count('reopened'),
          notObservedCount: plan.notObserved.length,
          acknowledgedCount,
          suppressedFromGithubCount: acknowledgedCount,
        },
        metadataByCommentIndex,
      };
    });
  }

  private async findPreviousAnalysis(
    analysis: Analysis,
    owner: string,
    manager: EntityManager,
  ): Promise<Analysis | null> {
    return this.analysisRepository
      .createQueryBuilder('analysis', manager)
      .where('analysis.requestedBy = :requestedBy', {
        requestedBy: analysis.requestedBy,
      })
      .andWhere('LOWER(analysis.repo) = :repo', {
        repo: analysis.repo.trim().toLowerCase(),
      })
      .andWhere(
        '(LOWER(analysis.owner) = :owner OR analysis.owner = :emptyOwner)',
        { owner, emptyOwner: '' },
      )
      .andWhere('analysis.pullNumber = :pullNumber', {
        pullNumber: analysis.pullNumber,
      })
      .andWhere('analysis.status = :status', { status: 'completed' })
      .andWhere('analysis.id <> :analysisId', { analysisId: analysis.id })
      .andWhere('analysis.createdAt < :createdAt', {
        createdAt: analysis.createdAt,
      })
      .orderBy('analysis.createdAt', 'DESC')
      .getOne();
  }

  private async seedBaseline(input: {
    analysis: Analysis;
    review: AnalysisReview;
    owner: string;
    repo: string;
    manager: EntityManager;
  }): Promise<FindingCase[]> {
    const fingerprints = fingerprintFindings(
      input.review.comments.filter(
        (finding) => finding.status === 'fail' || finding.status === 'warning',
      ),
    );
    const plan = planFindingLifecycle({
      current: fingerprints,
      existingCases: [],
      completedReviewers: new Set(
        input.review.results.map((result) => result.name.trim().toLowerCase()),
      ),
    });
    const cases: FindingCase[] = [];

    for (const observed of plan.observed) {
      const findingCase = await this.caseRepository.save(
        this.caseRepository.create(
          {
            id: randomUUID(),
            requestedBy: input.analysis.requestedBy,
            owner: input.owner,
            repo: input.repo,
            pullNumber: input.analysis.pullNumber,
            reviewer: observed.finding.finding.reviewer.trim().toLowerCase(),
            fingerprintVersion: observed.finding.fingerprintVersion,
            fingerprint: observed.finding.fingerprint,
            fingerprintMaterial: observed.finding.fingerprintMaterial,
            matchBasis: observed.finding.matchBasis,
            state: 'active',
            disposition: 'unreviewed',
            dispositionNote: null,
            firstSeenAnalysisId: input.analysis.id,
            lastSeenAnalysisId: input.analysis.id,
            resolvedInAnalysisId: null,
            reopenedCount: 0,
          },
          input.manager,
        ),
        undefined,
        input.manager,
      );
      await this.saveOccurrenceAndEvent({
        findingCase,
        analysisId: input.analysis.id,
        classification: 'new',
        eventType: 'first_seen',
        previousOccurrenceAnalysisId: null,
        observed,
        manager: input.manager,
      });
      cases.push(findingCase);
    }

    return cases;
  }

  private async saveOccurrenceAndEvent(input: {
    findingCase: FindingCase;
    analysisId: string;
    classification: FindingClassification;
    eventType: FindingCaseEventType;
    previousOccurrenceAnalysisId: string | null;
    observed: ReturnType<typeof planFindingLifecycle>['observed'][number];
    manager: EntityManager;
  }): Promise<void> {
    const finding = input.observed.finding.finding;
    await this.occurrenceRepository.save(
      this.occurrenceRepository.create(
        {
          id: randomUUID(),
          caseId: input.findingCase.id,
          analysisId: input.analysisId,
          classification: input.classification,
          severity: finding.status as 'fail' | 'warning',
          reviewer: finding.reviewer.trim().toLowerCase(),
          title: finding.title,
          detail: finding.detail,
          businessRule: finding.businessRule ?? null,
          conventionRef: finding.conventionRef ?? null,
          evidenceId: finding.evidenceId ?? null,
          path: finding.path ?? null,
          line: finding.line ?? null,
          endLine: finding.endLine ?? null,
          sourceCount: input.observed.finding.sourceCount,
        },
        input.manager,
      ),
      undefined,
      input.manager,
    );
    await this.eventRepository.save(
      this.eventRepository.create(
        {
          id: randomUUID(),
          caseId: input.findingCase.id,
          analysisId: input.analysisId,
          actorId: null,
          type: input.eventType,
          payload: {
            classification: input.classification,
            previousOccurrenceAnalysisId: input.previousOccurrenceAnalysisId,
          },
        },
        input.manager,
      ),
      undefined,
      input.manager,
    );
  }
}

function occurrencePayload(occurrence: FindingOccurrence) {
  return {
    severity: occurrence.severity,
    reviewer: occurrence.reviewer,
    title: occurrence.title,
    detail: occurrence.detail,
    path: occurrence.path ?? null,
    line: occurrence.line ?? null,
    endLine: occurrence.endLine ?? null,
    businessRule: occurrence.businessRule ?? null,
    conventionRef: occurrence.conventionRef ?? null,
    evidenceId: occurrence.evidenceId ?? null,
  };
}

function lifecycleRank(
  classification: LifecycleListItem['classification'],
): number {
  switch (classification) {
    case 'reopened':
      return 0;
    case 'new':
      return 1;
    case 'recurring':
      return 2;
    case 'not_observed':
      return 3;
  }
}

function severityRank(item: LifecycleListItem): number {
  const occurrence = item.currentOccurrence ?? item.lastOccurrence;
  return occurrence?.severity === 'fail' ? 0 : 1;
}

function compareLifecycleItems(
  left: LifecycleListItem,
  right: LifecycleListItem,
): number {
  const rank = lifecycleSortRank(left) - lifecycleSortRank(right);
  if (rank !== 0) return rank;
  const transitioned = right.transitionedAt.localeCompare(left.transitionedAt);
  if (transitioned !== 0) return transitioned;
  return right.caseId.localeCompare(left.caseId);
}

function compareItemToCursor(
  item: LifecycleListItem,
  cursor: LifecycleCursor,
): number {
  const rank = lifecycleSortRank(item) - cursor.rank;
  if (rank !== 0) return rank;
  const transitioned = cursor.transitionedAt.localeCompare(item.transitionedAt);
  if (transitioned !== 0) return transitioned;
  return cursor.caseId.localeCompare(item.caseId);
}

function lifecycleSortRank(item: LifecycleListItem): number {
  return lifecycleRank(item.classification) * 2 + severityRank(item);
}
