import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Assistants stage 9 — safety pack releases.
 *
 * - `safety_pack_releases`: every version of a pack's content, with its suite results and who
 *   created, released or rolled it back. Status draft → testing → released, or rolled_back.
 * - `safety_pack_current`: one row per pack pointing at the release in use. The engine reads the
 *   pointer's release; with no row it falls back to the code constant. The code constants are
 *   seeded as each pack's first release by `SafetyPackReleaseService` on boot (idempotent), so
 *   behaviour is unchanged by this migration.
 * - `manage:safety-packs`: the curator permission, granted to SUPER_DUPER_ADMIN only (like the
 *   WhatsApp Q&A corpus: a change reaches every chatbot). Further curators are granted by hand.
 * - `usage_events.kind` admits `pack_suite` (the suite on a draft release, Ally's cost), keeping
 *   every existing kind including `template_index`.
 *
 * Additive only (expand-contract safe). The CHECK widen keeps every value the old one allowed.
 */
const GROUPS = ['SUPER_DUPER_ADMIN'];
const PERMISSIONS = ['manage:safety-packs'];

const KINDS_BEFORE = [
  'customer_reply',
  'crisis_check',
  'memory_check',
  'summary',
  'setup',
  'site_reading',
  'indexing',
  'checkup',
  'judge',
  'change_by_chat',
  'try_it',
  'instructions',
  'whatsapp',
  'other',
  'template_index',
];

const kindCheck = (kinds: string[]) =>
  `ALTER TABLE "usage_events" ADD CONSTRAINT "CHK_usage_events_kind" CHECK ("kind" IN (${kinds
    .map((k) => `'${k}'`)
    .join(',')}))`;

export class CreateSafetyPackReleases1987500000000 implements MigrationInterface {
  name = 'CreateSafetyPackReleases1987500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "safety_pack_releases" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "pack_id" character varying(32) NOT NULL,
        "version" integer NOT NULL,
        "content" jsonb NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'draft',
        "test_results" jsonb,
        "previous_release_id" uuid,
        "note" text,
        "created_by" integer,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "released_at" TIMESTAMPTZ,
        "released_by" integer,
        "rolled_back_at" TIMESTAMPTZ,
        "rolled_back_by" integer,
        "notices_queued_at" TIMESTAMPTZ,
        CONSTRAINT "PK_safety_pack_releases_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_safety_pack_releases_pack_version" UNIQUE ("pack_id", "version"),
        CONSTRAINT "CHK_safety_pack_releases_status"
          CHECK ("status" IN ('draft', 'testing', 'released', 'rolled_back')),
        CONSTRAINT "CHK_safety_pack_releases_version" CHECK ("version" > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_safety_pack_releases_pack_created"
         ON "safety_pack_releases" ("pack_id", "created_at")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "safety_pack_current" (
        "pack_id" character varying(32) NOT NULL,
        "release_id" uuid NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_by" integer,
        CONSTRAINT "PK_safety_pack_current_pack" PRIMARY KEY ("pack_id"),
        CONSTRAINT "FK_safety_pack_current_release" FOREIGN KEY ("release_id")
          REFERENCES "safety_pack_releases"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(
      `ALTER TABLE "usage_events" DROP CONSTRAINT IF EXISTS "CHK_usage_events_kind"`,
    );
    // Written out in full: `check-constraints-cover-enums.spec.ts` reads this SQL as text.
    await queryRunner.query(`
      ALTER TABLE "usage_events" ADD CONSTRAINT "CHK_usage_events_kind" CHECK ("kind" IN ('customer_reply','crisis_check','memory_check','summary','setup','site_reading','indexing','checkup','judge','change_by_chat','try_it','instructions','whatsapp','other','template_index','pack_suite'))
    `);

    for (const name of PERMISSIONS) {
      const existing = await queryRunner.query(
        `SELECT id FROM "permissions" WHERE name = $1`,
        [name],
      );
      if (existing.length === 0) {
        await queryRunner.query(
          `INSERT INTO "permissions" (name) VALUES ($1)`,
          [name],
        );
      }
    }
    for (const groupName of GROUPS) {
      const group = await queryRunner.query(
        `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
        [groupName],
      );
      const groupId = group?.[0]?.id;
      // A group that does not exist in this environment is skipped.
      if (!groupId) continue;
      for (const name of PERMISSIONS) {
        const perm = await queryRunner.query(
          `SELECT id FROM "permissions" WHERE name = $1 LIMIT 1`,
          [name],
        );
        const permId = perm?.[0]?.id;
        if (!permId) continue;
        const grant = await queryRunner.query(
          `SELECT id FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
          [groupId, permId],
        );
        if (grant.length === 0) {
          await queryRunner.query(
            `INSERT INTO group_permissions ("groupId", "permissionId") VALUES ($1, $2)`,
            [groupId, permId],
          );
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of PERMISSIONS) {
      await queryRunner.query(
        `DELETE FROM group_permissions
           WHERE "permissionId" = (SELECT id FROM "permissions" WHERE name = $1)`,
        [name],
      );
      await queryRunner.query(`DELETE FROM "permissions" WHERE name = $1`, [
        name,
      ]);
    }
    await queryRunner.query(
      `DELETE FROM "usage_events" WHERE "kind" = 'pack_suite'`,
    );
    await queryRunner.query(
      `ALTER TABLE "usage_events" DROP CONSTRAINT IF EXISTS "CHK_usage_events_kind"`,
    );
    await queryRunner.query(kindCheck(KINDS_BEFORE));
    await queryRunner.query(`DROP TABLE IF EXISTS "safety_pack_current"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "safety_pack_releases"`);
  }
}
