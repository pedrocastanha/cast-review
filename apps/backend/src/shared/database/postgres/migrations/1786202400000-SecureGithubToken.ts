import {
  decryptSecret,
  encryptSecret,
  isEncrypted,
} from 'src/shared/crypto/secret-crypto';
import { MigrationInterface, QueryRunner } from 'typeorm';

const UNIQUE_CONSTRAINT = 'UQ_75e3f8fedec94bab4c751ee9910';

export class SecureGithubToken1786202400000 implements MigrationInterface {
  name = 'SecureGithubToken1786202400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "${UNIQUE_CONSTRAINT}"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "github_login" character varying`,
    );

    const rows: { id: string; github_token: string }[] =
      await queryRunner.query(
        `SELECT "id", "github_token" FROM "users" WHERE "github_token" IS NOT NULL`,
      );

    for (const row of rows) {
      if (isEncrypted(row.github_token)) {
        continue;
      }

      await queryRunner.query(
        `UPDATE "users" SET "github_token" = $1 WHERE "id" = $2`,
        [encryptSecret(row.github_token), row.id],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows: { id: string; github_token: string }[] =
      await queryRunner.query(
        `SELECT "id", "github_token" FROM "users" WHERE "github_token" IS NOT NULL`,
      );

    for (const row of rows) {
      if (!isEncrypted(row.github_token)) {
        continue;
      }

      await queryRunner.query(
        `UPDATE "users" SET "github_token" = $1 WHERE "id" = $2`,
        [decryptSecret(row.github_token), row.id],
      );
    }

    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "github_login"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "${UNIQUE_CONSTRAINT}" UNIQUE ("github_token")`,
    );
  }
}
