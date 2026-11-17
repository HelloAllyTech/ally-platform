import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stamps `completionLogic: 'SCORE_AND_DURATION'` onto every existing ROLEPLAY
 * `track_items` row that has none, so each one states the rule it has always
 * had: the attempt must clear the minimum score (when one is set) AND the
 * minimum duration (per item, else the platform's
 * SCENARIO_PATH_ITEM_MIN_DURATION_FOR_COMPLETION default).
 *
 * The code already reads an absent key as SCORE_AND_DURATION
 * (`roleplayCompletionLogic` in track/util/roleplay-gate.util.ts); writing it
 * out means the course builder shows trainers the rule they actually have,
 * rather than whatever the builder's default for a new item is.
 *
 * Only ROLEPLAY rows; every other type ignores the key. A NULL column becomes
 * `{ completionLogic }`. Idempotent: rows that already carry the key are left
 * alone, so a trainer's choice made before this runs is never overwritten.
 */
export class BackfillRoleplayCompletionLogic1982100000000 implements MigrationInterface {
  name = 'BackfillRoleplayCompletionLogic1982100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "track_items"
      SET "completionCriteria" = COALESCE("completionCriteria", '{}'::jsonb)
        || '{"completionLogic": "SCORE_AND_DURATION"}'::jsonb
      WHERE "type" = 'ROLEPLAY'
        AND ("completionCriteria" IS NULL
          OR NOT ("completionCriteria" ? 'completionLogic'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only the stamped default is removed; a trainer's explicit choice of any
    // other logic is kept, and absent reads as SCORE_AND_DURATION anyway.
    await queryRunner.query(`
      UPDATE "track_items"
      SET "completionCriteria" = "completionCriteria" - 'completionLogic'
      WHERE "type" = 'ROLEPLAY'
        AND "completionCriteria" ->> 'completionLogic' = 'SCORE_AND_DURATION'
    `);
  }
}
