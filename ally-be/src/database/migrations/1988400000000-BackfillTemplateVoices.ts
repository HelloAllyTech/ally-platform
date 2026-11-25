import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  TEMPLATE_VOICES,
  withTemplateVoice,
} from '../../chatbot/voice/template-voices';

/**
 * TF1 round 2 (Saathi B-13, approved 25 Nov): assistants built from an organisation template
 * before voices existed get their template's voice (`chatbots.settings.voice`), the newest
 * install deciding. Texts the owner set (`voice.ownerKeys`) are never replaced; an owner's own
 * decline wording (`settings.declineText`) still wins at send time. Down removes the voice.
 */
export class BackfillTemplateVoices1988400000000 implements MigrationInterface {
  name = 'BackfillTemplateVoices1988400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT DISTINCT ON (c.id) c.id, c.settings -> 'voice' AS voice, i.template_id
         FROM chatbots c
         JOIN chatbot_template_installs i ON i.chatbot_id = c.id
        WHERE i.template_id = ANY($1)
        ORDER BY c.id, i.installed_at DESC`,
      [Object.keys(TEMPLATE_VOICES)],
    )) as { id: string; voice: unknown; template_id: string }[];
    for (const row of rows) {
      const voice = withTemplateVoice(row.voice as never, row.template_id);
      if (!voice) continue;
      await queryRunner.query(
        `UPDATE chatbots SET settings = settings || jsonb_build_object('voice', $2::jsonb)
          WHERE id = $1`,
        [row.id, JSON.stringify(voice)],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE chatbots SET settings = settings - 'voice'
        WHERE settings -> 'voice' ->> 'template' = ANY($1)`,
      [Object.keys(TEMPLATE_VOICES)],
    );
  }
}
