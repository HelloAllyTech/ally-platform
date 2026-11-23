import { MigrationInterface, QueryRunner } from 'typeorm';

const OLD =
  'Something went wrong on my side and I could not answer that. Please try again in a moment.';
const NEW = "Sorry, I couldn't answer that just now. Please try again.";

/**
 * Chunk H1 Part D: the old error text still configured as the WhatsApp bot's fallback becomes the
 * current run-failed reply. Only where it is still exactly the old default: wording an owner or
 * admin wrote is left alone.
 */
export class CurrentRunFailedReply1984850000000 implements MigrationInterface {
  name = 'CurrentRunFailedReply1984850000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "global_settings"
          SET "value" = jsonb_set("value", '{fallbackText}', to_jsonb($2::text))
        WHERE "name" = 'whatsapp_bot' AND "value"->>'fallbackText' = $1`,
      [OLD, NEW],
    );
    await queryRunner.query(
      `UPDATE "chatbots"
          SET "settings" = jsonb_set("settings", '{fallbackText}', to_jsonb($2::text))
        WHERE "settings"->>'fallbackText' = $1`,
      [OLD, NEW],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "global_settings"
          SET "value" = jsonb_set("value", '{fallbackText}', to_jsonb($2::text))
        WHERE "name" = 'whatsapp_bot' AND "value"->>'fallbackText' = $1`,
      [NEW, OLD],
    );
    await queryRunner.query(
      `UPDATE "chatbots"
          SET "settings" = jsonb_set("settings", '{fallbackText}', to_jsonb($2::text))
        WHERE "settings"->>'fallbackText' = $1`,
      [NEW, OLD],
    );
  }
}
