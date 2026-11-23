import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Q4 A0: before Q4, publishing's safety recheck asked the failed safety questions again as an
 * `onboarding` run, so a one- or two-question run became the draft's "latest checkup" and the 70%
 * gate read it ("0 of 1 questions answered well", seen at the Q4 baseline). Those runs are the only
 * `onboarding` runs whose questions are all pack safety questions (a full checkup always asks
 * answer, gap and out-of-scope questions too), and they become `recheck` runs, which the gate and
 * the Checkup never read as the latest.
 *
 * Runs after `1986510000000-AddCheckupRecheckTrigger`, which allows the value.
 */
export class ReclassifyOldSafetyRechecks1986520000000 implements MigrationInterface {
  name = 'ReclassifyOldSafetyRechecks1986520000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "chatbot_checkup_runs" r
         SET "trigger" = 'recheck'
       WHERE r."trigger" = 'onboarding'
         AND EXISTS (
               SELECT 1 FROM "chatbot_checkup_results" res WHERE res."run_id" = r."id"
             )
         AND NOT EXISTS (
               SELECT 1
                 FROM "chatbot_checkup_results" res
                 JOIN "chatbot_checkup_cases" c ON c."id" = res."case_id"
                WHERE res."run_id" = r."id"
                  AND NOT (c."origin" = 'platform' AND c."pack_id" IS NOT NULL)
             )
    `);
  }

  public async down(): Promise<void> {
    // Not reversible: which `recheck` runs were once `onboarding` isn't recorded, and the old
    // label was the bug.
  }
}
