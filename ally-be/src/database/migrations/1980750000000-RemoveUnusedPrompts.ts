import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remove 26 prompts nothing runs.
 *
 * Checked read-only against production on 2026-10-24: every row exists, no
 * code loads its code (by name or a built one), no scenario selects it, no
 * skill experiment points at it, and in 90 days no session ran it. Twenty-five
 * appear in no session at all. `ally_ai_learn_trainee_base` appears in 1,052
 * session records only because the pre-Skills-Store dispatch shipped every
 * override-on prompt in room metadata; the V2V tester has its own built-in
 * text and never reads it.
 *
 * - V2V tester / harness prototypes (`ally_ai_learn_trainee_*`, `_director_*`,
 *   `_judge_*`, `_actor_*`), the unshipped filler delivery planner and the
 *   pre-split working-memory rows: superseded by code that never read them.
 * - Builder guidance rows: Builder reads its prompts from files.
 * - `roleplay_copilot_*`: left behind when Roleplay Studio v2 was removed.
 * - `roadmap_opportunity_interview` (replaced by `roadmap_opportunity_copilot`),
 *   `roadmap_release_notes`, and ally-ai's two `simulation_analysis` prompts:
 *   their defaults are deleted from Git in the same change.
 *
 * Kept on purpose: `ally_ai_learn_system_main_agent_prompt_working_memory`
 * looks just as unused in code, but a scenario selects it as its main prompt.
 *
 * Guarded so a row that gained a user since the check is skipped, not deleted:
 * no scenario may select it and no skill experiment may point at it.
 * `prompts_versions` has no foreign key, so versions are deleted explicitly;
 * translations would cascade but are deleted explicitly too, for clarity.
 *
 * `down` restores nothing. The rows' text was never in Git; every row, version
 * and translation is kept in the snapshot tables `1980150000000` creates.
 * Sync refuses to recreate these codes (`REMOVED_PROMPT_CODES`).
 */
export const UNUSED_PROMPT_CODES = [
  'ally_ai_learn_trainee_base',
  'ally_ai_learn_trainee_skilled',
  'ally_ai_learn_trainee_poor',
  'ally_ai_learn_trainee_adversarial',
  'ally_ai_learn_trainee_condition_driven',
  'ally_ai_learn_trainee_full_session',
  'ally_ai_learn_trainee_stagnation_steering',
  'ally_ai_learn_director_system',
  'ally_ai_learn_director_turn_user',
  'ally_ai_learn_judge_system',
  'ally_ai_learn_judge_full_session',
  'ally_ai_learn_judge_test_case',
  'ally_ai_learn_actor_static_prefix',
  'ally_ai_learn_actor_turn_card',
  'ally_ai_learn_filler_delivery_planner',
  'ally_ai_learn_system_client_working_memory',
  'builder_coder_guidance',
  'builder_finalise_guidance',
  'roleplay_copilot_inference_pass',
  'roleplay_copilot_interviewer_system',
  'roleplay_copilot_rehearsal_critique',
  'roleplay_copilot_spec_compiler',
  'roadmap_opportunity_interview',
  'roadmap_release_notes',
  'ally_ai_simulation_simulation_analysis',
  'ally_ai_simulation_simulation_analysis_with_memory',
];

export class RemoveUnusedPrompts1980750000000 implements MigrationInterface {
  name = 'RemoveUnusedPrompts1980750000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const removable = `
      SELECT p."id" FROM "prompts" p
      WHERE p."promptCode" = ANY($1)
        AND NOT EXISTS (
          SELECT 1 FROM "scenarios" s
          WHERE s."metadata"->>'selectedMainPromptCode' = p."promptCode"
        )
        AND NOT EXISTS (
          SELECT 1 FROM "skill_experiments" e WHERE e."promptId" = p."id"
        )`;
    await queryRunner.query(
      `DELETE FROM "prompt_translations" WHERE "promptId" IN (${removable})`,
      [UNUSED_PROMPT_CODES],
    );
    await queryRunner.query(
      `DELETE FROM "prompts_versions" WHERE "promptId" IN (${removable})`,
      [UNUSED_PROMPT_CODES],
    );
    await queryRunner.query(
      `DELETE FROM "prompts" WHERE "id" IN (${removable})`,
      [UNUSED_PROMPT_CODES],
    );
  }

  public async down(): Promise<void> {
    // Nothing to restore: see the header.
  }
}
