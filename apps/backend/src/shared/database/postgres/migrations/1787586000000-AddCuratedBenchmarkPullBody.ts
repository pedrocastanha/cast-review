import type { MigrationInterface, QueryRunner } from 'typeorm';
import { CURATED_BENCHMARK_CASES } from '../../../../modules/benchmarks/fixtures/curated-benchmark-cases';

export class AddCuratedBenchmarkPullBody1787586000000
  implements MigrationInterface
{
  name = 'AddCuratedBenchmarkPullBody1787586000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const benchmarkCase of CURATED_BENCHMARK_CASES) {
      await queryRunner.query(
        `
          UPDATE "benchmark_cases"
          SET "source" = $1::jsonb, "updated_at" = NOW()
          WHERE "id" = $2 AND "kind" = 'curated'
        `,
        [JSON.stringify(benchmarkCase.source), benchmarkCase.id],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "benchmark_cases"
      SET "source" = "source" - 'body', "updated_at" = NOW()
      WHERE "kind" = 'curated'
    `);
  }
}
