import type { EntityManager } from 'typeorm';
import type { PackChange } from '../../chatbot/entity/chatbot.entity';

/**
 * TF1 S3: a pack chosen on the live assistant (a template's stricter pack, or the owner's
 * correction in Settings) is written to its working copy too. Publishing writes the working
 * copy's pack, so without this the next Go live put the old pack back.
 */
export async function syncDraftPack(
  manager: Pick<EntityManager, 'query'>,
  chatbotId: string,
  packId: string,
  change: PackChange | null,
): Promise<void> {
  await manager.query(
    `UPDATE bot_drafts
        SET draft_config = jsonb_set(
              jsonb_set(COALESCE(draft_config, '{}'::jsonb), '{safetyPackId}', to_jsonb($2::text)),
              '{packChange}', $3::jsonb),
            "updatedAt" = now()
      WHERE chatbot_id = $1 AND status <> 'abandoned'`,
    [chatbotId, packId, JSON.stringify(change)],
  );
}
