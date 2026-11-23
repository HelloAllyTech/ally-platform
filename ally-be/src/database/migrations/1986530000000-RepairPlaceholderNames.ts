import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Q4 N1: the builder's "no change" word was saved as a name ("unchanged"): Vandrevala was published
 * at /b/unchanged and a reply said "you can reach unchanged on +91…". The code now never writes a
 * placeholder as a name; this repairs what was already written. An assistant named with a
 * placeholder takes its setup's own name, else its website's domain; its page slug, when that is a
 * placeholder too, becomes the new name's slug (with the assistant's id when taken).
 *
 * Down does nothing: the old names were the bug.
 */
const PLACEHOLDER = `'^\\s*(unchanged|no change|not changed|same|keep|none|n/?a|null|undefined|empty|tbd|placeholder)\\s*$'`;

export class RepairPlaceholderNames1986530000000 implements MigrationInterface {
  name = 'RepairPlaceholderNames1986530000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The name: the setup's own (when it isn't a placeholder), else the website's domain.
    await queryRunner.query(`
      UPDATE chatbots c
         SET name = coalesce(
               (SELECT nullif(d.draft_config ->> 'name', '')
                  FROM bot_drafts d
                 WHERE d.chatbot_id = c.id
                   AND (d.draft_config ->> 'name') !~* ${PLACEHOLDER}
                 ORDER BY d."createdAt" DESC LIMIT 1),
               (SELECT initcap(split_part(regexp_replace(d.source ->> 'website', '^https?://(www\\.)?', ''), '.', 1))
                  FROM bot_drafts d
                 WHERE d.chatbot_id = c.id AND coalesce(d.source ->> 'website', '') <> ''
                 ORDER BY d."createdAt" DESC LIMIT 1),
               'Your assistant')
       WHERE c.name ~* ${PLACEHOLDER}
    `);
    // The name people see in replies.
    await queryRunner.query(`
      UPDATE chatbots
         SET persona = jsonb_set(persona, '{displayName}', to_jsonb(name))
       WHERE persona ? 'displayName' AND (persona ->> 'displayName') ~* ${PLACEHOLDER}
    `);
    // Drafts still in setup.
    await queryRunner.query(`
      UPDATE bot_drafts d
         SET draft_config = jsonb_set(
               jsonb_set(d.draft_config, '{assistantName}', to_jsonb(c.name)),
               '{branding,assistantName}', to_jsonb(c.name))
        FROM chatbots c
       WHERE c.id = d.chatbot_id
         AND ((d.draft_config ->> 'assistantName') ~* ${PLACEHOLDER}
           OR (d.draft_config #>> '{branding,assistantName}') ~* ${PLACEHOLDER})
    `);
    // The page's link, and the name its header shows.
    await queryRunner.query(`
      UPDATE chatbot_pages p
         SET slug = CASE
               WHEN EXISTS (
                 SELECT 1 FROM chatbot_pages o
                  WHERE lower(o.slug) = trim(both '-' from regexp_replace(lower(c.name), '[^a-z0-9]+', '-', 'g'))
                    AND o.id <> p.id)
               THEN trim(both '-' from regexp_replace(lower(c.name), '[^a-z0-9]+', '-', 'g')) || '-' || left(c.id::text, 4)
               ELSE trim(both '-' from regexp_replace(lower(c.name), '[^a-z0-9]+', '-', 'g'))
             END
        FROM chatbots c
       WHERE c.id = p.chatbot_id
         AND p.slug ~* '^(unchanged|no-change|same|none|n-a|null|undefined|placeholder)(-[0-9a-z]+)?$'
    `);
    await queryRunner.query(`
      UPDATE chatbot_pages p
         SET settings = jsonb_set(p.settings, '{branding,assistantName}', to_jsonb(c.name))
        FROM chatbots c
       WHERE c.id = p.chatbot_id
         AND (p.settings #>> '{branding,assistantName}') ~* ${PLACEHOLDER}
    `);
  }

  public async down(): Promise<void> {
    // Not reversible: the placeholder names were the bug.
  }
}
