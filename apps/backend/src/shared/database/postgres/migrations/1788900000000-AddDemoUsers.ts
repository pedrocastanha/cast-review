import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDemoUsers1788900000000 implements MigrationInterface {
  name = 'AddDemoUsers1788900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "demo_expires_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_users_demo_expires_at" ON "users" ("demo_expires_at") WHERE "demo_expires_at" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_demo_expires_at"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "demo_expires_at"`,
    );
  }
}
