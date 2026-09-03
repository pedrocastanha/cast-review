import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGithubApp1788500000000 implements MigrationInterface {
  name = 'CreateGithubApp1788500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "github_installations" (
        "id" uuid NOT NULL,
        "installation_id" bigint NOT NULL,
        "account_login" character varying NOT NULL,
        "account_type" character varying NOT NULL,
        "account_id" bigint,
        "owner_user_id" uuid,
        "status" character varying NOT NULL,
        "repository_selection" character varying,
        "permissions" jsonb NOT NULL DEFAULT '{}',
        "events" jsonb NOT NULL DEFAULT '[]',
        "paused_at" TIMESTAMP WITH TIME ZONE,
        "suspended_at" TIMESTAMP WITH TIME ZONE,
        "linked_at" TIMESTAMP WITH TIME ZONE,
        "last_event_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_github_installations" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_github_installations_installation_id" UNIQUE ("installation_id"),
        CONSTRAINT "FK_github_installations_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_github_installations_owner" ON "github_installations" ("owner_user_id")',
    );

    await queryRunner.query(`
      CREATE TABLE "github_app_repositories" (
        "id" uuid NOT NULL,
        "installation_id" uuid NOT NULL,
        "github_repo_id" bigint NOT NULL,
        "owner" character varying NOT NULL,
        "repo" character varying NOT NULL,
        "full_name" character varying NOT NULL,
        "is_private" boolean NOT NULL DEFAULT false,
        "default_branch" character varying,
        "enabled" boolean NOT NULL DEFAULT false,
        "config" jsonb NOT NULL,
        "config_status" character varying NOT NULL DEFAULT 'configuration_required',
        "config_reason" text,
        "paused_at" TIMESTAMP WITH TIME ZONE,
        "removed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_github_app_repositories" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_github_app_repositories_installation_repo" UNIQUE ("installation_id", "github_repo_id"),
        CONSTRAINT "FK_github_app_repositories_installation" FOREIGN KEY ("installation_id") REFERENCES "github_installations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_github_app_repositories_installation" ON "github_app_repositories" ("installation_id")',
    );

    await queryRunner.query(`
      CREATE TABLE "github_webhook_deliveries" (
        "id" uuid NOT NULL,
        "delivery_id" character varying NOT NULL,
        "event" character varying NOT NULL,
        "action" character varying,
        "installation_id" bigint,
        "repository_full_name" character varying,
        "pull_number" integer,
        "head_sha" character varying,
        "status" character varying NOT NULL,
        "reason" text,
        "review_run_id" uuid,
        "payload" jsonb,
        "received_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "processed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_github_webhook_deliveries" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_github_webhook_deliveries_delivery_id" UNIQUE ("delivery_id")
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_github_webhook_deliveries_installation" ON "github_webhook_deliveries" ("installation_id")',
    );

    await queryRunner.query(`
      CREATE TABLE "github_review_runs" (
        "id" uuid NOT NULL,
        "installation_id" uuid NOT NULL,
        "repository_id" uuid NOT NULL,
        "github_installation_id" bigint NOT NULL,
        "owner" character varying NOT NULL,
        "repo" character varying NOT NULL,
        "pull_number" integer NOT NULL,
        "head_sha" character varying NOT NULL,
        "base_ref" character varying,
        "config_hash" character varying(64) NOT NULL,
        "delivery_id" character varying,
        "trigger" character varying NOT NULL,
        "event_action" character varying,
        "status" character varying NOT NULL,
        "skip_reason" character varying,
        "error_message" text,
        "analysis_id" uuid,
        "check_run" jsonb,
        "budget_month" character varying(7) NOT NULL,
        "reserved_usd" numeric(12,6) NOT NULL DEFAULT 0,
        "consumed_usd" numeric(12,6),
        "attempts" integer NOT NULL DEFAULT 0,
        "queued_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "started_at" TIMESTAMP WITH TIME ZONE,
        "finished_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_github_review_runs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_github_review_runs_logical" UNIQUE ("repository_id", "pull_number", "head_sha", "config_hash"),
        CONSTRAINT "FK_github_review_runs_installation" FOREIGN KEY ("installation_id") REFERENCES "github_installations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_github_review_runs_repository" FOREIGN KEY ("repository_id") REFERENCES "github_app_repositories"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_github_review_runs_analysis" FOREIGN KEY ("analysis_id") REFERENCES "analyses"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_github_review_runs_installation" ON "github_review_runs" ("installation_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_github_review_runs_repo_pull" ON "github_review_runs" ("repository_id", "pull_number", "status")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_github_review_runs_analysis" ON "github_review_runs" ("analysis_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_github_review_runs_budget" ON "github_review_runs" ("repository_id", "budget_month", "status")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "github_review_runs"');
    await queryRunner.query('DROP TABLE "github_webhook_deliveries"');
    await queryRunner.query('DROP TABLE "github_app_repositories"');
    await queryRunner.query('DROP TABLE "github_installations"');
  }
}
