import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBenchmarkLab1787501000000 implements MigrationInterface {
  name = 'CreateBenchmarkLab1787501000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "benchmark_cases" (
        "id" uuid NOT NULL,
        "slug" character varying,
        "title" character varying NOT NULL,
        "kind" character varying NOT NULL,
        "evaluation_mode" character varying NOT NULL,
        "owner_id" uuid,
        "source" jsonb NOT NULL,
        "input_snapshot" jsonb NOT NULL,
        "graph_snapshot" jsonb NOT NULL,
        "ground_truth" jsonb,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_benchmark_cases" PRIMARY KEY ("id"),
        CONSTRAINT "FK_benchmark_cases_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_benchmark_cases_owner_kind" ON "benchmark_cases" ("owner_id", "kind")',
    );
    await queryRunner.query(`
      CREATE TABLE "benchmark_runs" (
        "id" uuid NOT NULL,
        "case_id" uuid NOT NULL,
        "requested_by" uuid NOT NULL,
        "status" character varying NOT NULL,
        "models" jsonb NOT NULL,
        "prompt_version" character varying NOT NULL,
        "graph_snapshot_hash" character varying NOT NULL,
        "results" jsonb,
        "error_message" text,
        "finished_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_benchmark_runs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_benchmark_runs_case" FOREIGN KEY ("case_id") REFERENCES "benchmark_cases"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_benchmark_runs_user" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_benchmark_runs_case_created" ON "benchmark_runs" ("case_id", "created_at")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "benchmark_runs"');
    await queryRunner.query('DROP TABLE "benchmark_cases"');
  }
}
