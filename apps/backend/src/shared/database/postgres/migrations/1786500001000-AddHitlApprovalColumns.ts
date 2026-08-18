import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHitlApprovalColumns1786500001000 implements MigrationInterface {
  name = 'AddHitlApprovalColumns1786500001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "analyses"
      ADD COLUMN "approval_stage" character varying,
      ADD COLUMN "publish_policy" jsonb,
      ADD COLUMN "prd_iterations" jsonb NOT NULL DEFAULT '[]',
      ADD COLUMN "spec_iterations" jsonb NOT NULL DEFAULT '[]',
      ADD COLUMN "resumed_count" integer NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "analyses"
      DROP COLUMN "approval_stage",
      DROP COLUMN "publish_policy",
      DROP COLUMN "prd_iterations",
      DROP COLUMN "spec_iterations",
      DROP COLUMN "resumed_count"
    `);
  }
}
