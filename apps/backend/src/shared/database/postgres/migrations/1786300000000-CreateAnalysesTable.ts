import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAnalysesTable1786300000000 implements MigrationInterface {
  name = 'CreateAnalysesTable1786300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "analyses" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "active" boolean NOT NULL DEFAULT true,
        "requested_by" uuid NOT NULL,
        "owner" character varying NOT NULL,
        "repo" character varying NOT NULL,
        "pull_number" integer NOT NULL,
        "status" character varying NOT NULL,
        "report" jsonb,
        "thoughts" jsonb,
        "error_message" text,
        "models" jsonb,
        "finished_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_analyses" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_analyses_requested_by" ON "analyses" ("requested_by")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_analyses_requested_by"`);
    await queryRunner.query(`DROP TABLE "analyses"`);
  }
}
