import { DataSource } from 'typeorm';
import { BillingAuditService } from '../service/billing-audit.service';
import { PlanService } from '../service/plan.service';
import { TokenService } from '../service/token.service';

/** Decided at the CR1 plan stop. */
export const STARTING_TOKENS_FLOOR = 20_000_000;
export const STARTING_TOKENS_MULTIPLIER = 3;
export const STARTING_PLAN_KEY = 'pro';
export const INTERNAL_PLAN_KEY = 'internal';
/** Ally's own accounts are on the internal plan. */
export const INTERNAL_EMAIL_DOMAIN = '@helloally.ai';

export interface BackfillReport {
  subscriptions: Array<{
    userId: number;
    email: string;
    plan: string;
    why: string;
    existing: boolean;
  }>;
  tokens: Array<{
    userId: number;
    email: string;
    last30Days: number;
    amount: number;
    existing: boolean;
  }>;
  assistants: Array<{
    chatbotId: string;
    name: string;
    creatorEmail: string;
    plan: string;
    access: string;
    seatsRequired: boolean;
    seats: Array<{ email: string | null; why: string }>;
    /** Invited people who would be blocked on deploy: no seat left for them. */
    blocked: Array<{ email: string; why: string }>;
    /** An organisation page: everyone who signs in from it needs a seat. */
    organisationAccess: boolean;
  }>;
}

/**
 * CR1 starting point (one script, dry run first):
 *   - every chatbot creator gets a subscription: Ally accounts (an @helloally.ai email, a platform
 *     admin, or a test organisation) on `internal`, everyone else on Pro;
 *   - every live assistant gets its included seats: owners, then editors, then invited emails;
 *     the invited people left without one are listed — seats are strict, so they'd be blocked;
 *   - every custom login gets max(20M, 3× their last 30 days' tokens), renewing monthly. Usage
 *     events only exist from CR1's deploy, so at first run that is 20M for everyone.
 *
 * Idempotent: existing subscriptions, seats and allowances are kept, never doubled.
 */
export async function billingBackfill(
  dataSource: DataSource,
  {
    dryRun,
    actorUserId = null,
  }: { dryRun: boolean; actorUserId?: number | null },
): Promise<BackfillReport> {
  const audit = new BillingAuditService(dataSource);
  const alerts = { fire: async () => false } as never;
  const plans = new PlanService(dataSource, audit, alerts);
  const tokens = new TokenService(
    dataSource,
    audit,
    { addListener: () => undefined } as never,
    alerts,
  );
  const report: BackfillReport = {
    subscriptions: [],
    tokens: [],
    assistants: [],
  };

  const creators: Array<{
    id: number;
    email: string;
    internal: boolean;
    why: string;
    existing: boolean;
  }> = await dataSource.query(
    `WITH c AS (
         SELECT DISTINCT created_by AS id FROM chatbots
         UNION
         SELECT ug."userId" FROM user_groups ug JOIN groups g ON g.id = ug."groupId"
          WHERE g.name = 'ASSISTANT_OWNER')
       SELECT u.id, u.email,
              (lower(u.email) LIKE '%' || $1
               OR EXISTS (SELECT 1 FROM user_groups ug JOIN groups g ON g.id = ug."groupId"
                           WHERE ug."userId" = u.id AND g.name IN ('PLATFORM_ADMIN','SUPER_ADMIN','SUPER_DUPER_ADMIN','MULTI_TENANT_ADMIN'))
               OR coalesce(t."isTestOrganization", false)) AS internal,
              CASE WHEN lower(u.email) LIKE '%' || $1 THEN 'Ally email'
                   WHEN coalesce(t."isTestOrganization", false) THEN 'test organisation'
                   WHEN EXISTS (SELECT 1 FROM user_groups ug JOIN groups g ON g.id = ug."groupId"
                                 WHERE ug."userId" = u.id AND g.name IN ('PLATFORM_ADMIN','SUPER_ADMIN','SUPER_DUPER_ADMIN','MULTI_TENANT_ADMIN')) THEN 'Ally admin'
                   ELSE 'customer' END AS why,
              EXISTS (SELECT 1 FROM subscriptions s WHERE s."userId" = u.id) AS existing
         FROM c JOIN users u ON u.id = c.id
         LEFT JOIN tenants t ON t.id::text = u.tenant_id::text
        ORDER BY u.id`,
    [INTERNAL_EMAIL_DOMAIN],
  );

  for (const creator of creators) {
    const planKey = creator.internal ? INTERNAL_PLAN_KEY : STARTING_PLAN_KEY;
    report.subscriptions.push({
      userId: creator.id,
      email: creator.email,
      plan: planKey,
      why: creator.why,
      existing: creator.existing,
    });
  }

  const logins: Array<{
    id: number;
    email: string;
    existing: boolean;
    last30: string;
  }> = await dataSource.query(
    `SELECT u.id, u.email,
            EXISTS (SELECT 1 FROM token_balances b WHERE b."userId" = u.id) AS existing,
            coalesce((SELECT sum(e."inputTokens" + e."outputTokens") FROM usage_events e
                       WHERE e."creatorUserId" = u.id AND e.kind <> 'whatsapp'
                         AND e."createdAt" >= now() - interval '30 days'), 0) AS last30
       FROM users u
      WHERE EXISTS (SELECT 1 FROM user_groups ug JOIN groups g ON g.id = ug."groupId"
                     WHERE ug."userId" = u.id AND g.name = 'ASSISTANT_OWNER')
      ORDER BY u.id`,
  );
  for (const login of logins) {
    const last30 = Number(login.last30);
    report.tokens.push({
      userId: login.id,
      email: login.email,
      last30Days: last30,
      amount: Math.max(
        STARTING_TOKENS_FLOOR,
        STARTING_TOKENS_MULTIPLIER * last30,
      ),
      existing: login.existing,
    });
  }

  const bots: Array<{
    id: string;
    name: string;
    createdBy: number;
    creatorEmail: string;
    access: string | null;
  }> = await dataSource.query(
    `SELECT c.id, c.name, c.created_by AS "createdBy", u.email AS "creatorEmail", p.access
         FROM chatbots c LEFT JOIN users u ON u.id = c.created_by
         LEFT JOIN chatbot_pages p ON p.chatbot_id = c.id
        WHERE c.status = 'live' AND c.archived_at IS NULL ORDER BY c."createdAt"`,
  );
  const planOfCreator = new Map(
    report.subscriptions.map((s) => [s.userId, s.plan]),
  );
  const catalogue = await dataSource.query(
    `SELECT key, "includedSeats", "seatsRequired" FROM plans`,
  );
  const planByKey = new Map<
    string,
    { includedSeats: number; seatsRequired: boolean }
  >(
    catalogue.map(
      (p: { key: string; includedSeats: number; seatsRequired: boolean }) => [
        p.key,
        p,
      ],
    ),
  );
  for (const bot of bots) {
    const planKey = planOfCreator.get(bot.createdBy) ?? STARTING_PLAN_KEY;
    const plan = planByKey.get(planKey) ?? {
      includedSeats: 5,
      seatsRequired: true,
    };
    const existingSeats: Array<{ email: string | null }> =
      await dataSource.query(
        `SELECT "assigneeEmail" AS email FROM seats WHERE "chatbotId" = $1 AND kind = 'included' AND status <> 'cancelled'`,
        [bot.id],
      );
    const people = await plans.peopleInOrder(bot.id);
    const held = new Set(existingSeats.map((s) => s.email).filter(Boolean));
    const free = people.filter((p) => !held.has(p.email));
    const newSeats = Math.max(0, plan.includedSeats - existingSeats.length);
    const seats = [
      ...existingSeats.map((s) => ({
        email: s.email,
        why: 'already has a seat',
      })),
      ...Array.from({ length: newSeats }, (_, i) => ({
        email: free[i]?.email ?? null,
        why: free[i]?.why ?? 'unassigned',
      })),
    ];
    const seated = new Set(seats.map((s) => s.email).filter(Boolean));
    const access = bot.access ?? 'public';
    report.assistants.push({
      chatbotId: bot.id,
      name: bot.name,
      creatorEmail: bot.creatorEmail,
      plan: planKey,
      access,
      seatsRequired: plan.seatsRequired,
      seats,
      blocked:
        plan.seatsRequired && access !== 'public'
          ? people
              .filter((p) => !seated.has(p.email))
              .map((p) => ({ email: p.email, why: p.why }))
          : [],
      organisationAccess: access === 'organisation',
    });
  }

  if (dryRun) return report;

  const note = 'CR1 starting point (billing:backfill)';
  const start = new Date().toISOString().slice(0, 10);
  for (const sub of report.subscriptions.filter((s) => !s.existing)) {
    await plans.setPlan(
      sub.userId,
      { planKey: sub.plan, periodStart: start, note },
      actorUserId,
    );
  }
  for (const grant of report.tokens.filter((t) => !t.existing)) {
    await tokens.assign(
      grant.userId,
      { amount: grant.amount, renewMonthly: true, note },
      actorUserId,
    );
  }
  for (const bot of report.assistants) {
    await plans.ensureIncludedSeats(bot.chatbotId, undefined, actorUserId);
  }
  return report;
}
