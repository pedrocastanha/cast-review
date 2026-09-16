import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMcpTokens1789300000000 implements MigrationInterface {
  name = 'CreateMcpTokens1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "mcp_tokens" (
        "id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "active" boolean NOT NULL DEFAULT true,
        "user_id" uuid NOT NULL,
        "token_hash" character varying(64) NOT NULL,
        "project_ids" uuid[] NOT NULL DEFAULT '{}',
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_mcp_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "FK_mcp_tokens_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_mcp_tokens_token_hash" ON "mcp_tokens" ("token_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_mcp_tokens_user_id" ON "mcp_tokens" ("user_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "mcp_tokens" ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE "mcp_tokens" FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(`
      DO $$
      BEGIN
        EXECUTE format(
          'CREATE POLICY %I ON %I TO %I USING (true) WITH CHECK (true)',
          'mcp_tokens_maintenance', 'mcp_tokens', current_user
        );
      END
      $$
    `);
    await queryRunner.query(`
      CREATE POLICY "mcp_tokens_owner" ON "mcp_tokens"
        FOR ALL
        USING ("user_id" = app.current_user_id())
        WITH CHECK ("user_id" = app.current_user_id())
    `);
    // Introspecção resolve o token pelo hash antes de existir usuário
    // autenticado — mesmo problema de bootstrap que `refresh_sessions` resolve.
    await queryRunner.query(`
      CREATE POLICY "mcp_tokens_service_bootstrap" ON "mcp_tokens"
        FOR SELECT
        USING (app.actor_type() = 'service')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "mcp_tokens"`);
  }
}
