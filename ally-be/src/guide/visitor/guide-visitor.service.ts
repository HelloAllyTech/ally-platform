import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, createHmac, randomBytes } from 'crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import { TokenUser } from 'src/auth/type/auth.types';
import { AppConfigService } from 'src/config/config.service';
import { ErrorCode } from 'src/exception/error-code.enum';
import { AgentCostLedgerService } from 'src/llm-agent/harness/budget/agent-cost-ledger.service';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { GuideMessage } from '../entity/guide-message.entity';
import { GuideThread } from '../entity/guide-thread.entity';
import { GuideVisitor } from '../entity/guide-visitor.entity';
import {
  GuideMessageRole,
  GuideNotebookKind,
  GuideThreadStatus,
} from '../enum/guide.enum';
import { GuideLearnerDataService } from '../learner/guide-learner-data.service';
import {
  ALLY_GUIDE_AGENT_KEY,
  GUIDE_DEFAULT_POLICY,
  GuidePolicy,
  GuideReleaseBundle,
} from '../release/guide-release.bundle';
import { GuideThreadService } from '../runtime/guide-thread.service';
import { GuideSettingsService } from '../settings/guide-settings.service';

/** Request header carrying the visitor token (plan §9.1). */
export const GUIDE_VISITOR_HEADER = 'x-guide-visitor';

const PG_UNIQUE_VIOLATION = '23505';
const DAY_MS = 24 * 60 * 60 * 1000;
/** The global anonymous spend is re-read at most this often. */
const ANON_SPEND_CACHE_MS = 30_000;

export const hashVisitorToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** Why an anonymous turn may not run, as the contract's failure codes. */
export type VisitorRefusal =
  | 'allowance_exhausted'
  | 'anonymous_paused'
  | 'rate_limited';

export interface VisitorAllowance {
  remaining: number;
  limit: number;
}

const guideVisitorInvalid = () =>
  new UnauthorizedException({
    statusCode: HttpStatus.UNAUTHORIZED,
    message: 'This visit has expired. Reload the page to start again.',
    error: 'Unauthorized',
    errorCode: ErrorCode.GUIDE_VISITOR_INVALID,
  });

const guideVisitorsRateLimited = () =>
  new HttpException(
    {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message: 'Too many new visits from here. Try again in a little while.',
      error: 'Too Many Requests',
      errorCode: ErrorCode.RATE_LIMITED,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );

const guideAnonymousUnavailable = () =>
  new HttpException(
    {
      statusCode: HttpStatus.FORBIDDEN,
      message: 'Sign in to talk to Ally about this course.',
      error: 'Forbidden',
      errorCode: ErrorCode.GUIDE_DISABLED,
    },
    HttpStatus.FORBIDDEN,
  );

/**
 * Anonymous visitors on a public course link (plans/ally-guide/plan.md §3
 * stages 1–3, §6.5, Appendix A "Limits and budgets").
 *
 * A visitor is a random token the browser keeps; only its hash is stored.
 * Visitors chat within a small allowance — per course, per 24 hours, both a
 * message count and a spend — under two shared ceilings: messages per IP
 * address per hour, and the platform's anonymous spend per day. Reaching the
 * allowance asks them to sign in; reaching the daily ceiling pauses anonymous
 * chat for everyone, never signed-in learners.
 *
 * Signing in claims the visitor's thread for the learner (§11 E-4): it
 * becomes theirs if they have none for the course, or is folded into the one
 * they have. Either way their first message is kept as the notebook's
 * "before", and the next turn opens a new epoch with their organisation and
 * learner context.
 */
@Injectable()
export class GuideVisitorService {
  private readonly logger = LoggerService.getInstance(GuideVisitorService.name);
  private anonSpend: { usd: number; readAt: number } | null = null;

  constructor(
    @InjectRepository(GuideVisitor)
    private readonly visitors: Repository<GuideVisitor>,
    @InjectRepository(GuideThread)
    private readonly threadRows: Repository<GuideThread>,
    private readonly threads: GuideThreadService,
    private readonly settings: GuideSettingsService,
    private readonly ledger: AgentCostLedgerService,
    private readonly learnerData: GuideLearnerDataService,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
    private readonly dataSource: DataSource,
    private readonly releases: AgentReleaseService,
  ) {}

  /** The live release's policy (Appendix A values), or the code defaults. */
  async policy(): Promise<GuidePolicy> {
    const ga = await this.releases.getGa(ALLY_GUIDE_AGENT_KEY);
    return (
      (ga?.bundle as unknown as GuideReleaseBundle | undefined)?.policy ??
      GUIDE_DEFAULT_POLICY
    );
  }

  /** An IP address, keyed so the stored hash can't be reversed by lookup. */
  hashIp(ip: string | null | undefined): string | null {
    if (!ip) return null;
    const key = `ally-guide-ip:${this.config.jwt.accessToken.secret ?? ''}`;
    return createHmac('sha256', key).update(ip).digest('hex');
  }

  /** Anonymous chat is on for this course: the guide, the switch, a public link. */
  async assertAnonymousAvailable(trackId: string): Promise<void> {
    const [reason, switches] = await Promise.all([
      this.settings.unavailableReason(trackId, null),
      this.settings.switches(),
    ]);
    if (reason !== null || !switches.anonymousChat) {
      throw guideAnonymousUnavailable();
    }
  }

  async create(
    ip: string | null | undefined,
    policy: GuidePolicy,
  ): Promise<{ token: string; visitorId: string }> {
    const ipHash = this.hashIp(ip);
    if (ipHash) {
      const { count } = await this.redis.incrWithExpiry(
        `guide:visitors:created:${ipHash}`,
        60 * 60,
      );
      if (count > policy.limits.visitorsCreatedPerIpHour) {
        throw guideVisitorsRateLimited();
      }
    }
    const token = randomBytes(32).toString('base64url');
    const visitor = await this.visitors.save(
      this.visitors.create({ tokenHash: hashVisitorToken(token), ipHash }),
    );
    return { token, visitorId: visitor.id };
  }

  /** The visitor a token belongs to, or 401. A claimed visitor is spent. */
  async resolve(token: string | null | undefined): Promise<GuideVisitor> {
    if (!token) throw guideVisitorInvalid();
    const visitor = await this.visitors.findOne({
      where: { tokenHash: hashVisitorToken(token), claimedAt: IsNull() },
    });
    if (!visitor) throw guideVisitorInvalid();
    return visitor;
  }

  async touch(visitorId: string): Promise<void> {
    await this.visitors.update(visitorId, {
      lastSeenAt: () => 'now()',
    } as never);
  }

  /** The visitor's thread for this course, created on first visit. */
  async threadFor(
    visitor: GuideVisitor,
    trackId: string,
  ): Promise<GuideThread> {
    await this.assertAnonymousAvailable(trackId);
    const existing = await this.activeThread(visitor.id, trackId);
    if (existing) return existing;
    try {
      return await this.threadRows.save(
        this.threadRows.create({
          visitorId: visitor.id,
          userId: null,
          tenantId: null,
          trackId,
          status: GuideThreadStatus.ACTIVE,
        }),
      );
    } catch (error) {
      if ((error as { code?: string })?.code === PG_UNIQUE_VIOLATION) {
        const winner = await this.activeThread(visitor.id, trackId);
        if (winner) return winner;
      }
      throw error;
    }
  }

  private activeThread(visitorId: string, trackId: string) {
    return this.threadRows.findOne({
      where: { visitorId, trackId, status: GuideThreadStatus.ACTIVE },
    });
  }

  /** A thread this visitor owns, or 404 (never "it exists, not yours"). */
  async getOwned(threadId: string, visitorId: string): Promise<GuideThread> {
    const thread = await this.threadRows.findOne({ where: { id: threadId } });
    if (!thread || thread.visitorId !== visitorId || thread.userId) {
      throw new NotFoundException('Thread not found');
    }
    return thread;
  }

  /** Messages left today on this course: the smaller of count and spend. */
  async allowance(
    visitorId: string,
    trackId: string,
    policy: GuidePolicy,
  ): Promise<VisitorAllowance> {
    const limit = policy.limits.visitorMessagesPerDay;
    const [rows, usd] = await Promise.all([
      this.dataSource.query(
        `SELECT COUNT(*)::int AS "sent" FROM "guide_messages" m
           JOIN "guide_threads" t ON t."id" = m."threadId"
          WHERE t."visitorId" = $1 AND t."trackId" = $2
            AND m."role" = $3 AND m."createdAt" >= now() - interval '24 hours'`,
        [visitorId, trackId, GuideMessageRole.LEARNER],
      ) as Promise<Array<{ sent: number }>>,
      this.ledger.totalForVisitorWithin(
        ALLY_GUIDE_AGENT_KEY,
        visitorId,
        DAY_MS,
      ),
    ]);
    const sent = Number(rows?.[0]?.sent ?? 0);
    const remaining =
      usd >= policy.limits.visitorUsdPerDay ? 0 : Math.max(0, limit - sent);
    return { remaining, limit };
  }

  /**
   * Whether one more anonymous message may run, checked at admit (before the
   * message is stored). Counts the message against the IP's hour on success.
   */
  async admit(input: {
    visitor: Pick<GuideVisitor, 'id' | 'ipHash'>;
    trackId: string;
    ipHash: string | null;
    policy: GuidePolicy;
  }): Promise<VisitorRefusal | null> {
    if (
      (await this.anonymousSpendToday()) >=
      input.policy.limits.anonymousDailyUsdCap
    ) {
      return 'anonymous_paused';
    }
    const allowance = await this.allowance(
      input.visitor.id,
      input.trackId,
      input.policy,
    );
    if (allowance.remaining <= 0) return 'allowance_exhausted';
    const ipHash = input.ipHash ?? input.visitor.ipHash ?? null;
    if (ipHash) {
      const { count } = await this.redis.incrWithExpiry(
        `guide:visitors:ip-messages:${ipHash}`,
        60 * 60,
      );
      if (count > input.policy.limits.ipMessagesPerHour) return 'rate_limited';
    }
    return null;
  }

  /** Platform-wide anonymous spend since midnight UTC (plan H-4). */
  async anonymousSpendToday(): Promise<number> {
    if (
      this.anonSpend &&
      Date.now() - this.anonSpend.readAt < ANON_SPEND_CACHE_MS
    ) {
      return this.anonSpend.usd;
    }
    const rows: Array<{ total: string | null }> = await this.dataSource.query(
      `SELECT COALESCE(SUM("usd"), 0) AS "total" FROM "agent_cost_ledger"
        WHERE "agentKey" = $1 AND "visitorId" IS NOT NULL
          AND "createdAt" >= date_trunc('day', now())`,
      [ALLY_GUIDE_AGENT_KEY],
    );
    const usd = Number(rows?.[0]?.total ?? 0);
    this.anonSpend = { usd, readAt: Date.now() };
    return usd;
  }

  /**
   * Signing in (plan §3 stage 3, §11 E-4). The visitor's thread for this
   * course becomes the learner's, or — when they already have one — is
   * marked merged and summarised into it. The visitor is spent either way.
   * Access is the caller's to check first: a learner who can't open the
   * course keeps the visitor thread as it was.
   */
  async claim(
    token: string,
    user: TokenUser,
    trackId: string,
  ): Promise<{ thread: GuideThread; outcome: 'claimed' | 'merged' | 'none' }> {
    // Access first: a learner who can't open the course leaves the visitor
    // conversation as it was (plan §11 A-2), and gets the refusal.
    await this.threads.assertCanOpen(trackId, user);
    const visitor = await this.resolve(token).catch(() => null);
    const existing = await this.threads.findActiveForUser(trackId, user);
    const visitorThread = visitor
      ? await this.activeThread(visitor.id, trackId)
      : null;

    if (!visitor || !visitorThread) {
      if (visitor) await this.markClaimed(visitor.id, user);
      const thread =
        existing ?? (await this.threads.getOrCreateForUser(trackId, user));
      return { thread, outcome: 'none' };
    }

    const firstMove = await this.firstLearnerMessage(visitorThread.id);
    let outcome: 'claimed' | 'merged';
    let thread: GuideThread;
    if (!existing) {
      thread = await this.attach(visitorThread, user);
      outcome = 'claimed';
    } else {
      thread = await this.mergeInto(visitorThread, existing);
      outcome = 'merged';
    }
    await this.markClaimed(visitor.id, user);
    // The "before" is their first move ever on this course: a later visit
    // that is claimed again does not replace it.
    const hasBefore = await this.learnerData.hasNotebookKind(
      { id: user.id, tenantId: user.tenantId },
      trackId,
      GuideNotebookKind.FIRST_MOVE,
    );
    if (firstMove?.content?.trim() && !hasBefore) {
      await this.learnerData
        .addToNotebook({
          owner: { id: user.id, tenantId: user.tenantId },
          threadId: thread.id,
          trackId,
          kind: GuideNotebookKind.FIRST_MOVE,
          text: firstMove.content,
          sourceMessageId: firstMove.id,
        })
        .catch((error) =>
          this.logger.warn(`First move not kept on claim: ${String(error)}`),
        );
    }
    this.logger.info(
      `Ally visitor ${visitor.id} signed in on ${trackId}: thread ${outcome}`,
    );
    return { thread, outcome };
  }

  /** The visitor thread becomes the learner's: their org's layer from the next turn. */
  private async attach(
    visitorThread: GuideThread,
    user: TokenUser,
  ): Promise<GuideThread> {
    await this.dataSource.transaction(async (manager) => {
      // A fresh epoch: the next turn rebuilds the context with the org layer
      // and the learner's own context, which a visitor never had.
      await manager.query(
        `UPDATE "guide_threads"
            SET "userId" = $2, "tenant_id" = $3, "epochSnapshot" = NULL, "updatedAt" = now()
          WHERE "id" = $1`,
        [visitorThread.id, user.id, user.tenantId],
      );
      for (const table of [
        'guide_messages',
        'guide_cards',
        'guide_triggers',
        'guide_signals',
      ]) {
        await manager.query(
          `UPDATE "${table}" SET "tenant_id" = $2 WHERE "threadId" = $1 AND "tenant_id" IS NULL`,
          [visitorThread.id, user.tenantId],
        );
      }
    });
    return (await this.threadRows.findOne({
      where: { id: visitorThread.id },
    }))!;
  }

  /**
   * The learner already has a thread for this course: theirs stays, the
   * visitor's is closed as merged, and a note tells Ally what was asked
   * before they signed in.
   */
  private async mergeInto(
    visitorThread: GuideThread,
    existing: GuideThread,
  ): Promise<GuideThread> {
    const asked: Array<{ content?: string | null }> = await this.dataSource
      .getRepository(GuideMessage)
      .find({
        where: { threadId: visitorThread.id, role: GuideMessageRole.LEARNER },
        order: { seq: 'ASC' },
        take: 5,
        select: { content: true },
      });
    const lines = asked
      .map((row) => (row.content ?? '').trim())
      .filter(Boolean)
      .map((text) => `- ${text.slice(0, 200)}`);
    await this.threadRows.update(visitorThread.id, {
      status: GuideThreadStatus.MERGED,
    });
    if (lines.length) {
      // Folded into the learner's next turn as a platform event, like a
      // completion: history stays a run of complete exchanges.
      await this.threads.queueTrigger(existing, {
        kind: 'visitor_merged',
        dedupeKey: `visitor_merged:${visitorThread.id}`,
        description: [
          'Before signing in just now, the learner talked with Ally as a visitor on this course. They asked:',
          ...lines,
        ].join('\n'),
      });
    }
    return existing;
  }

  private firstLearnerMessage(threadId: string) {
    return this.dataSource.getRepository(GuideMessage).findOne({
      where: { threadId, role: GuideMessageRole.LEARNER },
      order: { seq: 'ASC' },
    });
  }

  private async markClaimed(visitorId: string, user: TokenUser): Promise<void> {
    await this.visitors.update(visitorId, {
      claimedByUserId: user.id,
      claimedTenantId: user.tenantId,
      claimedAt: new Date(),
    });
  }
}
