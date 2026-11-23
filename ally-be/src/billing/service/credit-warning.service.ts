import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SESService } from 'src/aws/service/ses.service';
import { LoggerService } from 'src/logger/logger.service';
import { CREDITS } from '../constants/credits.constants';
import { microsToUsd } from '../util/pricing.util';
import { LedgerService, LedgerWatcher } from './ledger.service';

type Subject = { accountId?: string; budgetId?: string };

/** The highest threshold `used / total` has reached, or null. */
export function crossedPercent(
  usedMicros: number,
  totalMicros: number,
): number | null {
  if (!(totalMicros > 0)) return null;
  const pct = (usedMicros / totalMicros) * 100;
  let crossed: number | null = null;
  for (const threshold of CREDITS.WARNING_PERCENTS)
    if (pct >= threshold) crossed = threshold;
  return crossed;
}

/**
 * Warning emails to the builder at 50, 80 and 95% (stage 6), for their account (what is committed
 * of what was granted) and for each chatbot budget (what customers spent of what was set aside).
 * Once per threshold per epoch: `credit_warnings`' primary key is the "once", and a grant or a
 * top-up opens a new epoch, so the emails re-arm. Reaching 95% straight away sends one email, not
 * three: the lower thresholds are marked as passed.
 *
 * Sent through SES like the spend-cap and limit notices. Behind the `warningEmails` switch.
 */
@Injectable()
export class CreditWarningService implements LedgerWatcher, OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    CreditWarningService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    @Optional() private readonly ses?: SESService,
  ) {}

  onModuleInit(): void {
    this.ledger.addWatcher(this);
  }

  afterSpend(subject: Subject): void {
    void this.check(subject).catch((error) =>
      this.logger.warn(
        `Credit warning check failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      ),
    );
  }

  /** True when an email went out. */
  async check(subject: Subject): Promise<boolean> {
    if (!(await this.ledger.switches()).warningEmails) return false;
    if (subject.budgetId) return this.checkBudget(subject.budgetId);
    if (subject.accountId) return this.checkAccount(subject.accountId);
    return false;
  }

  private async checkAccount(accountId: string): Promise<boolean> {
    const [a] = await this.dataSource.query(
      `SELECT a.granted_micros, a.set_aside_micros, a.builder_spent_micros, a.grant_epoch, u.email, u.name
         FROM billing_accounts a JOIN users u ON u.id = a.owner_user_id WHERE a.id = $1`,
      [accountId],
    );
    if (!a) return false;
    const used = Number(a.set_aside_micros) + Number(a.builder_spent_micros);
    const pct = crossedPercent(used, Number(a.granted_micros));
    if (
      !pct ||
      !(await this.mark('account', accountId, Number(a.grant_epoch), pct))
    )
      return false;
    // COPY: needs approval
    return this.send(
      a.email,
      `Your Ally credits: ${pct}% used`,
      `You have used or set aside ${pct}% of your Ally credits ($${microsToUsd(used).toFixed(2)} of $${microsToUsd(Number(a.granted_micros)).toFixed(2)}). ` +
        `When your free balance runs out you can't build or test, and your chatbots keep answering from their own budgets. ` +
        `Contact Ally for more credits. See Credits in your Ally account.`,
    );
  }

  private async checkBudget(budgetId: string): Promise<boolean> {
    const [b] = await this.dataSource.query(
      `SELECT b.chatbot_id, b.set_aside_micros, b.spent_micros, b.epoch, c.name, u.email
         FROM chatbot_budgets b
         JOIN billing_accounts a ON a.id = b.account_id
         JOIN users u ON u.id = a.owner_user_id
         LEFT JOIN chatbots c ON c.id = b.chatbot_id
        WHERE b.id = $1 AND b.archived_at IS NULL`,
      [budgetId],
    );
    if (!b) return false;
    const pct = crossedPercent(
      Number(b.spent_micros),
      Number(b.set_aside_micros),
    );
    if (!pct || !(await this.mark('budget', budgetId, Number(b.epoch), pct)))
      return false;
    const name = b.name ?? 'your chatbot';
    // COPY: needs approval
    return this.send(
      b.email,
      `"${name}" has used ${pct}% of its budget`,
      `"${name}" has used ${pct}% of the budget you set aside for it ($${microsToUsd(Number(b.spent_micros)).toFixed(2)} of $${microsToUsd(Number(b.set_aside_micros)).toFixed(2)}). ` +
        `When it runs out, people who message it get a short notice with crisis information instead of an answer. ` +
        `Top it up from your free balance, or contact Ally for more credits.`,
    );
  }

  /** Marks this threshold and every lower one for the epoch; true when this one was new. */
  private async mark(
    subjectType: 'account' | 'budget',
    subjectId: string,
    epoch: number,
    pct: number,
  ): Promise<boolean> {
    let fresh = false;
    for (const threshold of CREDITS.WARNING_PERCENTS) {
      if (threshold > pct) break;
      const rows = await this.dataSource.query(
        `INSERT INTO credit_warnings (subject_type, subject_id, epoch, percent)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING percent`,
        [subjectType, subjectId, epoch, threshold],
      );
      if (threshold === pct && rows.length) fresh = true;
    }
    return fresh;
  }

  private async send(
    to: string | null,
    subject: string,
    body: string,
  ): Promise<boolean> {
    if (!to || !this.ses) return false;
    await this.ses.sendEmail({
      to,
      subject,
      body,
      purpose: 'billing-credits-warning',
      maskRecipientsInLog: true,
      alertOnFailure: false,
    });
    return true;
  }
}
