import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Data repair for the interview-cap lockout of 2026-11-03.
 *
 * Until this release nothing ever took a character interview out of ACTIVE
 * except a saved draft, so every interview an admin walked away from kept a
 * slot under the per-tenant "10 in progress" cap for good. The code now
 * ignores sessions idle for over an hour and abandons them on Leave / Start
 * over, but the rows that already accumulated would still resume as ACTIVE
 * in the cross-browser list. Mark them ABANDONED here, the same way the new
 * endpoint does, tagging each so `down` can put back exactly these rows.
 *
 * The one-hour idle rule mirrors CHARACTER_INTERVIEW_ACTIVE_SESSION_IDLE_MS;
 * it is inlined because a migration must not drift with the constant.
 */
export class AbandonStaleCharacterInterviewSessions1980870000000 implements MigrationInterface {
  name = 'AbandonStaleCharacterInterviewSessions1980870000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "character_interview_sessions"
         SET "status" = 'ABANDONED',
             "metadata" = COALESCE("metadata", '{}'::jsonb) || '{"abandonedByMigration": "${this.name}"}'::jsonb,
             "updatedAt" = now()
       WHERE "status" = 'ACTIVE'
         AND "deletedAt" IS NULL
         AND "updatedAt" < now() - interval '1 hour'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "character_interview_sessions"
         SET "status" = 'ACTIVE',
             "metadata" = "metadata" - 'abandonedByMigration'
       WHERE "status" = 'ABANDONED'
         AND "metadata" ->> 'abandonedByMigration' = '${this.name}'`,
    );
  }
}
