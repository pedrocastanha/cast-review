import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFeatureCards1788700000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE chat_messages ADD COLUMN proposal jsonb`);
    await runner.query(`CREATE TABLE feature_cards (
      id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      parent_id uuid REFERENCES feature_cards(id), source_message_id uuid NOT NULL REFERENCES chat_messages(id),
      task_key varchar(40) NOT NULL, title varchar(160) NOT NULL, area varchar(80) NOT NULL,
      status varchar NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','in_progress','review','done')),
      version integer NOT NULL DEFAULT 1, content jsonb NOT NULL, snapshot jsonb NOT NULL,
      depends_on jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz, active boolean NOT NULL DEFAULT true,
      UNIQUE (source_message_id, task_key)
    )`);
    await runner.query(`CREATE INDEX "IDX_feature_cards_board" ON feature_cards(project_id, active, id)`);
    await runner.query(`CREATE INDEX "IDX_feature_cards_parent" ON feature_cards(parent_id)`);
    await runner.query(`CREATE TABLE feature_card_revisions (
      id uuid PRIMARY KEY, card_id uuid NOT NULL REFERENCES feature_cards(id) ON DELETE CASCADE,
      actor_id uuid NOT NULL REFERENCES users(id), version integer NOT NULL, snapshot jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz, active boolean NOT NULL DEFAULT true
    )`);
    await runner.query(`CREATE UNIQUE INDEX "IDX_feature_card_revisions_card" ON feature_card_revisions(card_id, version)`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE feature_card_revisions');
    await runner.query('DROP TABLE feature_cards');
    await runner.query('ALTER TABLE chat_messages DROP COLUMN proposal');
  }
}
