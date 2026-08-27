import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateChatThreads1787900000000 implements MigrationInterface {
  name = 'CreateChatThreads1787900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "chat_threads" (
        "id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "scope_type" character varying NOT NULL,
        "repo_id" character varying,
        "project_id" uuid,
        "title" character varying(120) NOT NULL,
        "scope" jsonb NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_chat_threads" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chat_threads_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_chat_threads_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_chat_threads_user_id" ON "chat_threads" ("user_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_chat_threads_user_updated" ON "chat_threads" ("user_id", "updated_at")',
    );

    await queryRunner.query(`
      CREATE TABLE "chat_messages" (
        "id" uuid NOT NULL,
        "thread_id" uuid NOT NULL,
        "role" character varying NOT NULL,
        "content" text NOT NULL,
        "mentions" jsonb NOT NULL DEFAULT '[]',
        "tool_calls" jsonb NOT NULL DEFAULT '[]',
        "citations" jsonb NOT NULL DEFAULT '[]',
        "usage" jsonb,
        "truncated" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_chat_messages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chat_messages_thread" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_chat_messages_thread_created" ON "chat_messages" ("thread_id", "created_at")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "chat_messages"');
    await queryRunner.query('DROP TABLE "chat_threads"');
  }
}
