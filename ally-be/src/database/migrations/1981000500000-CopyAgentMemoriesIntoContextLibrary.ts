import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Context Library, phase 5 (docs/context-library/PLAN.md §6.5): copy the two agent memories into
 * their collections as `agent` chunks.
 *
 *  - `agent_memories` with agent `bug_hunter` → **Bug Hunter Notes**;
 *  - `builder_lessons`, and `agent_memories` with agent `builder` → **Builder Lessons**.
 *
 * **This migration only copies.** The source tables are dropped by a separate, later migration,
 * so a failed or partial copy never costs a lesson. It is idempotent: every copied chunk carries
 * `sync_key = '<table>:<row id>'` and a row whose key already exists is skipped, so re-running it
 * (or running it after someone added rows by hand) copies only what is missing.
 *
 * What is preserved:
 *  - the row id (the chunk's id IS the old row's id), so a run in flight that reports feedback on
 *    an id it was shown before the deploy still lands on the right chunk;
 *  - status (`candidate` → candidate, `active` → active, `merged` → superseded with
 *    `superseded_by_id` pointing at the chunk it was merged into, `retired` → archived, with the
 *    old retirement reason kept in `quality`);
 *  - pins, tags, repos and Builder's category (as facets), provenance (`sessionIds`, `runIds`,
 *    `findingIds` attributes), `source_count`, author and timestamps;
 *  - `times_applied` / `times_contradicted`, both as the chunk's counters and as usage history —
 *    one `agent_applied` / `agent_contradicted` event each, `detail.migrated` naming the table —
 *    so effectiveness and retirement read the evidence the old tables held.
 *
 * Text longer than a collection's 600-character statement is kept whole in `body`, with a clipped
 * statement. Active chunks are copied with `embedding_status = 'pending'`, so the outbox indexes
 * them into `Ctx<Collection>_v1` (and fills their `text_hash`); every other status is `skipped`,
 * because only active chunks are ever indexed.
 *
 * Codes are allocated from `cl_collections.next_code` exactly as the engine does. Self-contained
 * SQL and string handling, no application imports, so it keeps meaning what it meant when it ran.
 */
const STATEMENT_MAX = 600;

const STATUS: Record<string, string> = {
  candidate: 'candidate',
  active: 'active',
  merged: 'superseded',
  retired: 'archived',
};

const labels = (value: unknown): string[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value
            .map((v) =>
              String(v ?? '')
                .trim()
                .toLowerCase(),
            )
            .filter((v) => v.length > 0 && v.length <= 80),
        ),
      ]
    : [];

const split = (text: string): { statement: string; body: string | null } => {
  const flat = String(text ?? '').trim();
  if (flat.length <= STATEMENT_MAX) return { statement: flat, body: null };
  const cut = flat.slice(0, STATEMENT_MAX - 1);
  const atWord = cut.lastIndexOf(' ');
  return {
    statement: `${(atWord > STATEMENT_MAX * 0.6 ? cut.slice(0, atWord) : cut).trimEnd()}…`,
    body: flat,
  };
};

interface CopyRow {
  id: string;
  syncKey: string;
  collectionId: 'bug_hunter_notes' | 'builder_lessons';
  agent: 'bug_hunter' | 'builder';
  useCase: 'bug_hunter' | 'builder_build';
  text: string;
  status: string;
  pinned: boolean;
  sourceCount: number;
  timesApplied: number;
  timesContradicted: number;
  facets: Record<string, string | string[]>;
  attributes: Record<string, string[]>;
  quality: Record<string, unknown>;
  createdBy: number | null;
  lastAppliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class CopyAgentMemoriesIntoContextLibrary1981000500000 implements MigrationInterface {
  name = 'CopyAgentMemoriesIntoContextLibrary1981000500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: CopyRow[] = [];

    if (await queryRunner.hasTable('agent_memories')) {
      const memories: any[] = await queryRunner.query(
        `SELECT * FROM "agent_memories" ORDER BY "createdAt" ASC, "id" ASC`,
      );
      for (const m of memories) {
        const bugHunter = m.agent === 'bug_hunter';
        const facets: Record<string, string | string[]> = {
          repos: labels(m.repos),
          tags: labels(m.tags),
        };
        const attributes: Record<string, string[]> = {};
        if (bugHunter) {
          if (m.run_id) attributes.runIds = [String(m.run_id)];
          if (m.finding_id) attributes.findingIds = [String(m.finding_id)];
        }
        rows.push({
          id: m.id,
          syncKey: `agent_memories:${m.id}`,
          collectionId: bugHunter ? 'bug_hunter_notes' : 'builder_lessons',
          agent: bugHunter ? 'bug_hunter' : 'builder',
          useCase: bugHunter ? 'bug_hunter' : 'builder_build',
          text: m.body,
          status: STATUS[m.status] ?? 'archived',
          pinned: Boolean(m.pinned),
          sourceCount: Number(m.source_count ?? 1),
          timesApplied: Number(m.times_applied ?? 0),
          timesContradicted: Number(m.times_contradicted ?? 0),
          facets,
          attributes,
          quality: {
            migratedFrom: 'agent_memories',
            ...(m.retired_reason ? { retiredReason: m.retired_reason } : {}),
            ...(m.retired_at ? { retiredAt: m.retired_at } : {}),
            ...(m.retired_by ? { retiredBy: m.retired_by } : {}),
          },
          createdBy: m.created_by ?? null,
          lastAppliedAt: m.last_applied_at ?? null,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
        });
      }
    }

    if (await queryRunner.hasTable('builder_lessons')) {
      const lessons: any[] = await queryRunner.query(
        `SELECT * FROM "builder_lessons" ORDER BY "createdAt" ASC, "id" ASC`,
      );
      for (const l of lessons) {
        const repos = labels(l.repos).length
          ? labels(l.repos)
          : labels(l.repo ? [l.repo] : []);
        const facets: Record<string, string | string[]> = { repos };
        if (l.category) facets.category = String(l.category);
        const tags = labels(l.tags);
        if (tags.length) facets.tags = tags;
        const sessions = [
          ...new Set(
            [
              ...(Array.isArray(l.sourceSessionIds) ? l.sourceSessionIds : []),
              ...(l.sessionId ? [l.sessionId] : []),
            ]
              .map((s) => String(s ?? '').trim())
              .filter(Boolean),
          ),
        ];
        rows.push({
          id: l.id,
          syncKey: `builder_lessons:${l.id}`,
          collectionId: 'builder_lessons',
          agent: 'builder',
          useCase: 'builder_build',
          text: l.lesson,
          status: STATUS[l.status] ?? 'archived',
          pinned: Boolean(l.pinned),
          sourceCount: Number(l.sourceCount ?? 1),
          timesApplied: Number(l.timesApplied ?? 0),
          timesContradicted: Number(l.timesContradicted ?? 0),
          facets,
          attributes: sessions.length ? { sessionIds: sessions } : {},
          quality: { migratedFrom: 'builder_lessons' },
          createdBy: l.createdBy ?? null,
          lastAppliedAt: l.lastAppliedAt ?? null,
          createdAt: l.createdAt,
          updatedAt: l.updatedAt,
        });
      }
    }

    if (!rows.length) return;

    const existing = new Set<string>(
      (
        (await queryRunner.query(
          `SELECT "sync_key" FROM "cl_chunks"
            WHERE "sync_key" LIKE 'agent_memories:%' OR "sync_key" LIKE 'builder_lessons:%'`,
        )) as Array<{ sync_key: string }>
      ).map((r) => r.sync_key),
    );

    for (const row of rows) {
      if (existing.has(row.syncKey) || !String(row.text ?? '').trim()) continue;
      const allocated = await queryRunner.query(
        `UPDATE "cl_collections" SET "next_code" = "next_code" + 1, "updatedAt" = now()
          WHERE "id" = $1 RETURNING "code_prefix", "next_code" - 1 AS n`,
        [row.collectionId],
      );
      // node-postgres returns [rows, count] for an UPDATE … RETURNING through TypeORM.
      const result = Array.isArray(allocated?.[0])
        ? allocated[0][0]
        : allocated?.[0];
      if (!result) {
        throw new Error(
          `Collection ${row.collectionId} is missing; run 1981000400000 first.`,
        );
      }
      const code = `${result.code_prefix}-${String(result.n).padStart(4, '0')}`;
      const { statement, body } = split(row.text);
      const inserted = await queryRunner.query(
        `INSERT INTO "cl_chunks" (
           "id", "collection_id", "code", "origin", "statement", "body", "facets", "attributes",
           "is_global", "tenant_ids", "pinned", "status", "quality", "source_count", "sync_key",
           "agent", "embedding_status", "times_applied", "times_contradicted", "last_applied_at",
           "created_by", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'agent', $4, $5, $6::jsonb, $7::jsonb, true, '{}', $8, $9, $10::jsonb,
                 $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
         ON CONFLICT DO NOTHING
         RETURNING "id"`,
        [
          row.id,
          row.collectionId,
          code,
          statement,
          body,
          JSON.stringify(row.facets),
          JSON.stringify(row.attributes),
          row.pinned,
          row.status,
          JSON.stringify(row.quality),
          Math.max(1, row.sourceCount),
          row.syncKey,
          row.agent,
          row.status === 'active' ? 'pending' : 'skipped',
          row.timesApplied,
          row.timesContradicted,
          row.lastAppliedAt,
          row.createdBy,
          row.createdAt,
          row.updatedAt,
        ],
      );
      if (!inserted?.length) continue;

      // The counters become usage history, one event per recorded use.
      for (const [type, count, at] of [
        ['agent_applied', row.timesApplied, row.lastAppliedAt ?? row.updatedAt],
        ['agent_contradicted', row.timesContradicted, row.updatedAt],
      ] as Array<[string, number, Date]>) {
        if (count <= 0) continue;
        await queryRunner.query(
          `INSERT INTO "cl_usage_events" ("chunk_id", "collection_id", "use_case", "type", "detail", "createdAt", "updatedAt")
           SELECT $1, $2, $3, $4, $5::jsonb, $6, $6 FROM generate_series(1, $7)`,
          [
            row.id,
            row.collectionId,
            row.useCase,
            type,
            JSON.stringify({ migrated: row.syncKey.split(':')[0] }),
            at,
            Math.min(count, 1000),
          ],
        );
      }
    }

    // Merged rows point at the chunk they were folded into, when it was copied too.
    if (await queryRunner.hasTable('agent_memories')) {
      await queryRunner.query(
        `UPDATE "cl_chunks" c SET "superseded_by_id" = a."merged_into_id"
           FROM "agent_memories" a
          WHERE c."sync_key" = 'agent_memories:' || a."id"
            AND a."merged_into_id" IS NOT NULL AND c."superseded_by_id" IS NULL
            AND EXISTS (SELECT 1 FROM "cl_chunks" t WHERE t."id" = a."merged_into_id")`,
      );
    }
    if (await queryRunner.hasTable('builder_lessons')) {
      await queryRunner.query(
        `UPDATE "cl_chunks" c SET "superseded_by_id" = l."mergedIntoId"
           FROM "builder_lessons" l
          WHERE c."sync_key" = 'builder_lessons:' || l."id"
            AND l."mergedIntoId" IS NOT NULL AND c."superseded_by_id" IS NULL
            AND EXISTS (SELECT 1 FROM "cl_chunks" t WHERE t."id" = l."mergedIntoId")`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only what this migration copied. Usage events, versions and loop actions on these chunks
    // cascade or are left as history; the source tables still hold every row until the next
    // migration drops them.
    await queryRunner.query(
      `DELETE FROM "cl_usage_events" WHERE "chunk_id" IN (
         SELECT "id" FROM "cl_chunks"
          WHERE "sync_key" LIKE 'agent_memories:%' OR "sync_key" LIKE 'builder_lessons:%')`,
    );
    await queryRunner.query(
      `DELETE FROM "cl_chunks"
        WHERE "sync_key" LIKE 'agent_memories:%' OR "sync_key" LIKE 'builder_lessons:%'`,
    );
  }
}
