import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowWebhookInstallationUpdates1789200000000
  implements MigrationInterface
{
  name = 'AllowWebhookInstallationUpdates1789200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE POLICY "github_installations_service_events"
      ON "github_installations"
      FOR UPDATE
      USING (app.actor_type() = 'service')
      WITH CHECK (app.actor_type() = 'service')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS "github_installations_service_events"
      ON "github_installations"
    `);
  }
}
