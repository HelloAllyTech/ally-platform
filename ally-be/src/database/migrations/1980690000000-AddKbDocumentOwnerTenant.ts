import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ownership for knowledge-base documents, for the Ally guide's library
 * (plans/ally-guide/plan.md §7.6, `ally_guide_library`).
 *
 * That corpus holds two kinds of document: the platform's, available to every learner,
 * and one organisation's own protocols and handbooks, which that organisation adds and
 * removes itself. Audience (`is_global` + `kb_document_tenants`) already says who may
 * RETRIEVE a document; it cannot say who may MANAGE one — a document targeted at one
 * organisation could equally be a platform document shared with them. This column says
 * it outright, and it is what the organisation-scoped admin routes filter on, so an
 * organisation's route reaches its own documents and never another's or the platform's.
 *
 * Nullable with no default and no backfill: every existing document is the platform's
 * (null), which is what the column means for them. No foreign key to `tenants`, matching
 * `kb_document_tenants.tenant_id` — the existence check happens on write, and a
 * document outliving a hard-deleted tenant should be archivable rather than cascade away
 * with its citations.
 *
 * The composite index serves the only query shape that reads it: one corpus, one owner.
 */
export class AddKbDocumentOwnerTenant1980690000000 implements MigrationInterface {
  name = 'AddKbDocumentOwnerTenant1980690000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "kb_documents" ADD COLUMN IF NOT EXISTS "owner_tenant_id" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_kb_documents_corpus_owner" ON "kb_documents" ("corpus", "owner_tenant_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_kb_documents_corpus_owner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kb_documents" DROP COLUMN IF EXISTS "owner_tenant_id"`,
    );
  }
}
