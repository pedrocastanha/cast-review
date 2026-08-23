import type { MigrationInterface, QueryRunner } from 'typeorm';

const TABLES = [
  'analysis_context_snapshots',
  'benchmark_cases',
  'benchmark_runs',
];

export class AddDefaultColumnsToContextAndBenchmarks1787502000000
  implements MigrationInterface
{
  name = 'AddDefaultColumnsToContextAndBenchmarks1787502000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "active" boolean NOT NULL DEFAULT true`,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [...TABLES].reverse()) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "active"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "deleted_at"`,
      );
    }
  }
}
