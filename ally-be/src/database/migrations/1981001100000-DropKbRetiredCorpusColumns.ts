import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Context Library, phase 8 (the dead-code sweep): drop the Knowledge Base columns that only the
 * retired corpora used.
 *
 * - `kb_documents.character_topics` and `kb_retrievals.character_topics`: the character corpus's
 *   topic mapping and the topics a character-interview search asked about. Unmapped since phase 4
 *   (Character Insights carry the aspects as a facet now). Nothing reads either: the character
 *   import rebuilds each old document from `kb_document_chunks` text only.
 * - `kb_documents.owner_tenant_id` (and its index): the organisation that owned an Ally guide
 *   library document. Written by nothing since phase 6; `1981000800000` copied each served
 *   passage's owner onto its imported chunk (`cl_chunks.owner_tenant_id`). WhatsApp Q&A documents
 *   never set it. The retirement job and the copy-status check key on `sync_key`, not on the owner,
 *   so rows of a corpus not yet retired lose nothing they still need.
 *
 * `analytics_agent_kb_retrievals` selects `character_topics`, so the view is recreated without it
 * (same definition otherwise, from `1969500000000`).
 *
 * Destroys data, so it is separate from any copy, and it refuses to run while a served Ally guide
 * library passage has no Context Library copy — a skipped or failed `1981000800000` must never lose
 * the owner. `down` recreates the columns empty and the view as it was.
 */
export class DropKbRetiredCorpusColumns1981001100000 implements MigrationInterface {
  name = 'DropKbRetiredCorpusColumns1981001100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('kb_documents')) {
      const [missing] = await queryRunner.query(
        `SELECT count(*)::int AS n
           FROM "kb_document_chunks" c
           JOIN "kb_documents" d ON d."id" = c."document_id" AND c."chunk_version" = d."chunk_version"
          WHERE d."corpus" = 'ally_guide_library'
            AND d."archived_at" IS NULL AND d."status" = 'indexed'
            AND char_length(trim(COALESCE(c."text", ''))) > 0
            AND NOT EXISTS (
              SELECT 1 FROM "cl_chunks" k WHERE k."sync_key" = 'kb_document_chunks:' || c."id")`,
      );
      if (Number(missing?.n ?? 0) > 0) {
        throw new Error(
          `${missing.n} Ally guide library passage(s) have no Context Library copy; re-run ` +
            'CopyGuideAndDebriefPassagesIntoContextLibrary1981000800000 before dropping their owner.',
        );
      }
      await queryRunner.query(
        `DROP INDEX IF EXISTS "public"."idx_kb_documents_corpus_owner"`,
      );
      await queryRunner.query(`
        ALTER TABLE "kb_documents"
          DROP COLUMN IF EXISTS "owner_tenant_id",
          DROP COLUMN IF EXISTS "character_topics"
      `);
    }

    if (await queryRunner.hasTable('kb_retrievals')) {
      await queryRunner.query(
        `DROP VIEW IF EXISTS "analytics_agent_kb_retrievals"`,
      );
      await queryRunner.query(
        `ALTER TABLE "kb_retrievals" DROP COLUMN IF EXISTS "character_topics"`,
      );
      await queryRunner.query(viewSql(false));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('kb_retrievals')) {
      await queryRunner.query(
        `DROP VIEW IF EXISTS "analytics_agent_kb_retrievals"`,
      );
      await queryRunner.query(
        `ALTER TABLE "kb_retrievals" ADD COLUMN IF NOT EXISTS "character_topics" text array NOT NULL DEFAULT '{}'`,
      );
      await queryRunner.query(viewSql(true));
    }
    if (await queryRunner.hasTable('kb_documents')) {
      await queryRunner.query(`
        ALTER TABLE "kb_documents"
          ADD COLUMN IF NOT EXISTS "character_topics" text[] NOT NULL DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS "owner_tenant_id" uuid
      `);
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS "idx_kb_documents_corpus_owner" ON "kb_documents" ("corpus", "owner_tenant_id")`,
      );
    }
  }
}

/** The Analytics Agent's fence over `kb_retrievals`: the query is nulled on sensitive rows. */
function viewSql(withCharacterTopics: boolean): string {
  return `
    CREATE OR REPLACE VIEW "analytics_agent_kb_retrievals" AS
    SELECT r.id,
           r.corpus,
           r.consumer,
           CASE WHEN r.query_sensitive THEN NULL ELSE r.query END AS query,
           r.query_sensitive,
           r.query_language,${withCharacterTopics ? '\n           r.character_topics,' : ''}
           r.tags,
           r.min_similarity,
           r.decline_similarity,
           r.disposition,
           r.requested_limit,
           r.fetch_limit,
           r.preferred_document_count,
           r.rest_document_count,
           r.first_pass_hits,
           r.second_pass_hits,
           r.returned_count,
           r.latency_ms,
           r.session_id,
           r.created_by,
           r."createdAt",
           r."updatedAt"
      FROM "kb_retrievals" r
  `;
}
