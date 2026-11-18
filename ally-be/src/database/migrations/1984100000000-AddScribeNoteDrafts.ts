import { MigrationInterface, QueryRunner } from 'typeorm';

/** Scribe v2: one row per note-harness run (shadow comparison). */
export class AddScribeNoteDrafts1984100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "scribe_note_drafts" (
        "id" SERIAL NOT NULL,
        "tenant_id" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "chatId" integer NOT NULL,
        "shadow" boolean NOT NULL DEFAULT true,
        "mode" character varying(20),
        "path" character varying(20),
        "segments" integer NOT NULL DEFAULT 0,
        "llmCalls" integer NOT NULL DEFAULT 0,
        "repaired" boolean NOT NULL DEFAULT false,
        "durationMs" integer,
        "transcriptMinutes" real,
        "transcriptWords" integer,
        "narrativeWordsTarget" integer,
        "narrativeWords" integer,
        "narrativePoints" integer,
        "fieldsFilled" integer,
        "budget" jsonb,
        "validation" jsonb,
        "draft" jsonb,
        "transcriptSource" character varying(20),
        "transcript" jsonb,
        "error" text,
        "correlationId" character varying,
        CONSTRAINT "PK_scribe_note_drafts" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_scribe_note_drafts_chatId" ON "scribe_note_drafts" ("chatId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_scribe_note_drafts_created" ON "scribe_note_drafts" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_scribe_note_drafts_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_scribe_note_drafts_chatId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "scribe_note_drafts"`);
  }
}
