import type { GithubAppRepository } from '../../entities/github-app-repository.entity';
import { defaultRepositoryConfig } from '../../domain/github-app.types';
import {
  DEFAULT_RUN_RESERVATION_USD,
  ReserveBudgetUseCase,
} from './reserve-budget.use-case';

function repository(
  budgetMonthlyUsd: number | null,
  budgetPerRunUsd: number | null = null,
) {
  return {
    id: 'repo-row',
    config: { ...defaultRepositoryConfig(), budgetMonthlyUsd, budgetPerRunUsd },
  } as GithubAppRepository;
}

function build(existingRuns: Array<Record<string, unknown>> = []) {
  const update = jest.fn().mockResolvedValue(undefined);
  const managerUpdate = jest.fn().mockResolvedValue(undefined);
  const reviewRunRepository = {
    find: jest.fn().mockResolvedValue(existingRuns),
    update,
    datasource: {
      transaction: jest.fn(
        async (_level: string, work: (manager: unknown) => Promise<boolean>) =>
          work({
            find: jest.fn().mockResolvedValue(existingRuns),
            update: managerUpdate,
          }),
      ),
    },
  };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    service: new ReserveBudgetUseCase(reviewRunRepository as any, logger as any),
    update,
    managerUpdate,
    reviewRunRepository,
  };
}

describe('ReserveBudgetUseCase.reservationFor', () => {
  it('uses the per-run limit when the repository sets one', () => {
    const { service } = build();
    expect(service.reservationFor(repository(10, 2))).toBe(2);
    expect(service.reservationFor(repository(10))).toBe(
      DEFAULT_RUN_RESERVATION_USD,
    );
  });
});

describe('ReserveBudgetUseCase.execute', () => {
  it('reserves without a ceiling check when no monthly limit exists', async () => {
    const { service, update } = build();
    await expect(service.execute(repository(null), 'run-1', 1)).resolves.toBe(
      true,
    );
    expect(update).toHaveBeenCalledWith('run-1', { reservedUsd: 1 });
  });

  it('reserves while the month still has room', async () => {
    const { service, managerUpdate } = build([
      { consumedUsd: 3, reservedUsd: 0.5 },
    ]);
    await expect(service.execute(repository(10), 'run-2', 2)).resolves.toBe(
      true,
    );
    expect(managerUpdate).toHaveBeenCalled();
  });

  it('refuses the reservation that would cross the monthly ceiling', async () => {
    const { service, managerUpdate } = build([
      { consumedUsd: 9, reservedUsd: 0 },
    ]);
    await expect(service.execute(repository(10), 'run-3', 2)).resolves.toBe(
      false,
    );
    expect(managerUpdate).not.toHaveBeenCalled();
  });

  it('counts a concurrent run that only holds a reservation, not a cost yet', async () => {
    const { service } = build([{ consumedUsd: null, reservedUsd: 9.5 }]);
    await expect(service.execute(repository(10), 'run-4', 1)).resolves.toBe(
      false,
    );
  });

  it('runs the ceiling check inside a SERIALIZABLE transaction', async () => {
    const { service, reviewRunRepository } = build([]);
    await service.execute(repository(10), 'run-5', 1);
    expect(reviewRunRepository.datasource.transaction).toHaveBeenCalledWith(
      'SERIALIZABLE',
      expect.any(Function),
    );
  });
});

describe('ReserveBudgetUseCase.usage', () => {
  it('reports consumed, reserved and remaining for the month', async () => {
    const { service } = build([
      { consumedUsd: 2, reservedUsd: 0.5 },
      { consumedUsd: null, reservedUsd: 1 },
    ]);
    await expect(service.usage(repository(10), '2026-09')).resolves.toEqual({
      month: '2026-09',
      consumedUsd: 2,
      reservedUsd: 1,
      limitUsd: 10,
      remainingUsd: 7,
    });
  });

  it('reports no remaining ceiling when the repository has no limit', async () => {
    const { service } = build([{ consumedUsd: 4, reservedUsd: 0 }]);
    await expect(
      service.usage(repository(null), '2026-09'),
    ).resolves.toMatchObject({
      limitUsd: null,
      remainingUsd: null,
    });
  });
});

describe('ReserveBudgetUseCase.settle', () => {
  it('records the real cost, never pretending a cancelled run cost zero by default', async () => {
    const { service, update } = build();
    await service.settle('run-1', 1.234);
    expect(update).toHaveBeenCalledWith('run-1', { consumedUsd: 1.234 });
  });
});
