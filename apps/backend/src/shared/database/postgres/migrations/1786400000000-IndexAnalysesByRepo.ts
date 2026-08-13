import { MigrationInterface, QueryRunner } from 'typeorm';

export class IndexAnalysesByRepo1786400000000 implements MigrationInterface {
  name = 'IndexAnalysesByRepo1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_analyses_user_repo" ON "analyses" ("requested_by", "owner", "repo")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_analyses_user_repo"`);
  }
}
