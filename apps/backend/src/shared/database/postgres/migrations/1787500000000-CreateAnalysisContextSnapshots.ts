import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAnalysisContextSnapshots1787500000000
  implements MigrationInterface
{
  name = 'CreateAnalysisContextSnapshots1787500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "analysis_context_snapshots" (
        "id" uuid NOT NULL,
        "analysis_id" uuid NOT NULL,
        "schema_version" character varying NOT NULL,
        "snapshot_hash" character varying NOT NULL,
        "graph_snapshot" jsonb NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_analysis_context_snapshots" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_analysis_context_snapshots_analysis" UNIQUE ("analysis_id"),
        CONSTRAINT "FK_analysis_context_snapshots_analysis"
          FOREIGN KEY ("analysis_id") REFERENCES "analyses"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_analysis_context_snapshots_hash" ON "analysis_context_snapshots" ("snapshot_hash")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "analysis_context_snapshots"');
  }
}
