import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOpenaiKeyToUsers1787950000000 implements MigrationInterface {
  name = 'AddOpenaiKeyToUsers1787950000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "users" ADD "openai_key" character varying');
    await queryRunner.query(
      'ALTER TABLE "users" ADD "openai_key_last_four" character varying(4)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "users" DROP COLUMN "openai_key_last_four"');
    await queryRunner.query('ALTER TABLE "users" DROP COLUMN "openai_key"');
  }
}
