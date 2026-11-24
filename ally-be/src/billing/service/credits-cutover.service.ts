import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { CREDITS } from '../constants/credits.constants';
import { microsToUsd } from '../util/pricing.util';
import { LedgerService } from './ledger.service';

export interface CutoverReport {
  dryRun: boolean;
  startingCreditsUsd: number;
  startingBudgetUsd: number;
  builders: Array<{ userId: number; granted: 'new' | 'already' | 'would' }>;
  budgets: Array<{
    chatbotId: string;
    userId: number;
    outcome: 'set' | 'would' | 'already' | 'skipped';
    reason?: string;
  }>;
  totals: {
    buildersGranted: number;
    budgetsSet: number;
    skipped: number;
    grantedUsd: number;
  };
}

/**
 * The stage 6 cutover grant (runbook step "grant credits"): every current builder (anyone who
 * created a chatbot that is not archived) gets the starting credits, and every live chatbot gets
 * the starting budget set aside from its creator's credits. Every access list starts empty (R7) —
 * nothing here touches access.
 *
 * Idempotent: a builder's grant carries `cutover:credits:<userId>` as its idempotency key, and a
 * chatbot that already has a budget is left alone, so a second run changes nothing. Run with
 * `dryRun: true` first; it writes nothing and says what it would do.
 */
@Injectable()
export class CreditsCutoverService {
  private readonly logger = LoggerService.getInstance(
    CreditsCutoverService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
  ) {}

  async run(dryRun: boolean, actor: number | null): Promise<CutoverReport> {
    const builders: Array<{ user_id: number }> = await this.dataSource.query(
      `SELECT DISTINCT c.created_by AS user_id FROM chatbots c
         JOIN users u ON u.id = c.created_by
        WHERE c.archived_at IS NULL AND c.created_by IS NOT NULL
        ORDER BY 1`,
    );
    const live: Array<{ id: string; created_by: number }> =
      await this.dataSource.query(
        `SELECT c.id, c.created_by FROM chatbots c
        WHERE c.status = 'live' AND c.archived_at IS NULL AND c.created_by IS NOT NULL
        ORDER BY c."createdAt"`,
      );
    const report: CutoverReport = {
      dryRun,
      startingCreditsUsd: microsToUsd(CREDITS.STARTING_CREDITS_MICROS),
      startingBudgetUsd: microsToUsd(CREDITS.STARTING_BUDGET_MICROS),
      builders: [],
      budgets: [],
      totals: { buildersGranted: 0, budgetsSet: 0, skipped: 0, grantedUsd: 0 },
    };

    for (const { user_id: userId } of builders) {
      const key = `cutover:credits:${userId}`;
      const [done] = await this.dataSource.query(
        `SELECT 1 FROM credit_grants WHERE idempotency_key = $1`,
        [key],
      );
      if (done) {
        report.builders.push({ userId, granted: 'already' });
        continue;
      }
      if (dryRun) {
        report.builders.push({ userId, granted: 'would' });
      } else {
        await this.ledger.grant(
          {
            userId,
            amountUsd: microsToUsd(CREDITS.STARTING_CREDITS_MICROS),
            kind: 'grant',
            note: 'Starting credits (cutover)',
            idempotencyKey: key,
          },
          actor,
        );
        report.builders.push({ userId, granted: 'new' });
      }
      report.totals.buildersGranted += 1;
      report.totals.grantedUsd += microsToUsd(CREDITS.STARTING_CREDITS_MICROS);
    }

    // In a dry run, what each builder would have free after the grant, to say which budgets fit.
    const freeWould = new Map<number, number>();
    for (const bot of live) {
      if (await this.ledger.openBudget(bot.id)) {
        report.budgets.push({
          chatbotId: bot.id,
          userId: bot.created_by,
          outcome: 'already',
        });
        continue;
      }
      if (dryRun) {
        if (!freeWould.has(bot.created_by)) {
          const account = await this.ledger.findAccount(bot.created_by);
          const current = account
            ? await this.ledger.freeBalanceOf(account)
            : 0;
          const grant = report.builders.some(
            (b) => b.userId === bot.created_by && b.granted === 'would',
          )
            ? CREDITS.STARTING_CREDITS_MICROS
            : 0;
          freeWould.set(bot.created_by, current + grant);
        }
        const free = freeWould.get(bot.created_by)!;
        if (free >= CREDITS.STARTING_BUDGET_MICROS) {
          freeWould.set(bot.created_by, free - CREDITS.STARTING_BUDGET_MICROS);
          report.budgets.push({
            chatbotId: bot.id,
            userId: bot.created_by,
            outcome: 'would',
          });
          report.totals.budgetsSet += 1;
        } else {
          report.budgets.push({
            chatbotId: bot.id,
            userId: bot.created_by,
            outcome: 'skipped',
            reason: 'free balance too low',
          });
          report.totals.skipped += 1;
        }
        continue;
      }
      try {
        await this.ledger.setBudget(
          bot.id,
          microsToUsd(CREDITS.STARTING_BUDGET_MICROS),
          actor,
        );
        report.budgets.push({
          chatbotId: bot.id,
          userId: bot.created_by,
          outcome: 'set',
        });
        report.totals.budgetsSet += 1;
      } catch (error) {
        report.budgets.push({
          chatbotId: bot.id,
          userId: bot.created_by,
          outcome: 'skipped',
          reason: error instanceof Error ? error.message : 'unknown error',
        });
        report.totals.skipped += 1;
      }
    }
    this.logger.info(
      `Credits cutover (${dryRun ? 'dry run' : 'applied'}): ${report.totals.buildersGranted} builders, ` +
        `${report.totals.budgetsSet} budgets, ${report.totals.skipped} skipped`,
    );
    return report;
  }
}
