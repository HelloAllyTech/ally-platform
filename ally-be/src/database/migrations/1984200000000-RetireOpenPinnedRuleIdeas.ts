import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pinned rules are no longer proposed, signed off or approved in the Debriefs console: they are
 * ordinary Skills Store prompts that only the named pinned editors can publish, and the Debrief PM
 * agent can never edit one. An item still waiting in "Needs you" (a first version nobody approved,
 * or a proposed change) would have no way to be decided, so it is closed as withdrawn. Approved and
 * rejected ones stay as history.
 */
export class RetireOpenPinnedRuleIdeas1984200000000 implements MigrationInterface {
  name = 'RetireOpenPinnedRuleIdeas1984200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE agent_lessons
         SET status = 'retired',
             evidence = COALESCE(evidence, '{}'::jsonb) || jsonb_build_object(
               'withdrawn',
               jsonb_build_object('at', now(), 'reason', 'Pinned rules are now edited in the Skills Store')
             ),
             "decidedAt" = now(),
             "updatedAt" = now()
       WHERE "agentKey" = 'debrief'
         AND change->>'ideaKind' = 'pinned_rule'
         AND status = 'proposed'
    `);
  }

  public async down(): Promise<void> {
    // Closed items are history; nothing to restore.
  }
}
