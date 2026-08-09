import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeUsernameNullable1786205000000 implements MigrationInterface {
  name = 'MakeUsernameNullable1786205000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "username" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL`,
    );
  }
}
