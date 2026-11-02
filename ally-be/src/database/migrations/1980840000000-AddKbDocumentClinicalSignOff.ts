import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Clinical sign-off on knowledge documents (v9 FR-16; plan §8.5): a document
 * the Ally team marks clinical is served to the Debrief agent only once the
 * clinical advisor has signed off THIS content. The content hash at sign-off
 * is kept, so an edit afterwards needs a new sign-off before it is served.
 *
 * Hand-written SQL, never `migration:generate`.
 */
export class AddKbDocumentClinicalSignOff1980840000000 implements MigrationInterface {
  name = 'AddKbDocumentClinicalSignOff1980840000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kb_documents"
        ADD COLUMN IF NOT EXISTS "needs_clinical_sign_off" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "clinical_signed_off_by" integer,
        ADD COLUMN IF NOT EXISTS "clinical_signed_off_at" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "clinical_signed_off_hash" character varying(64)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kb_documents"
        DROP COLUMN IF EXISTS "clinical_signed_off_hash",
        DROP COLUMN IF EXISTS "clinical_signed_off_at",
        DROP COLUMN IF EXISTS "clinical_signed_off_by",
        DROP COLUMN IF EXISTS "needs_clinical_sign_off"
    `);
  }
}
