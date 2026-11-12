import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What the PM agent may do alone (PRD §12; Settings › "What the PM agent may
 * do alone"): `debrief_owner_settings.autonomy` holds the policy matrix (kind
 * of change × test step → auto / ask / off), per-organisation overrides that
 * can only tighten, and the record of automatic re-locks.
 *
 * Seeded so nothing changes on deploy: the quick-test column copies the old
 * `pmAgentStartsQuickTests` switch (true unless a person turned it off); a
 * passed quick test still starts the gate and a passed gate the paired trial
 * on their own; canaries wait for a person; pinned rules never. Kinds:
 * settings (non-budget), prompts (prompts, registry agents, default plans),
 * pinned rules; organisations may tighten paired trials and canaries. The matrix is
 * written out here, not imported, so this migration keeps its meaning.
 */
const ROW = (quick: 'auto' | 'ask') => ({
  quick_test: quick,
  gate_test: 'auto',
  paired_trial: 'auto',
  canary: 'ask',
});
const NEVER = {
  quick_test: 'off',
  gate_test: 'off',
  paired_trial: 'off',
  canary: 'off',
};
const policy = (quick: 'auto' | 'ask') => ({
  matrix: {
    settings: ROW(quick),
    prompts: ROW(quick),
    pinned_rules: NEVER,
  },
  orgs: {},
  relocks: [],
});

export class AddDebriefAutonomyPolicy1981900740000 implements MigrationInterface {
  name = 'AddDebriefAutonomyPolicy1981900740000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "debrief_owner_settings" ADD COLUMN IF NOT EXISTS "autonomy" jsonb`,
    );
    await queryRunner.query(
      `UPDATE "debrief_owner_settings"
          SET "autonomy" = CASE
                WHEN ("values"->>'pmAgentStartsQuickTests') = 'false' THEN $1::jsonb
                ELSE $2::jsonb END
        WHERE "autonomy" IS NULL`,
      [JSON.stringify(policy('ask')), JSON.stringify(policy('auto'))],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "debrief_owner_settings" DROP COLUMN IF EXISTS "autonomy"`,
    );
  }
}
