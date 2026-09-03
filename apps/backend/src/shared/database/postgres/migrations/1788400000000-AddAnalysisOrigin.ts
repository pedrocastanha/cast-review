import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnalysisOrigin1788400000000 implements MigrationInterface {
  name = 'AddAnalysisOrigin1788400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "analyses" ADD "origin" character varying NOT NULL DEFAULT 'manual'`,
    );
    await queryRunner.query(
      'ALTER TABLE "analyses" ADD "head_sha" character varying',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_analyses_origin" ON "analyses" ("origin")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_analyses_origin"');
    await queryRunner.query('ALTER TABLE "analyses" DROP COLUMN "head_sha"');
    await queryRunner.query('ALTER TABLE "analyses" DROP COLUMN "origin"');
  }
}
