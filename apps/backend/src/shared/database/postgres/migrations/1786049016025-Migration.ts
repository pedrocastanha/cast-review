import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1786049016025 implements MigrationInterface {
  name = 'Migration1786049016025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "github_token" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_75e3f8fedec94bab4c751ee9910" UNIQUE ("github_token")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_75e3f8fedec94bab4c751ee9910"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "github_token"`);
  }
}
