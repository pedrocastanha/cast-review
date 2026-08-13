import { decryptSecret } from 'src/shared/crypto/secret-crypto';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGithubTokenLastFour1786500000000 implements MigrationInterface {
  name = 'AddGithubTokenLastFour1786500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "github_token_last_four" character varying(4)`,
    );

    const rows: { id: string; github_token: string }[] =
      await queryRunner.query(
        `SELECT "id", "github_token" FROM "users" WHERE "github_token" IS NOT NULL AND "github_token_last_four" IS NULL`,
      );

    for (const row of rows) {
      const token = decryptSecret(row.github_token);
      await queryRunner.query(
        `UPDATE "users" SET "github_token_last_four" = $1 WHERE "id" = $2`,
        [token.slice(-4), row.id],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "github_token_last_four"`,
    );
  }
}
