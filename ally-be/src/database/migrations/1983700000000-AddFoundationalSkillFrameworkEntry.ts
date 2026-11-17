import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Debrief's skill framework is ordinary Context Library content, not code: the Debrief reads
 * every active Debrief Guidance entry of kind `skill_framework` that the learner's organisation
 * can read. This adds the one global entry it has always assessed, the 14 foundational helping
 * skills and the three chart areas, so a debrief keeps assessing them. After this the entry is
 * the library's: edit or delete it there, no deploy, and nothing recreates it.
 *
 * Idempotent: skipped when the entry is already there (same sync key, or an active
 * `skill_framework` entry with the same statement). Self-contained SQL, no application imports,
 * so it keeps meaning what it meant when it ran. `embedding_status = 'pending'` lets the outbox
 * index it like any new entry.
 */
const STATEMENT = 'Foundational helping skills';
const SYNC_KEY = 'debrief_skill_framework:foundational';

const SKILLS = [
  'verbal | Verbal communication',
  'confidentiality | Explain and promote confidentiality',
  'rapport | Rapport-building and self-disclosure',
  'feelings | Exploration and normalisation of feelings',
  'empathy | Empathy, warmth and genuineness',
  'harm | Assessment of harm and developing a response plan',
  'functioning | Connect to social functioning and impact on life',
  "explanation | Explore the client's explanation for the problem",
  'family | Involvement of family and significant others',
  'goals | Collaborative goal-setting',
  'hope | Promote realistic hope for change',
  'coping | Incorporate coping mechanisms and prior solutions',
  'psychoeducation | Psychoeducation with local terminology',
  'feedback | Elicitation of feedback',
];

const AREAS = [
  'Listening Engagement | listening and engaging with what the character said',
  "Emotional Attunement | recognising and responding to the character's emotions",
  'Supportive Engagement | offering support and a safe, non-judgmental space',
];

export class AddFoundationalSkillFrameworkEntry1983700000000 implements MigrationInterface {
  name = 'AddFoundationalSkillFrameworkEntry1983700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('cl_chunks'))) return;
    const have = (await queryRunner.query(
      `SELECT 1 FROM "cl_chunks"
        WHERE "collection_id" = 'debrief_guidance'
          AND ("sync_key" = $1
               OR ("statement" = $2 AND "facets"->>'kind' = 'skill_framework'
                   AND "status" = 'active'))
        LIMIT 1`,
      [SYNC_KEY, STATEMENT],
    )) as unknown[];
    if (have.length) return;

    const allocated = await queryRunner.query(
      `UPDATE "cl_collections" SET "next_code" = "next_code" + 1, "updatedAt" = now()
        WHERE "id" = 'debrief_guidance' RETURNING "code_prefix", "next_code" - 1 AS n`,
    );
    // node-postgres returns [rows, count] for an UPDATE … RETURNING through TypeORM.
    const row = Array.isArray(allocated?.[0])
      ? allocated[0][0]
      : allocated?.[0];
    if (!row) return; // the Debrief Guidance collection is not there; nothing to add to
    const code = `${row.code_prefix}-${String(row.n).padStart(4, '0')}`;

    await queryRunner.query(
      `INSERT INTO "cl_chunks" (
         "collection_id", "code", "origin", "statement", "body", "keywords", "facets",
         "attributes", "is_global", "tenant_ids", "status", "sync_key", "embedding_status")
       VALUES ('debrief_guidance', $1, 'authored', $2, $3, $4, $5::jsonb, $6::jsonb, true,
               '{}', 'active', $7, 'pending')`,
      [
        code,
        STATEMENT,
        'The 14 foundational helping skills the Debrief has always assessed. One line per skill: key | name.',
        ['skill framework', 'foundational helping skills'],
        JSON.stringify({ kind: 'skill_framework' }),
        JSON.stringify({ skills: SKILLS, areas: AREAS, foundational: true }),
        SYNC_KEY,
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "cl_chunks" WHERE "collection_id" = 'debrief_guidance' AND "sync_key" = $1`,
      [SYNC_KEY],
    );
  }
}
