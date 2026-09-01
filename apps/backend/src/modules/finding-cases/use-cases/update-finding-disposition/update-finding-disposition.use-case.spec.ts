import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { FindingCaseRepository } from '../../finding-case.repository';
import type { FindingCaseEventRepository } from '../../finding-case-event.repository';
import { UpdateFindingDispositionUseCase } from './update-finding-disposition.use-case';

function harness() {
  const findingCase = {
    id: 'case-1',
    requestedBy: 'user-1',
    state: 'active',
    disposition: 'unreviewed',
    dispositionNote: null,
    updatedAt: new Date('2026-09-01T12:00:00.000Z'),
  };
  const manager = { query: jest.fn(async () => []) };
  const caseRepository = {
    datasource: {
      transaction: jest.fn(async (work: (value: typeof manager) => unknown) =>
        work(manager),
      ),
    },
    findOne: jest.fn(
      async ({ where }: { where: { id: string; requestedBy: string } }) =>
        where.id === findingCase.id &&
        where.requestedBy === findingCase.requestedBy
          ? findingCase
          : null,
    ),
    update: jest.fn(async (_id: string, changes: Record<string, unknown>) => {
      Object.assign(findingCase, changes);
      return { affected: 1 };
    }),
  };
  const events: Array<Record<string, unknown>> = [];
  const eventRepository = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => {
      events.push(value);
      return value;
    }),
  };
  const useCase = new UpdateFindingDispositionUseCase(
    caseRepository as unknown as FindingCaseRepository,
    eventRepository as unknown as FindingCaseEventRepository,
  );
  return { useCase, findingCase, caseRepository, events, manager };
}

describe('UpdateFindingDispositionUseCase', () => {
  it('normaliza, persiste e audita a nova disposição', async () => {
    const { useCase, findingCase, events, manager } = harness();

    const result = await useCase.execute('case-1', 'user-1', {
      disposition: 'accepted_risk',
      note: '  migração pendente  ',
    });

    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      ['finding-case|case-1'],
    );
    expect(findingCase).toMatchObject({
      disposition: 'accepted_risk',
      dispositionNote: 'migração pendente',
    });
    expect(events).toEqual([
      expect.objectContaining({
        caseId: 'case-1',
        actorId: 'user-1',
        type: 'disposition_changed',
      }),
    ]);
    expect(result).toMatchObject({
      id: 'case-1',
      disposition: 'accepted_risk',
    });
  });

  it('é idempotente quando disposição e nota já são iguais', async () => {
    const { useCase, findingCase, caseRepository, events } = harness();
    Object.assign(findingCase, {
      disposition: 'accepted_risk',
      dispositionNote: 'migração pendente',
    });

    await useCase.execute('case-1', 'user-1', {
      disposition: 'accepted_risk',
      note: ' migração pendente ',
    });

    expect(caseRepository.update).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it('exige nota para falso positivo', async () => {
    const { useCase } = harness();

    await expect(
      useCase.execute('case-1', 'user-1', {
        disposition: 'false_positive',
        note: null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('esconde case de outro usuário com 404', async () => {
    const { useCase } = harness();

    await expect(
      useCase.execute('case-1', 'other-user', {
        disposition: 'accepted_risk',
        note: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
