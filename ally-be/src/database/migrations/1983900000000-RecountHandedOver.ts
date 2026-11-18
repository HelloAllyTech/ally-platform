import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chunk 6b, item 12: the Overview's "Handed to a person" counts hand-overs, not team replies.
 *
 * `chatbot_daily_stats.handed_over` counted the team's own replies from the inbox
 * (`handled_by = 'human'`). The rollup (`ScorecardService`, ROLLUP_SQL) now counts the chats
 * handed to a person that day: the assistant's hand-over message (`handled_by = 'handover'`),
 * sent when someone asked for a person, when the assistant passed the chat on, or after a second
 * "I don't know". The job rewrites only today and yesterday, so this recounts every stored day
 * the same way, on the same India day the rollup uses.
 *
 * Data only; no schema change. down() can't restore the old counts, which counted something else.
 */
export class RecountHandedOver1983900000000 implements MigrationInterface {
  name = 'RecountHandedOver1983900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE chatbot_daily_stats s
         SET handed_over = COALESCE(h.n, 0), updated_at = now()
        FROM chatbot_daily_stats s2
        LEFT JOIN (
          SELECT c.chatbot_id,
                 ((m."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date AS day,
                 COUNT(DISTINCT m.conversation_id) AS n
            FROM chatbot_messages m
            JOIN chatbot_conversations c ON c.id = m.conversation_id
           WHERE m.direction = 'outbound' AND m.handled_by = 'handover'
           GROUP BY 1, 2
        ) h ON h.chatbot_id = s2.chatbot_id AND h.day = s2.day
       WHERE s.chatbot_id = s2.chatbot_id AND s.day = s2.day`);
  }

  public async down(): Promise<void> {
    // The old numbers counted the team's replies; nothing to restore them from.
  }
}
