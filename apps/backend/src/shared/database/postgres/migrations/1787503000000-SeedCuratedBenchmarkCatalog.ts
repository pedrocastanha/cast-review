import type { MigrationInterface, QueryRunner } from 'typeorm';
import { CURATED_BENCHMARK_CASES } from '../../../../modules/benchmarks/fixtures/curated-benchmark-cases';

export class SeedCuratedBenchmarkCatalog1787503000000
  implements MigrationInterface
{
  name = 'SeedCuratedBenchmarkCatalog1787503000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_benchmark_cases_curated_slug"
      ON "benchmark_cases" ("slug")
      WHERE "kind" = 'curated' AND "slug" IS NOT NULL
    `);

    for (const benchmarkCase of CURATED_BENCHMARK_CASES) {
      await queryRunner.query(
        `
          INSERT INTO "benchmark_cases" (
            "id",
            "slug",
            "title",
            "kind",
            "evaluation_mode",
            "owner_id",
            "source",
            "input_snapshot",
            "graph_snapshot",
            "ground_truth",
            "version",
            "created_at",
            "updated_at",
            "active"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $12, true)
          ON CONFLICT DO NOTHING
        `,
        [
          benchmarkCase.id,
          benchmarkCase.slug,
          benchmarkCase.title,
          benchmarkCase.kind,
          benchmarkCase.evaluationMode,
          benchmarkCase.ownerId,
          JSON.stringify(benchmarkCase.source),
          JSON.stringify(benchmarkCase.inputSnapshot),
          JSON.stringify(benchmarkCase.graphSnapshot),
          benchmarkCase.groundTruth === null
            ? null
            : JSON.stringify(benchmarkCase.groundTruth),
          benchmarkCase.version,
          benchmarkCase.source.mergedAt,
        ],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DELETE FROM "benchmark_cases" WHERE "id" = ANY($1::uuid[])',
      [CURATED_BENCHMARK_CASES.map((benchmarkCase) => benchmarkCase.id)],
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_benchmark_cases_curated_slug"',
    );
  }
}
