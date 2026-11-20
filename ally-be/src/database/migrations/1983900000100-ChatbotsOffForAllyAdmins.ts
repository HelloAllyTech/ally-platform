import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chunk 6b, item 31 (Shehbaz, 17 Nov): Ally admins have Chatbots (`whatsapp_bot`) switched off by
 * default, so they don't see Assistants at all; someone switches it on for the admins who need it
 * (Ally admin → Users → Ally admins). Being on an assistant's team still lets anyone open that
 * assistant: membership no longer needs the toggle.
 *
 * The toggle was never default-on (a missing row is off), so new admins already start without it.
 * This switches it off for the admins who have it now, keeping the row (enabled = false), except
 * A1's custom logins: logins made for Chatbots with "Create a custom login", which writes a row for
 * every key with most of them off. They're recognised as admins with more keys switched off than
 * on; switching Chatbots off would leave them nothing to use.
 *
 * down() can't tell which rows this switched off, so it does nothing; switch the toggle back on
 * per admin in Ally admins.
 */
export class ChatbotsOffForAllyAdmins1983900000100 implements MigrationInterface {
  name = 'ChatbotsOffForAllyAdmins1983900000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE admin_feature_toggles t
         SET enabled = false, "updatedAt" = now()
       WHERE t."featureKey" = 'whatsapp_bot'
         AND t.enabled = true
         AND t."userId" NOT IN (
           SELECT "userId" FROM admin_feature_toggles
            GROUP BY "userId"
           HAVING count(*) FILTER (WHERE NOT enabled) > count(*) FILTER (WHERE enabled)
         )`);
  }

  public async down(): Promise<void> {
    // Which admins had it on isn't kept; switch it back on per admin in Ally admins.
  }
}
