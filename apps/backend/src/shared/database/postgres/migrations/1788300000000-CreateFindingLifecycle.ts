import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFindingLifecycle1788300000000 implements MigrationInterface {
  name = 'CreateFindingLifecycle1788300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "finding_cases" (
        "id" uuid NOT NULL,
        "requested_by" uuid NOT NULL,
        "owner" character varying NOT NULL,
        "repo" character varying NOT NULL,
        "pull_number" integer NOT NULL,
        "reviewer" character varying NOT NULL,
        "fingerprint_version" character varying(16) NOT NULL,
        "fingerprint" character varying(64) NOT NULL,
        "fingerprint_material" text NOT NULL,
        "match_basis" character varying NOT NULL,
        "state" character varying NOT NULL,
        "disposition" character varying NOT NULL,
        "disposition_note" text,
        "first_seen_analysis_id" uuid,
        "last_seen_analysis_id" uuid,
        "resolved_in_analysis_id" uuid,
        "reopened_count" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_finding_cases" PRIMARY KEY ("id"),
        CONSTRAINT "FK_finding_cases_user" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_finding_cases_first_analysis" FOREIGN KEY ("first_seen_analysis_id") REFERENCES "analyses"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_finding_cases_last_analysis" FOREIGN KEY ("last_seen_analysis_id") REFERENCES "analyses"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_finding_cases_resolved_analysis" FOREIGN KEY ("resolved_in_analysis_id") REFERENCES "analyses"("id") ON DELETE SET NULL,
        CONSTRAINT "UQ_finding_cases_scope_fingerprint" UNIQUE ("requested_by", "owner", "repo", "pull_number", "fingerprint_version", "fingerprint")
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_finding_cases_scope_state" ON "finding_cases" ("requested_by", "owner", "repo", "pull_number", "state", "disposition")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_finding_cases_last_analysis" ON "finding_cases" ("last_seen_analysis_id")',
    );

    await queryRunner.query(`
      CREATE TABLE "finding_occurrences" (
        "id" uuid NOT NULL,
        "case_id" uuid NOT NULL,
        "analysis_id" uuid NOT NULL,
        "classification" character varying NOT NULL,
        "severity" character varying NOT NULL,
        "reviewer" character varying NOT NULL,
        "title" text NOT NULL,
        "detail" text NOT NULL,
        "business_rule" text,
        "convention_ref" text,
        "evidence_id" character varying,
        "path" text,
        "line" integer,
        "end_line" integer,
        "source_count" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_finding_occurrences" PRIMARY KEY ("id"),
        CONSTRAINT "FK_finding_occurrences_case" FOREIGN KEY ("case_id") REFERENCES "finding_cases"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_finding_occurrences_analysis" FOREIGN KEY ("analysis_id") REFERENCES "analyses"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_finding_occurrences_case_analysis" UNIQUE ("case_id", "analysis_id")
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_finding_occurrences_analysis_classification" ON "finding_occurrences" ("analysis_id", "classification", "created_at", "id")',
    );

    await queryRunner.query(`
      CREATE TABLE "finding_case_events" (
        "id" uuid NOT NULL,
        "case_id" uuid NOT NULL,
        "analysis_id" uuid,
        "actor_id" uuid,
        "type" character varying NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_finding_case_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_finding_case_events_case" FOREIGN KEY ("case_id") REFERENCES "finding_cases"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_finding_case_events_analysis" FOREIGN KEY ("analysis_id") REFERENCES "analyses"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_finding_case_events_actor" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_finding_case_events_case_created" ON "finding_case_events" ("case_id", "created_at", "id")',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "UQ_finding_case_events_automatic" ON "finding_case_events" ("case_id", "analysis_id", "type") WHERE "analysis_id" IS NOT NULL',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "finding_case_events"');
    await queryRunner.query('DROP TABLE "finding_occurrences"');
    await queryRunner.query('DROP TABLE "finding_cases"');
  }
}
