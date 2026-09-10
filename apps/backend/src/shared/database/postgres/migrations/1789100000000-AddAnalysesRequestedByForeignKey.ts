import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnalysesRequestedByForeignKey1789100000000
  implements MigrationInterface
{
  name = 'AddAnalysesRequestedByForeignKey1789100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const removed = (await queryRunner.query(`
      DELETE FROM "analyses" a
      WHERE NOT EXISTS (
        SELECT 1 FROM "users" u WHERE u.id = a.requested_by
      )
    `)) as [unknown[], number];

    if (removed[1] > 0) {
      console.warn(
        `[migration] removed ${removed[1]} orphan analyses before adding requested_by FK`,
      );
    }

    const [constraint] = (await queryRunner.query(`
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'FK_analyses_requested_by_user'
    `)) as Array<{ '?column?': number }>;

    if (!constraint) {
      await queryRunner.query(`
        ALTER TABLE "analyses"
        ADD CONSTRAINT "FK_analyses_requested_by_user"
        FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE CASCADE
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "analyses" DROP CONSTRAINT IF EXISTS "FK_analyses_requested_by_user"`,
    );
  }
}
