import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProjects1787670000000 implements MigrationInterface {
  name = 'CreateProjects1787670000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "projects" (
        "id" uuid NOT NULL,
        "owner_id" uuid NOT NULL,
        "name" character varying(80) NOT NULL,
        "description" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_projects" PRIMARY KEY ("id"),
        CONSTRAINT "FK_projects_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_projects_owner_active" ON "projects" ("owner_id", "active")',
    );
    await queryRunner.query(`
      CREATE TABLE "project_repositories" (
        "id" uuid NOT NULL,
        "project_id" uuid NOT NULL,
        "github_id" character varying NOT NULL,
        "owner" character varying NOT NULL,
        "name" character varying NOT NULL,
        "full_name" character varying NOT NULL,
        "private" boolean NOT NULL,
        "description" text,
        "html_url" character varying NOT NULL,
        "default_branch" character varying NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_project_repositories" PRIMARY KEY ("id"),
        CONSTRAINT "FK_project_repositories_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_project_repositories_project_full_name" UNIQUE ("project_id", "full_name")
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_project_repositories_project" ON "project_repositories" ("project_id")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "project_repositories"');
    await queryRunner.query('DROP TABLE "projects"');
  }
}
