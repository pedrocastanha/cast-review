import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnalysisImpactScope1787756400000 implements MigrationInterface {
  name = 'AddAnalysisImpactScope1787756400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "analyses" ADD "impact_scope" jsonb');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "analyses" DROP COLUMN "impact_scope"',
    );
  }
}
