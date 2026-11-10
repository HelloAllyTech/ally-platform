import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  DEBRIEF_KINDS,
  DEBRIEF_LEVELS,
  PASSAGE_SYNC_PREFIX,
  headingFor,
  tagOf,
  withoutByline,
} from './context-library-passages.helpers';

/**
 * Context Library, phase 6 (docs/context-library/PLAN.md §6.5): import the Ally guide's library
 * and Debrief's guidance **word for word**.
 *
 *  - every stored passage of the `ally_guide_library` corpus → **Ally Guide Library**;
 *  - every stored passage of the `debrief_knowledge` corpus → **Debrief Guidance**.
 *
 * A migration rather than an admin job (phase 4's character import was a job) because everything
 * an import needs is already in Postgres: the passage text in `kb_document_chunks`, the title,
 * owner, tags and clinical flag on `kb_documents`, the targeted organisations in
 * `kb_document_tenants`. Nothing is distilled, so nothing calls a model. Enrichment — retrieval
 * metadata alongside the text, and a one-line statement in place of the citation heading written
 * here — is a separate, admin-triggered step, because it does call one.
 *
 * **This migration only copies.** It reads the old rows and never changes them; the old
 * documents, files and Weaviate collections are deleted by a confirmed platform-admin action that
 * is refused until every passage has a copy. Idempotent: each copy carries
 * `sync_key = 'kb_document_chunks:<passage id>'` (and reuses the passage id as its own), so a
 * re-run copies only what is missing.
 *
 * What is copied, per passage of a document that was being served (not archived, indexed):
 *  - `body` = the passage exactly as stored — never trimmed, merged or rewritten;
 *  - `citation` = document title (an author's name after a trailing "by" is dropped: the library
 *    keeps no names), section and pages;
 *  - audience and owner exactly: `is_global`, the targeted organisations as `tenant_ids` (for an
 *    organisation's own library document that is the organisation itself), `owner_tenant_id`;
 *  - the document's `needs_clinical_sign_off` as the `clinical` attribute, information only;
 *  - the document's tags as topics (and, for the guide, as its `topic` facet). The guide's `kind`
 *    follows the owner (an organisation's own documents were its protocols); Debrief's `kind` and
 *    `level` are set only where a tag names one, and enrichment fills the rest.
 *
 * Status: `active`, with `embedding_status = 'pending'` so the outbox indexes it — except a
 * clinical Debrief document whose current text was never signed off. Retrieval refused those, so
 * they arrive `archived` (and `skipped`): copied, visible in the Library with their clinical flag,
 * and one Restore away, but not suddenly served to learners because the gate was retired.
 *
 * Self-contained SQL and string handling, no application imports, so it keeps meaning what it
 * meant when it ran. The string helpers live in `./context-library-passages.helpers`: TypeORM
 * calls `new` on every function a migration file exports, so an exported arrow function here
 * crashes `migration:run` before any migration loads.
 */
interface CorpusCopy {
  corpus: 'ally_guide_library' | 'debrief_knowledge';
  collectionId: 'ally_guide_library' | 'debrief_guidance';
}

const COPIES: CorpusCopy[] = [
  { corpus: 'ally_guide_library', collectionId: 'ally_guide_library' },
  { corpus: 'debrief_knowledge', collectionId: 'debrief_guidance' },
];

interface DocumentRow {
  id: string;
  title: string;
  tags: string[] | null;
  is_global: boolean;
  owner_tenant_id: string | null;
  chunk_version: number;
  clinical: boolean;
  signed_current: boolean;
  created_by: number | null;
}

interface PassageRow {
  id: string;
  text: string;
  page_from: number;
  page_to: number;
  section_path: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class CopyGuideAndDebriefPassagesIntoContextLibrary1981000800000 implements MigrationInterface {
  name = 'CopyGuideAndDebriefPassagesIntoContextLibrary1981000800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('kb_documents'))) return;
    // Read the sign-off columns only while they exist; the migration after this one drops them.
    const hasSignOff = await queryRunner.hasColumn(
      'kb_documents',
      'needs_clinical_sign_off',
    );

    const existing = new Set<string>(
      (
        (await queryRunner.query(
          `SELECT "sync_key" FROM "cl_chunks" WHERE "sync_key" LIKE $1`,
          [`${PASSAGE_SYNC_PREFIX}%`],
        )) as Array<{ sync_key: string }>
      ).map((r) => r.sync_key),
    );

    for (const copy of COPIES) {
      const documents: DocumentRow[] = await queryRunner.query(
        `SELECT d."id", d."title", d."tags", d."is_global", d."owner_tenant_id",
                d."chunk_version", d."created_by",
                ${hasSignOff ? 'd."needs_clinical_sign_off"' : 'false'} AS "clinical",
                ${hasSignOff ? 'COALESCE(d."clinical_signed_off_hash" = d."content_hash", false)' : 'true'} AS "signed_current"
           FROM "kb_documents" d
          WHERE d."corpus" = $1 AND d."archived_at" IS NULL AND d."status" = 'indexed'
          ORDER BY d."createdAt" ASC, d."id" ASC`,
        [copy.corpus],
      );
      if (!documents.length) continue;

      const targeted: Array<{ document_id: string; tenant_id: string }> =
        await queryRunner.query(
          `SELECT "document_id", "tenant_id" FROM "kb_document_tenants"
            WHERE "deletedAt" IS NULL AND "document_id" = ANY($1::uuid[])
            ORDER BY "tenant_id" ASC`,
          [documents.map((d) => d.id)],
        );
      const tenantsOf = new Map<string, string[]>();
      for (const row of targeted) {
        tenantsOf.set(row.document_id, [
          ...(tenantsOf.get(row.document_id) ?? []),
          String(row.tenant_id),
        ]);
      }

      for (const doc of documents) {
        const passages: PassageRow[] = await queryRunner.query(
          `SELECT "id", "text", "page_from", "page_to", "section_path", "createdAt", "updatedAt"
             FROM "kb_document_chunks"
            WHERE "document_id" = $1 AND "chunk_version" = $2
            ORDER BY "chunk_index" ASC`,
          [doc.id, doc.chunk_version],
        );
        const title = withoutByline(doc.title) || 'Untitled';
        const tags = [
          ...new Set((doc.tags ?? []).map(tagOf).filter(Boolean)),
        ].slice(0, 8);
        const facets: Record<string, string | string[]> = {};
        if (copy.collectionId === 'ally_guide_library') {
          facets.kind = doc.owner_tenant_id ? 'protocol' : 'material';
          if (tags.length) facets.topic = tags;
        } else {
          const snake = tags.map((t) => t.replace(/-/g, '_'));
          const kind = snake.find((t) => DEBRIEF_KINDS.includes(t));
          if (kind) facets.kind = kind;
          const levels = snake.filter((t) => DEBRIEF_LEVELS.includes(t));
          if (levels.length) facets.level = levels;
        }
        const clinical = Boolean(doc.clinical);
        // A clinical document whose current text was never signed off was not being served.
        const held = clinical && !doc.signed_current;
        const status = held ? 'archived' : 'active';
        const isGlobal = Boolean(doc.is_global);
        const tenantIds = isGlobal ? [] : (tenantsOf.get(doc.id) ?? []);

        for (const passage of passages) {
          const syncKey = `${PASSAGE_SYNC_PREFIX}${passage.id}`;
          if (existing.has(syncKey)) continue;
          const body = passage.text ?? '';
          if (!body.trim()) continue;
          const allocated = await queryRunner.query(
            `UPDATE "cl_collections" SET "next_code" = "next_code" + 1, "updatedAt" = now()
              WHERE "id" = $1 RETURNING "code_prefix", "next_code" - 1 AS n`,
            [copy.collectionId],
          );
          // node-postgres returns [rows, count] for an UPDATE … RETURNING through TypeORM.
          const result = Array.isArray(allocated?.[0])
            ? allocated[0][0]
            : allocated?.[0];
          if (!result) {
            throw new Error(
              `Collection ${copy.collectionId} is missing; run 1981000700000 first.`,
            );
          }
          const code = `${result.code_prefix}-${String(result.n).padStart(4, '0')}`;
          const pageFrom = Number(passage.page_from ?? 0);
          const pageTo = Number(passage.page_to ?? 0);
          const citation = {
            title,
            sectionPath: passage.section_path?.trim() || null,
            ...(pageFrom > 0 ? { pageFrom } : {}),
            ...(pageFrom > 0 && pageTo > pageFrom ? { pageTo } : {}),
          };
          await queryRunner.query(
            `INSERT INTO "cl_chunks" (
               "id", "collection_id", "code", "origin", "statement", "body", "topics", "facets",
               "attributes", "citation", "is_global", "tenant_ids", "owner_tenant_id", "status",
               "quality", "sync_key", "embedding_status", "created_by", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, 'imported', $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11,
                     $12, $13, $14::jsonb, $15, $16, $17, $18, $19)
             ON CONFLICT DO NOTHING`,
            [
              passage.id,
              copy.collectionId,
              code,
              headingFor(title, citation.sectionPath, body),
              body,
              tags,
              JSON.stringify(facets),
              JSON.stringify({ clinical }),
              JSON.stringify(citation),
              isGlobal,
              tenantIds,
              doc.owner_tenant_id ?? null,
              status,
              JSON.stringify({
                migratedFrom: copy.corpus,
                documentId: doc.id,
                statementFrom: 'citation',
                enrichment: 'pending',
                ...(held ? { importedAs: 'clinical_sign_off_pending' } : {}),
              }),
              syncKey,
              status === 'active' ? 'pending' : 'skipped',
              doc.created_by ?? null,
              passage.createdAt,
              passage.updatedAt,
            ],
          );
          existing.add(syncKey);
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only what this migration copied (usage events, judgments and versions cascade). The old
    // corpora still hold every passage until a platform admin retires them.
    await queryRunner.query(
      `DELETE FROM "cl_chunks"
        WHERE "sync_key" LIKE $1 AND "collection_id" = ANY($2::text[])`,
      [`${PASSAGE_SYNC_PREFIX}%`, COPIES.map((c) => c.collectionId)],
    );
  }
}
