import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateArchitectureMaps1788600000000 implements MigrationInterface {
  name = 'CreateArchitectureMaps1788600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "architecture_maps" (
        "id" uuid NOT NULL,
        "owner_id" uuid NOT NULL,
        "scope_type" character varying NOT NULL,
        "scope_ref" character varying NOT NULL,
        "name" character varying(80) NOT NULL,
        "published_version" integer,
        "published_hash" character varying(64),
        "published_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_architecture_maps" PRIMARY KEY ("id"),
        CONSTRAINT "FK_architecture_maps_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_architecture_maps_owner_scope" UNIQUE ("owner_id", "scope_type", "scope_ref")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "architecture_map_versions" (
        "id" uuid NOT NULL,
        "map_id" uuid NOT NULL,
        "version" integer NOT NULL,
        "hash" character varying(64) NOT NULL,
        "snapshot" jsonb NOT NULL,
        "published_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_architecture_map_versions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_architecture_map_versions_map" FOREIGN KEY ("map_id") REFERENCES "architecture_maps"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_architecture_map_versions_user" FOREIGN KEY ("published_by") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "UQ_architecture_map_versions_map_version" UNIQUE ("map_id", "version")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "architecture_capabilities" (
        "id" uuid NOT NULL,
        "map_id" uuid NOT NULL,
        "name" character varying(80) NOT NULL,
        "description" text,
        "criticality" character varying NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_architecture_capabilities" PRIMARY KEY ("id"),
        CONSTRAINT "FK_architecture_capabilities_map" FOREIGN KEY ("map_id") REFERENCES "architecture_maps"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_architecture_capabilities_map_name" UNIQUE ("map_id", "name")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "architecture_components" (
        "id" uuid NOT NULL,
        "map_id" uuid NOT NULL,
        "capability_id" uuid,
        "candidate_key" character varying NOT NULL,
        "repo_id" character varying NOT NULL,
        "path_prefix" character varying NOT NULL,
        "label" character varying NOT NULL,
        "kind" character varying NOT NULL,
        "source" character varying NOT NULL,
        "confidence" character varying NOT NULL,
        "status" character varying NOT NULL,
        "indexed_sha" character varying,
        "metrics" jsonb NOT NULL DEFAULT '{}',
        "evidence" jsonb NOT NULL DEFAULT '[]',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_architecture_components" PRIMARY KEY ("id"),
        CONSTRAINT "FK_architecture_components_map" FOREIGN KEY ("map_id") REFERENCES "architecture_maps"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_architecture_components_capability" FOREIGN KEY ("capability_id") REFERENCES "architecture_capabilities"("id") ON DELETE SET NULL,
        CONSTRAINT "UQ_architecture_components_map_candidate" UNIQUE ("map_id", "candidate_key")
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_architecture_components_map_capability" ON "architecture_components" ("map_id", "capability_id")',
    );

    await queryRunner.query(`
      CREATE TABLE "architecture_boundaries" (
        "id" uuid NOT NULL,
        "map_id" uuid NOT NULL,
        "from_capability_id" uuid NOT NULL,
        "to_capability_id" uuid NOT NULL,
        "kind" character varying NOT NULL,
        "note" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_architecture_boundaries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_architecture_boundaries_map" FOREIGN KEY ("map_id") REFERENCES "architecture_maps"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_architecture_boundaries_from" FOREIGN KEY ("from_capability_id") REFERENCES "architecture_capabilities"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_architecture_boundaries_to" FOREIGN KEY ("to_capability_id") REFERENCES "architecture_capabilities"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_architecture_boundaries_map_pair" UNIQUE ("map_id", "from_capability_id", "to_capability_id")
      )
    `);

    await queryRunner.query(
      'ALTER TABLE "analyses" ADD COLUMN "architecture_impact" jsonb',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "analyses" DROP COLUMN "architecture_impact"',
    );
    await queryRunner.query('DROP TABLE "architecture_boundaries"');
    await queryRunner.query('DROP TABLE "architecture_components"');
    await queryRunner.query('DROP TABLE "architecture_capabilities"');
    await queryRunner.query('DROP TABLE "architecture_map_versions"');
    await queryRunner.query('DROP TABLE "architecture_maps"');
  }
}
