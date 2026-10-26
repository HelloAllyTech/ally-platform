import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Skills Store: the prompt store becomes the single source of truth.
 *
 * 1. A version describes everything that ran: model settings, a content hash
 *    and where it came from move onto `prompts_versions`. `publishedAt` marks
 *    versions that have been live; a version newer than `currentVersion` that
 *    was never published is a candidate.
 * 2. `prompts.contract` holds the code's contract for the prompt (variables it
 *    supplies, required ones, contract version), written by sync from the
 *    `.meta.json` sidecars.
 * 3. Translations are kept per English body (`sourceHash`), so a candidate can
 *    be translated before it goes live without disturbing the live rows.
 * 4. `useDashboardOverride` is retired. Every row whose body was served from its
 *    file gets that file text (`defaultPrompt`) published as a new version — as
 *    does an overridden row with no live text, which fell back to
 *    `defaultPrompt` too — then
 *    every row is marked overridden, so any reader still checking the flag
 *    already behaves as "serve the store".
 * 5. `skills_store_keys`: keys generated in the Skills Store for the `prompts`
 *    CLI, stored hashed.
 *
 * Idempotent: every DDL uses IF [NOT] EXISTS and the publish step only touches
 * rows whose live body still differs from their file text.
 */
export class SkillsStoreVersioning1980200000000 implements MigrationInterface {
  name = 'SkillsStoreVersioning1980200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "prompts_versions"
        ADD COLUMN IF NOT EXISTS "provider" varchar NULL,
        ADD COLUMN IF NOT EXISTS "model" varchar NULL,
        ADD COLUMN IF NOT EXISTS "temperature" numeric NULL,
        ADD COLUMN IF NOT EXISTS "contentHash" varchar(64) NULL,
        ADD COLUMN IF NOT EXISTS "source" varchar(30) NULL,
        ADD COLUMN IF NOT EXISTS "note" text NULL,
        ADD COLUMN IF NOT EXISTS "evalSummary" jsonb NULL,
        ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "prompts"
        ADD COLUMN IF NOT EXISTS "contract" jsonb NULL
    `);

    // Every version that is or was live today: the live one carries the row's
    // model settings; older ones are history and were published once.
    await queryRunner.query(`
      UPDATE "prompts_versions" pv
         SET "provider" = p."provider",
             "model" = p."model",
             "temperature" = p."temperature"
        FROM "prompts" p
       WHERE pv."promptId" = p.id
         AND pv."version" = p."currentVersion"
         AND pv."provider" IS NULL AND pv."model" IS NULL AND pv."temperature" IS NULL
    `);
    await queryRunner.query(`
      UPDATE "prompts_versions" pv
         SET "publishedAt" = pv."createdAt"
        FROM "prompts" p
       WHERE pv."promptId" = p.id
         AND pv."version" <= COALESCE(p."currentVersion", 0)
         AND pv."publishedAt" IS NULL
    `);

    // Retire the override flag: publish the file text for every row that was
    // serving it. Skipped when the live version already holds that text.
    // An overridden row whose live version is missing or blank was serving
    // `defaultPrompt` as well, and sync is about to replace that column with
    // the new Git default, so it is published too.
    // The version each row gets is the one inserted here: put it live in the
    // same statement, so a row whose pointer dangled (a currentVersion beyond
    // its last version) is repaired too, and a re-run touches nothing.
    await queryRunner.query(`
      WITH published AS (
        INSERT INTO "prompts_versions"
          ("promptId", "version", "prompt", "createdBy", "updatedBy",
           "provider", "model", "temperature", "source", "note", "publishedAt")
        SELECT p.id,
               COALESCE((SELECT MAX(v."version") FROM "prompts_versions" v WHERE v."promptId" = p.id), 0) + 1,
               p."defaultPrompt", 0, 0,
               p."provider", p."model", p."temperature",
               'migration',
               'Published the file text that was serving before the Skills Store became the source of truth.',
               NOW()
          FROM "prompts" p
          LEFT JOIN "prompts_versions" live
            ON live."promptId" = p.id AND live."version" = p."currentVersion"
         WHERE p."defaultPrompt" IS NOT NULL
           AND btrim(p."defaultPrompt") <> ''
           AND (
             (p."useDashboardOverride" = false
               AND (live.id IS NULL OR btrim(live."prompt") <> btrim(p."defaultPrompt")))
             OR
             (p."useDashboardOverride" = true
               AND (live.id IS NULL OR btrim(COALESCE(live."prompt", '')) = ''))
           )
        RETURNING "promptId", "version"
      )
      UPDATE "prompts" p
         SET "currentVersion" = published."version"
        FROM published
       WHERE p.id = published."promptId"
    `);
    await queryRunner.query(
      `UPDATE "prompts" SET "useDashboardOverride" = true WHERE "useDashboardOverride" = false`,
    );
    await queryRunner.query(
      `ALTER TABLE "prompts" ALTER COLUMN "useDashboardOverride" SET DEFAULT true`,
    );

    // Hash every body (sha256 of the trimmed text, as the app computes it).
    await queryRunner.query(`
      UPDATE "prompts_versions"
         SET "contentHash" = encode(sha256(convert_to(btrim("prompt", E' \\t\\n\\r'), 'UTF8')), 'hex')
       WHERE "contentHash" IS NULL
    `);

    // Translations: one row per (prompt, language, English body).
    // The old key was created as a table constraint in some environments and a
    // bare unique index in others; drop whichever exists.
    await queryRunner.query(
      `ALTER TABLE "prompt_translations" DROP CONSTRAINT IF EXISTS "uq_prompt_translations_prompt_language"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_prompt_translations_prompt_language"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_prompt_translations_prompt_language_source"
        ON "prompt_translations" ("promptId", "languageId", "sourceHash")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_prompt_translations_prompt_language"
        ON "prompt_translations" ("promptId", "languageId")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "skills_store_keys" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(120) NOT NULL,
        "prefix" varchar(16) NOT NULL,
        "keyHash" varchar(64) NOT NULL,
        "scopes" jsonb NOT NULL DEFAULT '["pull"]',
        "createdBy" integer NULL,
        "revokedAt" TIMESTAMP NULL,
        "revokedBy" integer NULL,
        "lastUsedAt" TIMESTAMP NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_skills_store_keys_hash"
        ON "skills_store_keys" ("keyHash")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "skills_store_keys"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_prompt_translations_prompt_language"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_prompt_translations_prompt_language_source"`,
    );
    // Keep only the newest row per (prompt, language) before restoring the
    // one-row-per-language key.
    await queryRunner.query(`
      DELETE FROM "prompt_translations" pt
       USING "prompt_translations" newer
       WHERE pt."promptId" = newer."promptId"
         AND pt."languageId" = newer."languageId"
         AND pt."updatedAt" < newer."updatedAt"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_prompt_translations_prompt_language"
        ON "prompt_translations" ("promptId", "languageId")
    `);
    await queryRunner.query(
      `ALTER TABLE "prompts" ALTER COLUMN "useDashboardOverride" SET DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "prompts" DROP COLUMN IF EXISTS "contract"`,
    );
    await queryRunner.query(`
      ALTER TABLE "prompts_versions"
        DROP COLUMN IF EXISTS "provider",
        DROP COLUMN IF EXISTS "model",
        DROP COLUMN IF EXISTS "temperature",
        DROP COLUMN IF EXISTS "contentHash",
        DROP COLUMN IF EXISTS "source",
        DROP COLUMN IF EXISTS "note",
        DROP COLUMN IF EXISTS "evalSummary",
        DROP COLUMN IF EXISTS "publishedAt"
    `);
  }
}
