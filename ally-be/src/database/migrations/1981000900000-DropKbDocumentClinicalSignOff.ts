import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Context Library, phase 6: drop the Knowledge Base's clinical sign-off (PLAN.md §1, decision 8 —
 * "Clinical sign-off: dropped").
 *
 * `needs_clinical_sign_off` and the three `clinical_signed_off_*` columns gated the Debrief
 * corpus: a clinical document was served only once the clinical advisor had signed off its
 * current text. Debrief now reads Debrief Guidance, where `clinical` is an information-only
 * attribute, and the code that set and checked these columns is deleted in the same change.
 *
 * Separate from, and after, `1981000800000`, which copied each document's flag onto its imported
 * guidelines (and held unsigned clinical ones back as archived) — that migration only copies; this
 * one destroys. It refuses to run while any passage of a document that copy covers has no copy,
 * so a skipped or failed copy can never lose the flag.
 *
 * `down` recreates the columns empty (nothing signed off); the flags live on in `cl_chunks`.
 */
export class DropKbDocumentClinicalSignOff1981000900000 implements MigrationInterface {
  name = 'DropKbDocumentClinicalSignOff1981000900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('kb_documents'))) return;
    const [missing] = await queryRunner.query(
      `SELECT count(*)::int AS n
         FROM "kb_document_chunks" c
         JOIN "kb_documents" d ON d."id" = c."document_id" AND c."chunk_version" = d."chunk_version"
        WHERE d."corpus" IN ('ally_guide_library', 'debrief_knowledge')
          AND d."archived_at" IS NULL AND d."status" = 'indexed'
          AND char_length(trim(COALESCE(c."text", ''))) > 0
          AND NOT EXISTS (
            SELECT 1 FROM "cl_chunks" k WHERE k."sync_key" = 'kb_document_chunks:' || c."id")`,
    );
    if (Number(missing?.n ?? 0) > 0) {
      throw new Error(
        `${missing.n} Ally guide or Debrief passage(s) have no Context Library copy; re-run ` +
          'CopyGuideAndDebriefPassagesIntoContextLibrary1981000800000 before dropping clinical sign-off.',
      );
    }
    await queryRunner.query(`
      ALTER TABLE "kb_documents"
        DROP COLUMN IF EXISTS "clinical_signed_off_hash",
        DROP COLUMN IF EXISTS "clinical_signed_off_at",
        DROP COLUMN IF EXISTS "clinical_signed_off_by",
        DROP COLUMN IF EXISTS "needs_clinical_sign_off"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kb_documents"
        ADD COLUMN IF NOT EXISTS "needs_clinical_sign_off" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "clinical_signed_off_by" integer,
        ADD COLUMN IF NOT EXISTS "clinical_signed_off_at" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "clinical_signed_off_hash" character varying(64)
    `);
  }
}
