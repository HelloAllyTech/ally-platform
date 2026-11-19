import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roleplay assessment mode, pre/post: every track roleplay session is stamped
 * when its end is processed with how many learner turns it had
 * (`learnerTurns`) and, for an assessment item, whether it counted as the
 * learner's one attempt (`assessmentAttemptValid`). The start gate, trainer
 * reports and AAQ-255 read the stamp, so an attempt is judged once, by the
 * rule in force as it ended, and never re-judged when a trainer edits the item.
 *
 * Backfill: ended, non-abandoned sessions of items that are assessments today
 * get stamped by the rule they were played under — valid once the learner
 * said anything (an absent `minLearnerTurns` reads as 1, so no item JSONB
 * changes). A run of consecutive learner messages is one turn; the simulated
 * client's messages carry senderId -1.
 *
 * down() drops both columns.
 */
export class AddAssessmentAttemptStamp1984900000000 implements MigrationInterface {
  name = 'AddAssessmentAttemptStamp1984900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE scenario_sessions
        ADD COLUMN IF NOT EXISTS "learnerTurns" integer NULL,
        ADD COLUMN IF NOT EXISTS "assessmentAttemptValid" boolean NULL`);

    await queryRunner.query(`
      WITH assessment_sessions AS (
        SELECT s.id
          FROM scenario_sessions s
          JOIN track_item_progress tip ON tip.id = s."trackItemProgressId"
          JOIN track_items ti ON ti.id = tip."trackItemId"
         WHERE s.status = 'ENDED'
           AND s."eventStatus" <> 'ABANDONED'
           AND s."learnerTurns" IS NULL
           AND (ti."completionCriteria"->>'assessmentMode')::boolean IS TRUE
      ),
      runs AS (
        SELECT m."scenarioSessionId" AS id,
               (m."senderId" <> -1) AS learner,
               LAG(m."senderId" <> -1) OVER (
                 PARTITION BY m."scenarioSessionId" ORDER BY m.id
               ) AS prev
          FROM scenario_session_messages m
         WHERE m."scenarioSessionId" IN (SELECT id FROM assessment_sessions)
      ),
      turns AS (
        SELECT a.id,
               COUNT(r.id) FILTER (
                 WHERE r.learner AND r.prev IS DISTINCT FROM true
               )::int AS n
          FROM assessment_sessions a
          LEFT JOIN runs r ON r.id = a.id
         GROUP BY a.id
      )
      UPDATE scenario_sessions s
         SET "learnerTurns" = t.n,
             "assessmentAttemptValid" = (t.n >= 1)
        FROM turns t
       WHERE s.id = t.id`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE scenario_sessions
        DROP COLUMN IF EXISTS "assessmentAttemptValid",
        DROP COLUMN IF EXISTS "learnerTurns"`);
  }
}
