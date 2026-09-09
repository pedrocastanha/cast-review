import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRefreshSessions1788800000000 implements MigrationInterface {
  name = 'CreateRefreshSessions1788800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "refresh_sessions" (
        "id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "family_id" uuid NOT NULL,
        "token_hash" character varying(64) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "consumed_at" TIMESTAMP WITH TIME ZONE,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        "revoked_reason" character varying(32),
        CONSTRAINT "PK_refresh_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_refresh_sessions_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_refresh_sessions_token_hash" ON "refresh_sessions" ("token_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_sessions_family" ON "refresh_sessions" ("family_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_sessions_user_expiry" ON "refresh_sessions" ("user_id", "expires_at")`,
    );
    await queryRunner.query(
      `UPDATE "users" SET "current_refresh_token" = NULL WHERE "current_refresh_token" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "refresh_sessions"`);
  }
}
