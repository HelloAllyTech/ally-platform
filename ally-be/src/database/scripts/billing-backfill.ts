/**
 * CR1 starting point: subscriptions for chatbot creators and included seats on live assistants.
 * See docs/agents-v2/CHUNK-CR1-NOTES.md.
 *
 *   npm run billing:backfill -- --dry-run   # who gets what, and who would be blocked; writes nothing
 *   npm run billing:backfill                # write it
 *
 * Exits 2 when invited people would be blocked (seats are strict): add seats for them in Ally
 * admin → a user → Plan before the real run, or accept it.
 */
import { config as loadEnv } from 'dotenv';
loadEnv();

import dataSource from '../data-source';
import { billingBackfill } from '../../billing/backfill/billing-backfill';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  await dataSource.initialize();
  try {
    const report = await billingBackfill(dataSource, { dryRun });
    const tag = dryRun ? ' (dry run, nothing written)' : '';
    console.log(`Subscriptions${tag}:`);
    for (const s of report.subscriptions) {
      console.log(
        `  user ${s.userId}  ${s.email}  → ${s.plan} (${s.why})${s.existing ? '  [already has one, kept]' : ''}`,
      );
    }
    console.log(`\nIncluded seats on live assistants${tag}:`);
    let blocked = 0;
    for (const a of report.assistants) {
      console.log(
        `  ${a.name} (${a.chatbotId}) · ${a.creatorEmail} · ${a.plan} · page ${a.access}`,
      );
      for (const seat of a.seats)
        console.log(
          `      seat → ${seat.email ?? '(unassigned)'}  ${seat.why}`,
        );
      if (a.organisationAccess && a.seatsRequired) {
        console.log(
          '      ! organisation page: everyone who signs in needs a seat by email',
        );
      }
      for (const person of a.blocked) {
        blocked += 1;
        console.log(
          `      ✗ would be blocked: ${person.email} (${person.why})`,
        );
      }
    }
    if (blocked) {
      console.log(
        `\n${blocked} invited person(s) would be blocked on deploy. Add seats first, or accept it.`,
      );
      process.exitCode = 2;
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
