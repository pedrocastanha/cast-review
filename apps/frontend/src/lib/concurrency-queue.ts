export class ConcurrencyQueue {
  private active = 0;
  private readonly pending: (() => void)[] = [];
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.pending.push(resolve));
    }

    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.pending.shift()?.();
    }
  }
}
