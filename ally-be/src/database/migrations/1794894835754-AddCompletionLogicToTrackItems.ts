import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompletionLogicToTrackItems1794894835754 implements MigrationInterface {
  name = 'AddCompletionLogicToTrackItems1794894835754';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "track_items"
      SET "completionCriteria" = jsonb_set(
        COALESCE("completionCriteria", '{}'::jsonb),
        '{completionLogic}',
        '"SCORE_AND_DURATION"'
      )
      WHERE "type" = 'ROLEPLAY'
        AND ("completionCriteria" IS NULL OR "completionCriteria" ->> 'completionLogic' IS NULL);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "track_items"
      SET "completionCriteria" = "completionCriteria" - 'completionLogic'
      WHERE "type" = 'ROLEPLAY'
        AND "completionCriteria" IS NOT NULL;
    `);
  }
}
