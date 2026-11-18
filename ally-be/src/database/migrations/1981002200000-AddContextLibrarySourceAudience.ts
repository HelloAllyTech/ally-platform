import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Context Library: a document's audience.
 *
 * `cl_sources.is_global` / `tenant_ids` record which organisations the chunks distilled from a
 * document reach — every one, or only those named — mirroring the same pair on `cl_chunks`. A
 * platform admin chooses them at upload and can change them later; re-extractions inherit them.
 *
 * Existing documents keep what their chunks already had: global, unless an organisation
 * uploaded it, in which case it reaches that organisation. Hand-written SQL.
 */
export class AddContextLibrarySourceAudience1981002200000 implements MigrationInterface {
  name = 'AddContextLibrarySourceAudience1981002200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cl_sources" ADD COLUMN IF NOT EXISTS "is_global" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "cl_sources" ADD COLUMN IF NOT EXISTS "tenant_ids" text[] NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `UPDATE "cl_sources"
          SET "is_global" = false, "tenant_ids" = ARRAY["owner_tenant_id"::text]
        WHERE "owner_tenant_id" IS NOT NULL AND "is_global" = true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cl_sources" DROP COLUMN IF EXISTS "tenant_ids"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cl_sources" DROP COLUMN IF EXISTS "is_global"`,
    );
  }
}
