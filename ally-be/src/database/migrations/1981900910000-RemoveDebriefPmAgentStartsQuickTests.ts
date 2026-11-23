import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Quick checks, pass tests and side-by-side trials always run on their own
 * (decided 2026-11-12; Settings › "What the PM agent may do alone"), so the
 * owner setting `pmAgentStartsQuickTests` is gone: the PM agent always starts
 * quick checks while `pmAgentEnabled` is on.
 *
 * Up drops the key from `debrief_owner_settings.values`. The autonomy policy's
 * stored quick-test cells are left as they were (the code now reads them as
 * "auto" whatever they say), so down can put the switch back: off where the
 * settings row's quick-test cell asked first.
 */
export class RemoveDebriefPmAgentStartsQuickTests1981900910000 implements MigrationInterface {
  name = 'RemoveDebriefPmAgentStartsQuickTests1981900910000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "debrief_owner_settings"
          SET "values" = "values" - 'pmAgentStartsQuickTests'
        WHERE "values" ? 'pmAgentStartsQuickTests'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "debrief_owner_settings"
          SET "values" = COALESCE("values", '{}'::jsonb)
                || jsonb_build_object('pmAgentStartsQuickTests', false)
        WHERE "autonomy"->'matrix'->'settings'->>'quick_test' = 'ask'`,
    );
  }
}
