import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Course Copilot reference material: the files (manuals, slide decks, handouts) a trainer
 * attaches to one session, kept as extracted text split into passages. The file itself is never
 * stored. Rows go with their session (ON DELETE CASCADE) and are also deleted when the session
 * is archived. See docs/course-copilot.md.
 */
export class CreateCourseCopilotSources1984900000000 implements MigrationInterface {
  name = 'CreateCourseCopilotSources1984900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "course_copilot_sources" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "tenant_id" character varying,
        "fileName" character varying(255) NOT NULL,
        "kind" character varying(8) NOT NULL,
        "sizeBytes" integer NOT NULL,
        "pageCount" integer,
        "charCount" integer NOT NULL,
        "chunks" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "createdBy" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_course_copilot_sources" PRIMARY KEY ("id"),
        CONSTRAINT "FK_course_copilot_sources_session" FOREIGN KEY ("sessionId")
          REFERENCES "course_copilot_sessions"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_course_copilot_sources_session" ON "course_copilot_sources" ("sessionId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_course_copilot_sources_session"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "course_copilot_sources"`);
  }
}
