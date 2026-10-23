import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the current Claude generation — Opus 5.5, Sonnet 5.5, Haiku 5.5 — to
 * the `llm_models` catalog, mirroring the entries added to
 * LLM_MODEL_REGISTRY in the same change. The Ally guide routes its roles to
 * these models; without catalog rows the admin model pickers would not offer
 * them.
 *
 * `supportsTemperature` is false for all three: Opus 5.5 rejects a custom
 * temperature outright and Sonnet 5.5 / Haiku 5.5 reject any non-default
 * value (see modelSupportsTemperature).
 *
 * Idempotent (ON CONFLICT DO NOTHING) and reversible.
 */
const MODELS: Array<[string, string]> = [
  ['claude-opus-5-5', 'Claude Opus 5.5'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5'],
];

export class AddClaude55ModelsToCatalog1980600000000 implements MigrationInterface {
  name = 'AddClaude55ModelsToCatalog1980600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [model, label] of MODELS) {
      await queryRunner.query(
        `INSERT INTO "llm_models" ("provider", "model", "label", "supportsTemperature")
         VALUES ('anthropic', $1, $2, false)
         ON CONFLICT ("provider", "model") DO NOTHING`,
        [model, label],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "llm_models" WHERE "provider" = 'anthropic' AND "model" = ANY($1)`,
      [MODELS.map(([model]) => model)],
    );
  }
}
