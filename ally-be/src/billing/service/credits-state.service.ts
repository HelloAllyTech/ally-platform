import { Injectable, Optional } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import type { CreditsGate } from 'src/bot-draft/working-copy/credits-gate';
import { LedgerService } from './ledger.service';

/**
 * Whether a chatbot (or the account that pays for it) has credits to spend: the seam between the
 * screens built in stage 1b and the credit ledger of stage 6.
 *
 * Consumers inject `CREDITS_STATE` (or bot-draft's `CREDITS_GATE`), never a class.
 * `BillingModule` binds both to the ledger (`LedgerCreditsStateService`, `LedgerCreditsGate`).
 * `StubCreditsStateService` stays for specs that want "always available".
 */
export interface CreditsState {
  available: boolean;
  /** Why not, when `available` is false: the ledger's CreditBlockReason (`no_payer`, …). */
  reason?: string;
  /** Free balance in dollars, when an account is known. */
  freeBalanceUsd?: number;
  /** The chatbot's budget left for customers, in dollars (chatbot subjects only). */
  budgetRemainingUsd?: number;
}

/**
 * The chatbot, the paying account, or a builder. A chatbot subject answers for building and
 * testing (the free balance, R2) unless `for: 'customers'` asks about its budget. A bare string is
 * a chatbot id.
 */
export type CreditsSubject =
  | { chatbotId: string; for?: 'building' | 'customers' }
  | { accountId: string }
  | { userId: number };

export interface CreditsStateProvider {
  creditsAvailable(subject: CreditsSubject | string): Promise<CreditsState>;
}

/** Injection token for the provider. */
export const CREDITS_STATE = Symbol('CREDITS_STATE');

@Injectable()
export class StubCreditsStateService implements CreditsStateProvider {
  async creditsAvailable(): Promise<CreditsState> {
    return { available: true };
  }
}

const usd = (micros: number) => Math.round(micros) / 1_000_000;

/**
 * The real answer, from the ledger. With credit enforcement switched off everything is available.
 * A ledger that cannot be read answers "not available" (fail closed), with `ledger_unavailable`.
 */
@Injectable()
export class LedgerCreditsStateService implements CreditsStateProvider {
  private readonly logger = LoggerService.getInstance(
    LedgerCreditsStateService.name,
  );

  constructor(private readonly ledger: LedgerService) {}

  async creditsAvailable(
    subject: CreditsSubject | string,
  ): Promise<CreditsState> {
    const s: CreditsSubject =
      typeof subject === 'string' ? { chatbotId: subject } : subject;
    try {
      if (!(await this.ledger.switches()).enforcement)
        return { available: true };
      if (await this.ledger.feedBlocksSpend())
        return { available: false, reason: 'feed_off' };

      if ('chatbotId' in s && s.for === 'customers') {
        const remaining = await this.ledger.budgetRemaining(s.chatbotId);
        const budget = await this.ledger.openBudget(s.chatbotId);
        return {
          available: remaining > 0,
          ...(remaining > 0
            ? {}
            : { reason: budget ? 'budget_empty' : 'no_payer' }),
          budgetRemainingUsd: usd(Math.max(0, remaining)),
        };
      }

      const accountId =
        'accountId' in s
          ? s.accountId
          : 'userId' in s
            ? await this.ledger.findAccount(s.userId)
            : await this.ledger.builderPayer({ chatbotId: s.chatbotId });
      if (!accountId) return { available: false, reason: 'no_payer' };
      const free = await this.ledger.freeBalanceOf(accountId);
      const state: CreditsState = {
        available: free > 0,
        ...(free > 0 ? {} : { reason: 'free_balance_empty' }),
        freeBalanceUsd: usd(free),
      };
      if ('chatbotId' in s) {
        state.budgetRemainingUsd = usd(
          Math.max(0, await this.ledger.budgetRemaining(s.chatbotId)),
        );
      }
      return state;
    } catch (error) {
      this.logger.warn(
        `Credits state unreadable, answering unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return { available: false, reason: 'ledger_unavailable' };
    }
  }
}

/** bot-draft's `CREDITS_GATE` (stage 3 screens), answered from the builder's free balance. */
@Injectable()
export class LedgerCreditsGate implements CreditsGate {
  constructor(@Optional() private readonly state?: LedgerCreditsStateService) {}

  async creditsAvailable(
    builderUserId: number | null | undefined,
  ): Promise<boolean> {
    if (!this.state) return true;
    if (!builderUserId) return false;
    return (await this.state.creditsAvailable({ userId: builderUserId }))
      .available;
  }
}
