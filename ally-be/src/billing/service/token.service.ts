import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import { TokenBalance } from '../entity/token-balance.entity';
import { TokenGrant, TokenGrantStatus } from '../entity/token-grant.entity';
import { UsageEvent } from '../entity/usage-event.entity';
import { CostAlertKind, UsageKind } from '../enum/billing.enum';
import { microsToUsd } from '../util/pricing.util';
import { BillingAuditService } from './billing-audit.service';
import { CostAlertService } from './cost-alert.service';
import { UsageEventListener, UsageEventService } from './usage-event.service';

const MAX_TOKENS = 1_000_000_000_000;

export interface GrantInput {
  amount: number;
  renewMonthly?: boolean;
  expiresAt?: string | null;
  note: string;
}

export interface TokenState {
  hasAllowance: boolean;
  unlimited: boolean;
  left: number;
  granted: number;
  usedThisMonth: number;
  overdraft: number;
  resetsOn: Date | null;
}

/** A Postgres `date` arrives as a string or a local-midnight Date depending on the driver path. */
const dayOf = (value: unknown): string =>
  value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    : String(value ?? '').slice(0, 10);

const monthStart = (at = new Date()): string =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);

/** One calendar month later, on `day` (1–28). */
export function nextRenewal(from: Date, day: number): Date {
  const next = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, day),
  );
  return next;
}

/**
 * Token allowances (CR1 Part B). What counts is the input and output tokens of every model call on
 * the assistants a user created, from `usage_events`, taken in the same transaction the event is
 * recorded in, under a row lock on the user's balance. Idempotent because a redelivered event is
 * never inserted twice, so this never runs twice for it.
 *
 * Super-admin-only screens manage it; the owner sees only "N tokens left · resets on …".
 */
@Injectable()
export class TokenService implements UsageEventListener, OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: BillingAuditService,
    private readonly usage: UsageEventService,
    private readonly alerts: CostAlertService,
  ) {}

  onModuleInit(): void {
    this.usage.addListener(this);
    scheduledTaskRegistry.register(
      'hourly',
      'billing-token-renewals',
      async () => {
        await this.renewAndExpire();
      },
    );
    scheduledTaskRegistry.register(
      'daily',
      'billing-token-reconcile',
      async () => {
        await this.reconcile();
      },
    );
  }

  // ── counting ────────────────────────────────────────────────────────

  async onUsageRecorded(
    manager: EntityManager,
    event: UsageEvent,
  ): Promise<void> {
    if (!event.creatorUserId || event.kind === UsageKind.WHATSAPP) return;
    const tokens = (event.inputTokens ?? 0) + (event.outputTokens ?? 0);
    if (tokens <= 0) return;
    await this.consume(manager, event.creatorUserId, tokens);
  }

  /** Take `tokens` from a user's allowance: oldest grant first, the rest as overdraft. */
  async consume(
    manager: EntityManager,
    userId: number,
    tokens: number,
  ): Promise<void> {
    const [balance]: TokenBalance[] = await manager.query(
      `SELECT * FROM token_balances WHERE "userId" = $1 FOR UPDATE`,
      [userId],
    );
    if (!balance) return; // no allowance: counted in usage_events only
    const month = monthStart();
    const usedThisMonth =
      dayOf(balance.monthStart) === month
        ? Number(balance.usedThisMonth) + tokens
        : tokens;
    let left = tokens;
    if (!balance.unlimited) {
      const grants: TokenGrant[] = await manager.query(
        `SELECT * FROM token_grants WHERE "userId" = $1 AND status = 'active' AND remaining > 0
          ORDER BY "expiresAt" ASC NULLS LAST, "createdAt" ASC FOR UPDATE`,
        [userId],
      );
      for (const grant of grants) {
        if (left <= 0) break;
        const take = Math.min(left, Number(grant.remaining));
        await manager.query(
          `UPDATE token_grants SET remaining = remaining - $1, used = used + $1, "updatedAt" = now() WHERE id = $2`,
          [take, grant.id],
        );
        left -= take;
      }
    } else {
      left = 0;
    }
    await manager.query(
      `UPDATE token_balances SET "usedThisMonth" = $2, "monthStart" = $3,
              overdraft = overdraft + $4, "updatedAt" = now()
        WHERE "userId" = $1`,
      [userId, usedThisMonth, month, Math.max(0, left)],
    );
  }

  /** The allowance as the enforcement check and the owner's screen see it. */
  async state(userId: number, manager?: EntityManager): Promise<TokenState> {
    const db = manager ?? this.dataSource.manager;
    const [balance]: TokenBalance[] = await db.query(
      `SELECT * FROM token_balances WHERE "userId" = $1`,
      [userId],
    );
    if (!balance) {
      return {
        hasAllowance: false,
        unlimited: false,
        left: 0,
        granted: 0,
        usedThisMonth: 0,
        overdraft: 0,
        resetsOn: null,
      };
    }
    const [sums] = await db.query(
      `SELECT coalesce(sum(remaining), 0) AS remaining, coalesce(sum(amount), 0) AS granted,
              min("nextRenewalAt") FILTER (WHERE "renewMonthly") AS "resetsOn"
         FROM token_grants WHERE "userId" = $1 AND status = 'active'`,
      [userId],
    );
    const sameMonth = dayOf(balance.monthStart) === monthStart();
    return {
      hasAllowance: true,
      unlimited: balance.unlimited,
      left: Number(sums.remaining) - Number(balance.overdraft),
      granted: Number(sums.granted),
      usedThisMonth: sameMonth ? Number(balance.usedThisMonth) : 0,
      overdraft: Number(balance.overdraft),
      resetsOn: sums.resetsOn ?? null,
    };
  }

  /** True when a run must not start: the user has an allowance, isn't unlimited, and has none left. */
  async isUsedUp(userId: number | null | undefined): Promise<boolean> {
    if (!userId) return false;
    const state = await this.state(userId);
    return state.hasAllowance && !state.unlimited && state.left <= 0;
  }

  // ── admin ───────────────────────────────────────────────────────────

  async summary(userId: number) {
    const state = await this.state(userId);
    const grants = await this.dataSource.getRepository(TokenGrant).find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    const month = monthStart();
    const byAssistant: Array<Record<string, string>> =
      await this.dataSource.query(
        `SELECT e."chatbotId", coalesce(c.name, 'Setup drafts') AS name,
              sum(e."inputTokens" + e."outputTokens") AS tokens, coalesce(sum(e."costMicros"), 0) AS cost
         FROM usage_events e LEFT JOIN chatbots c ON c.id = e."chatbotId"
        WHERE e."creatorUserId" = $1 AND e."createdAt" >= $2 AND e.kind <> 'whatsapp'
        GROUP BY 1, 2 ORDER BY tokens DESC`,
        [userId, month],
      );
    const byKind: Array<Record<string, string>> = await this.dataSource.query(
      `SELECT kind, sum("inputTokens" + "outputTokens") AS tokens, coalesce(sum("costMicros"), 0) AS cost
         FROM usage_events WHERE "creatorUserId" = $1 AND "createdAt" >= $2 AND kind <> 'whatsapp'
        GROUP BY kind ORDER BY tokens DESC`,
      [userId, month],
    );
    return {
      ...state,
      grants,
      usage: {
        byAssistant: byAssistant.map((row) => ({
          chatbotId: row.chatbotId,
          name: row.name,
          tokens: Number(row.tokens),
          costUsd: microsToUsd(row.cost),
        })),
        byKind: byKind.map((row) => ({
          kind: row.kind,
          tokens: Number(row.tokens),
          costUsd: microsToUsd(row.cost),
        })),
      },
      history: await this.audit.historyOf('tokens', String(userId)),
    };
  }

  async assign(userId: number, input: GrantInput, actor: number | null) {
    const note = BillingAuditService.requireNote(input.note);
    const amount = validAmount(input.amount);
    const expiresAt = validExpiry(input.expiresAt);
    const now = new Date();
    await this.dataSource.transaction(async (manager) => {
      await this.ensureBalance(manager, userId);
      const [balance] = await manager.query(
        `SELECT overdraft FROM token_balances WHERE "userId" = $1 FOR UPDATE`,
        [userId],
      );
      const settle = Math.min(Number(balance.overdraft), amount);
      const day = Math.min(now.getUTCDate(), 28);
      const grant = await manager.getRepository(TokenGrant).save(
        manager.getRepository(TokenGrant).create({
          userId,
          amount,
          remaining: amount - settle,
          used: settle,
          renewMonthly: Boolean(input.renewMonthly),
          renewDay: input.renewMonthly ? day : null,
          nextRenewalAt: input.renewMonthly ? nextRenewal(now, day) : null,
          expiresAt,
          status: TokenGrantStatus.ACTIVE,
          note,
          createdBy: actor,
        }),
      );
      if (settle) {
        await manager.query(
          `UPDATE token_balances SET overdraft = overdraft - $2 WHERE "userId" = $1`,
          [userId, settle],
        );
      }
      await this.audit.record(
        {
          subjectType: 'tokens',
          subjectId: String(userId),
          action: 'assign',
          after: grant,
          note,
          actorUserId: actor,
        },
        manager,
      );
    });
    return this.summary(userId);
  }

  async update(
    userId: number,
    grantId: string,
    input: Partial<GrantInput> & { note: string },
    actor: number | null,
  ) {
    const note = BillingAuditService.requireNote(input.note);
    await this.dataSource.transaction(async (manager) => {
      const grant = await this.lockGrant(manager, userId, grantId);
      if (grant.status !== TokenGrantStatus.ACTIVE) {
        throw new ConflictException('Only an active allowance can be changed.');
      }
      const before = { ...grant };
      if (input.amount !== undefined) {
        const amount = validAmount(input.amount);
        // The balance moves by the difference; it never goes below zero here.
        grant.remaining = Math.max(
          0,
          Number(grant.remaining) + amount - Number(grant.amount),
        );
        grant.amount = amount;
      }
      if (input.renewMonthly !== undefined) {
        grant.renewMonthly = Boolean(input.renewMonthly);
        const day = Math.min(new Date().getUTCDate(), 28);
        grant.renewDay = grant.renewMonthly ? (grant.renewDay ?? day) : null;
        grant.nextRenewalAt = grant.renewMonthly
          ? (grant.nextRenewalAt ?? nextRenewal(new Date(), grant.renewDay!))
          : null;
      }
      if (input.expiresAt !== undefined)
        grant.expiresAt = validExpiry(input.expiresAt);
      await manager.getRepository(TokenGrant).save(grant);
      await this.audit.record(
        {
          subjectType: 'tokens',
          subjectId: String(userId),
          action: 'update',
          before,
          after: grant,
          note,
          actorUserId: actor,
        },
        manager,
      );
    });
    return this.summary(userId);
  }

  /** The unused part is removed from now on; used tokens stay used. */
  async revoke(
    userId: number,
    grantId: string,
    noteInput: string,
    actor: number | null,
  ) {
    const note = BillingAuditService.requireNote(noteInput);
    await this.dataSource.transaction(async (manager) => {
      const grant = await this.lockGrant(manager, userId, grantId);
      if (grant.status !== TokenGrantStatus.ACTIVE) {
        throw new ConflictException(
          'This allowance is already revoked or expired.',
        );
      }
      const before = { ...grant };
      grant.status = TokenGrantStatus.REVOKED;
      grant.remaining = 0;
      grant.nextRenewalAt = null;
      await manager.getRepository(TokenGrant).save(grant);
      await this.audit.record(
        {
          subjectType: 'tokens',
          subjectId: String(userId),
          action: 'revoke',
          before,
          after: grant,
          note,
          actorUserId: actor,
        },
        manager,
      );
    });
    return this.summary(userId);
  }

  /** Only an allowance made by mistake: none of it used yet. Otherwise revoke it. */
  async remove(
    userId: number,
    grantId: string,
    noteInput: string,
    actor: number | null,
  ) {
    const note = BillingAuditService.requireNote(noteInput);
    await this.dataSource.transaction(async (manager) => {
      const grant = await this.lockGrant(manager, userId, grantId);
      if (Number(grant.used) > 0) {
        throw new ConflictException(
          'Some of this allowance has been used, so it can’t be deleted. Revoke it instead.',
        );
      }
      await manager.getRepository(TokenGrant).delete(grant.id);
      await this.audit.record(
        {
          subjectType: 'tokens',
          subjectId: String(userId),
          action: 'delete',
          before: grant,
          note,
          actorUserId: actor,
        },
        manager,
      );
    });
    return this.summary(userId);
  }

  async setUnlimited(
    userId: number,
    unlimited: boolean,
    noteInput: string,
    actor: number | null,
  ) {
    const note = BillingAuditService.requireNote(noteInput);
    await this.dataSource.transaction(async (manager) => {
      await this.ensureBalance(manager, userId);
      await manager.query(
        `UPDATE token_balances SET unlimited = $2, "updatedAt" = now() WHERE "userId" = $1`,
        [userId, Boolean(unlimited)],
      );
      await this.audit.record(
        {
          subjectType: 'tokens',
          subjectId: String(userId),
          action: unlimited ? 'unlimited_on' : 'unlimited_off',
          after: { unlimited },
          note,
          actorUserId: actor,
        },
        manager,
      );
    });
    return this.summary(userId);
  }

  // ── jobs ────────────────────────────────────────────────────────────

  /** Refill renewing grants on their day; expire the ones past their date. */
  async renewAndExpire(
    now = new Date(),
  ): Promise<{ renewed: number; expired: number }> {
    // UPDATE … RETURNING comes back as [rows, count] from TypeORM's postgres driver.
    const [, expired] = await this.dataSource.query(
      `UPDATE token_grants SET status = 'expired', remaining = 0, "nextRenewalAt" = NULL, "updatedAt" = now()
        WHERE status = 'active' AND "expiresAt" IS NOT NULL AND "expiresAt" <= $1 RETURNING id`,
      [now],
    );
    const due: TokenGrant[] = await this.dataSource.query(
      `SELECT * FROM token_grants WHERE status = 'active' AND "renewMonthly" AND "nextRenewalAt" <= $1`,
      [now],
    );
    for (const grant of due) {
      await this.dataSource.transaction(async (manager) => {
        const [balance] = await manager.query(
          `SELECT overdraft FROM token_balances WHERE "userId" = $1 FOR UPDATE`,
          [grant.userId],
        );
        const settle = Math.min(
          Number(balance?.overdraft ?? 0),
          Number(grant.amount),
        );
        let next = new Date(grant.nextRenewalAt!);
        while (next <= now) next = nextRenewal(next, grant.renewDay ?? 1);
        await manager.query(
          `UPDATE token_grants SET remaining = $2, used = $3, "nextRenewalAt" = $4, "updatedAt" = now()
            WHERE id = $1 AND status = 'active'`,
          [grant.id, Number(grant.amount) - settle, settle, next],
        );
        if (settle) {
          await manager.query(
            `UPDATE token_balances SET overdraft = overdraft - $2 WHERE "userId" = $1`,
            [grant.userId, settle],
          );
        }
      });
    }
    return { renewed: due.length, expired: Number(expired ?? 0) };
  }

  /** Nightly: this month's counted tokens against the events themselves. */
  async reconcile(
    now = new Date(),
  ): Promise<Array<{ userId: number; counted: number; events: number }>> {
    const rows: Array<{ userId: number; counted: string; events: string }> =
      await this.dataSource.query(
        `SELECT b."userId", b."usedThisMonth" AS counted,
                coalesce((SELECT sum(e."inputTokens" + e."outputTokens") FROM usage_events e
                           WHERE e."creatorUserId" = b."userId" AND e.kind <> 'whatsapp'
                             AND e."recordedAt" >= b."monthStart"), 0) AS events
           FROM token_balances b WHERE b."monthStart" = $1`,
        [monthStart(now)],
      );
    const drift = rows
      .map((row) => ({
        userId: row.userId,
        counted: Number(row.counted),
        events: Number(row.events),
      }))
      .filter(
        (row) =>
          Math.abs(row.counted - row.events) >
          Math.max(1000, row.events * 0.01),
      );
    for (const row of drift) {
      await this.alerts.fire(
        CostAlertKind.TOKEN_DRIFT,
        String(row.userId),
        now,
        `User ${row.userId}'s token count this month (${row.counted}) differs from their usage events (${row.events}).`,
        row,
      );
    }
    return drift;
  }

  // ── helpers ─────────────────────────────────────────────────────────

  async ensureBalance(manager: EntityManager, userId: number): Promise<void> {
    await manager.query(
      `INSERT INTO token_balances ("userId", "monthStart") VALUES ($1, $2) ON CONFLICT ("userId") DO NOTHING`,
      [userId, monthStart()],
    );
  }

  private async lockGrant(
    manager: EntityManager,
    userId: number,
    grantId: string,
  ): Promise<TokenGrant> {
    const grant = await manager
      .getRepository(TokenGrant)
      .createQueryBuilder('g')
      .setLock('pessimistic_write')
      .where('g.id = :grantId AND g."userId" = :userId', { grantId, userId })
      .getOne();
    if (!grant) throw new NotFoundException('No such allowance.');
    return grant;
  }
}

function validAmount(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > MAX_TOKENS) {
    throw new BadRequestException(
      'Give a whole number of tokens, more than 0.',
    );
  }
  return n;
}

function validExpiry(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime()))
    throw new BadRequestException('Use a date like 2027-01-31.');
  if (date <= new Date())
    throw new BadRequestException('The expiry must be in the future.');
  return date;
}
