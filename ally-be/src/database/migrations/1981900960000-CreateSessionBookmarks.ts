import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Learners can save a roleplay session to come back to (`session_bookmarks`),
 * with an optional note. One bookmark per learner per session. `sessionId` is
 * `scenario_sessions.id` with no foreign key, so deleting a session leaves the
 * bookmark list readable.
 */
export class CreateSessionBookmarks1981900960000 implements MigrationInterface {
  name = 'CreateSessionBookmarks1981900960000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "session_bookmarks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "tenant_id" character varying NOT NULL,
        "userId" integer NOT NULL,
        "sessionId" uuid NOT NULL,
        "note" character varying(280),
        "source" character varying(8) NOT NULL DEFAULT 'web',
        CONSTRAINT "PK_session_bookmarks" PRIMARY KEY ("id"),
        CONSTRAINT "uq_session_bookmarks_user_session" UNIQUE ("userId", "sessionId")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_session_bookmarks_user" ON "session_bookmarks" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "session_bookmarks"`);
  }
}
