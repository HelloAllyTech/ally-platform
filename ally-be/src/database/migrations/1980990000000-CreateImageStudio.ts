import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Image Studio (docs/image-studio.md):
 *
 * - `generated_images`: one row per AI-generated image. It is the job the
 *   worker claims (status + heartbeat) and, afterwards, the history,
 *   provenance and cost record of the image.
 * - `tracks.imageStyleId` / `tracks.imageStyleAnchorId`: a course's visual
 *   style and its style-example image.
 * - `scenario_characters.appearance`: one line on how a character looks,
 *   compiled into every image they appear in.
 *
 * Additive only; `down` drops what `up` added.
 */
export class CreateImageStudio1980990000000 implements MigrationInterface {
  name = 'CreateImageStudio1980990000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "generated_images" (
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenantId" character varying(64),
        "createdBy" integer NOT NULL,
        "batchId" uuid NOT NULL,
        "slotKind" character varying(32) NOT NULL,
        "slotKey" character varying(300),
        "styleId" character varying(48) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'queued',
        "description" text NOT NULL,
        "sceneSpec" jsonb,
        "prompt" text NOT NULL,
        "altText" text,
        "references" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "castCharacterIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "characterId" uuid,
        "refinedFromId" uuid,
        "context" jsonb,
        "provider" character varying(32),
        "model" character varying(96),
        "quality" character varying(16),
        "width" integer,
        "height" integer,
        "originalKey" text,
        "displayKey" text,
        "imageUrl" text,
        "check" jsonb,
        "error" text,
        "attempts" integer NOT NULL DEFAULT 0,
        "startedAt" TIMESTAMP WITH TIME ZONE,
        "heartbeatAt" TIMESTAMP WITH TIME ZONE,
        "finishedAt" TIMESTAMP WITH TIME ZONE,
        "acceptedAt" TIMESTAMP WITH TIME ZONE,
        "costUsd" numeric(10,4),
        CONSTRAINT "PK_generated_images_id" PRIMARY KEY ("id"),
        CONSTRAINT "chk_generated_images_status" CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'expired'))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_generated_images_status_created" ON "generated_images" ("status", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_generated_images_tenant_slot" ON "generated_images" ("tenantId", "slotKey", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_generated_images_creator_status" ON "generated_images" ("createdBy", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_generated_images_cast" ON "generated_images" ("characterId", "styleId", "acceptedAt")`,
    );

    await queryRunner.query(
      `ALTER TABLE "tracks" ADD COLUMN IF NOT EXISTS "imageStyleId" character varying(48)`,
    );
    await queryRunner.query(
      `ALTER TABLE "tracks" ADD COLUMN IF NOT EXISTS "imageStyleAnchorId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_characters" ADD COLUMN IF NOT EXISTS "appearance" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_characters" DROP COLUMN IF EXISTS "appearance"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tracks" DROP COLUMN IF EXISTS "imageStyleAnchorId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tracks" DROP COLUMN IF EXISTS "imageStyleId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "generated_images"`);
  }
}
