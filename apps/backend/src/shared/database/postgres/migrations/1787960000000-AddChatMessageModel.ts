import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChatMessageModel1787960000000 implements MigrationInterface {
  name = 'AddChatMessageModel1787960000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "chat_messages" ADD "model" character varying',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "chat_messages" DROP COLUMN "model"');
  }
}
