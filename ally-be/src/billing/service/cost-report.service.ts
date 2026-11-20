import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  DEFAULT_PLAN_KEY,
  UsageChannel,
  UsageKind,
} from '../enum/billing.enum';
import { microsToUsd } from '../util/pricing.util';

export type CostDimension =
  | 'publisher'
  | 'assistant'
  | 'kind'
  | 'model'
  | 'channel';

export interface Period {
  from: Date;
  to: Date;
}

const CUSTOMER_CHANNELS = [
  UsageChannel.BOT_PAGE,
  UsageChannel.BUBBLE,
  UsageChannel.WHATSAPP,
];

const DAY_MS = 86_400_000;

/** Start of today, this week (Monday) and this month, in UTC. */
export function periodStarts(now = new Date()) {
  const day = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const weekday = (day.getUTCDay() + 6) % 7;
  const week = new Date(day.getTime() - weekday * DAY_MS);
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { day, week, month };
}

export function parsePeriod(from?: string, to?: string): Period {
  const { month } = periodStarts();
  const start = from ? new Date(from) : month;
  const end = to ? new Date(to) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new BadRequestException('Use dates like 2026-11-01.');
  }
  if (end <= start)
    throw new BadRequestException('The end must be after the start.');
  if (end.getTime() - start.getTime() > 400 * DAY_MS) {
    throw new BadRequestException('Pick a period of at most 400 days.');
  }
  return { from: start, to: end };
}

/**
 * Ally admin → Costs (CR1 Part A). Super admins only. Dollars appear here and nowhere a customer
 * or owner can see. Everything is read from `usage_events`; "Other Ally products" (Learn, Debrief,
 * helpline…) are estimated from `llm_usage` at today's prices.
 */
@Injectable()
export class CostReportService {
  constructor(private readonly dataSource: DataSource) {}

  async overview(now = new Date()) {
    const { day, week, month } = periodStarts(now);
    const [totals] = await this.dataSource.query(
      `SELECT
         coalesce(sum("costMicros") FILTER (WHERE "createdAt" >= $1), 0) AS today,
         coalesce(sum("costMicros") FILTER (WHERE "createdAt" >= $2), 0) AS week,
         coalesce(sum("costMicros") FILTER (WHERE "createdAt" >= $3), 0) AS month,
         coalesce(sum("costMicros") FILTER (WHERE "createdAt" >= $3 AND kind = 'whatsapp'), 0) AS whatsapp,
         count(*) FILTER (WHERE "createdAt" >= $3 AND "costMicros" IS NULL) AS unpriced
       FROM usage_events WHERE "createdAt" >= least($1, $2, $3)`,
      [day, week, month],
    );
    const [fixed] = await this.dataSource.query(
      `SELECT coalesce(sum("amountMicros"), 0) AS total FROM fixed_costs WHERE month = $1`,
      [month.toISOString().slice(0, 10)],
    );
    const other = await this.otherProducts({ from: month, to: now });
    const perUnit = await this.perUnit({ from: month, to: now });
    const settings = await this.dataSource.query(
      `SELECT "dailyBudgetMicros", "conversationAlertMicros", "spikeMultiplier", "spikeMinMicros" FROM cost_settings WHERE id = 1`,
    );
    return {
      today: microsToUsd(totals.today),
      week: microsToUsd(totals.week),
      month: microsToUsd(totals.month),
      whatsappMonth: microsToUsd(totals.whatsapp),
      fixedMonth: microsToUsd(fixed.total),
      otherProductsMonth: other,
      monthWithFixed:
        microsToUsd(totals.month) + microsToUsd(fixed.total) + other,
      unpricedEventsMonth: Number(totals.unpriced),
      ...perUnit,
      dailyBudget: settings[0]
        ? microsToUsd(settings[0].dailyBudgetMicros)
        : null,
      settings: settings[0]
        ? {
            dailyBudget: microsToUsd(settings[0].dailyBudgetMicros),
            conversationAlert: microsToUsd(settings[0].conversationAlertMicros),
            spikeMultiplier: Number(settings[0].spikeMultiplier),
            spikeMin: microsToUsd(settings[0].spikeMinMicros),
          }
        : null,
      alerts: await this.recentAlerts(),
      periodStarts: { today: day, week, month },
    };
  }

  /** Cost per day, assistants' calls and WhatsApp apart. */
  async trend(days = 30, now = new Date()) {
    const n = Math.min(Math.max(1, Math.round(days)), 400);
    const { day } = periodStarts(now);
    const from = new Date(day.getTime() - (n - 1) * DAY_MS);
    const rows: Array<{ d: string; ai: string; whatsapp: string }> =
      await this.dataSource.query(
        `SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS d,
                coalesce(sum("costMicros") FILTER (WHERE kind <> 'whatsapp'), 0) AS ai,
                coalesce(sum("costMicros") FILTER (WHERE kind = 'whatsapp'), 0) AS whatsapp
           FROM usage_events WHERE "createdAt" >= $1
          GROUP BY 1 ORDER BY 1`,
        [from],
      );
    const byDay = new Map(rows.map((row) => [row.d, row]));
    return Array.from({ length: n }, (_, i) => {
      const d = new Date(from.getTime() + i * DAY_MS)
        .toISOString()
        .slice(0, 10);
      const row = byDay.get(d);
      return {
        day: d,
        ai: microsToUsd(row?.ai ?? 0),
        whatsapp: microsToUsd(row?.whatsapp ?? 0),
      };
    });
  }

  async breakdown(dimension: CostDimension, period: Period, limit = 50) {
    const columns: Record<
      CostDimension,
      { key: string; label: string; join?: string }
    > = {
      publisher: {
        key: `e."creatorUserId"::text`,
        label: `coalesce(nullif(trim(u.name), ''), u.email, 'Unknown')`,
        join: `LEFT JOIN users u ON u.id = e."creatorUserId"`,
      },
      assistant: {
        key: `e."chatbotId"::text`,
        label: `coalesce(c.name, 'Setup drafts')`,
        join: `LEFT JOIN chatbots c ON c.id = e."chatbotId"`,
      },
      kind: { key: 'e.kind', label: 'e.kind' },
      model: {
        key: `coalesce(e."modelName", e.kind)`,
        label: `coalesce(e."modelName", e.kind)`,
      },
      channel: { key: 'e.channel', label: 'e.channel' },
    };
    const column = columns[dimension];
    if (!column) throw new BadRequestException('Unknown breakdown.');
    const rows: Array<Record<string, string>> = await this.dataSource.query(
      `SELECT ${column.key} AS key, ${column.label} AS label,
              coalesce(sum(e."costMicros"), 0) AS cost,
              count(*) AS calls,
              coalesce(sum(e."inputTokens" + e."outputTokens"), 0) AS tokens,
              count(*) FILTER (WHERE e."costMicros" IS NULL) AS unpriced
         FROM usage_events e ${column.join ?? ''}
        WHERE e."createdAt" >= $1 AND e."createdAt" < $2
        GROUP BY 1, 2 ORDER BY cost DESC LIMIT $3`,
      [period.from, period.to, limit],
    );
    return rows.map((row) => ({
      key: row.key,
      label: row.label,
      cost: microsToUsd(row.cost),
      calls: Number(row.calls),
      tokens: Number(row.tokens),
      unpriced: Number(row.unpriced),
    }));
  }

  /** Cost per customer conversation and per customer message, this period. */
  async perUnit(period: Period) {
    const [row] = await this.dataSource.query(
      `SELECT coalesce(sum("costMicros"), 0) AS cost,
              count(DISTINCT "conversationId") AS conversations,
              count(DISTINCT "runId") FILTER (WHERE kind = 'customer_reply') AS messages
         FROM usage_events
        WHERE "createdAt" >= $1 AND "createdAt" < $2 AND channel = ANY($3)`,
      [period.from, period.to, CUSTOMER_CHANNELS],
    );
    const cost = microsToUsd(row.cost);
    const conversations = Number(row.conversations);
    const messages = Number(row.messages);
    return {
      customerConversations: conversations,
      customerMessages: messages,
      costPerConversation: conversations ? cost / conversations : null,
      costPerMessage: messages ? cost / messages : null,
    };
  }

  /** One assistant: this period by kind, and its most expensive conversations. */
  async assistant(chatbotId: string, period: Period) {
    const [bot] = await this.dataSource.query(
      `SELECT c.id, c.name, c.created_by AS "creatorUserId", u.email AS "creatorEmail"
         FROM chatbots c LEFT JOIN users u ON u.id = c.created_by WHERE c.id = $1`,
      [chatbotId],
    );
    const byKind: Array<Record<string, string>> = await this.dataSource.query(
      `SELECT kind, coalesce(sum("costMicros"), 0) AS cost, count(*) AS calls
         FROM usage_events WHERE "chatbotId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3
        GROUP BY kind ORDER BY cost DESC`,
      [chatbotId, period.from, period.to],
    );
    const top: Array<Record<string, string>> = await this.dataSource.query(
      `SELECT "conversationId", min(channel) AS channel, coalesce(sum("costMicros"), 0) AS cost,
              count(DISTINCT "runId") AS runs, min("createdAt") AS started
         FROM usage_events
        WHERE "chatbotId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3
          AND "conversationId" IS NOT NULL AND channel = ANY($4)
        GROUP BY "conversationId" ORDER BY cost DESC LIMIT 10`,
      [chatbotId, period.from, period.to, CUSTOMER_CHANNELS],
    );
    return {
      assistant: bot ?? { id: chatbotId, name: null },
      total: byKind.reduce((sum, row) => sum + microsToUsd(row.cost), 0),
      byKind: byKind.map((row) => ({
        kind: row.kind as UsageKind,
        cost: microsToUsd(row.cost),
        calls: Number(row.calls),
      })),
      topConversations: top.map((row) => ({
        conversationId: row.conversationId,
        channel: row.channel,
        cost: microsToUsd(row.cost),
        messages: Number(row.runs),
        started: row.started,
      })),
    };
  }

  /** Learn, Debrief, helpline and the rest, at today's prices (an estimate: llm_usage keeps no price). */
  async otherProducts(period: Period): Promise<number> {
    try {
      const [row] = await this.dataSource.query(
        `WITH current_price AS (
           SELECT DISTINCT ON (p."modelId") m.provider, m.model, p.*
             FROM billing_model_prices p JOIN billing_models m ON m.id = p."modelId"
            WHERE p."effectiveFrom" <= now()::date
            ORDER BY p."modelId", p."effectiveFrom" DESC, p.version DESC)
         SELECT coalesce(sum(
                  (greatest(u."promptTokens" - coalesce(u."cachedTokens", 0), 0) * coalesce(cp."inputPer1MMicros", 0)
                   + coalesce(u."cachedTokens", 0) * coalesce(cp."cachedInputPer1MMicros", cp."inputPer1MMicros", 0)
                   + u."completionTokens" * coalesce(cp."outputPer1MMicros", 0)) / 1000000.0
                  + coalesce(u."audioMs", 0) / 60000.0 * coalesce(cp."unitPriceMicros", 0)
                ), 0) AS cost
           FROM llm_usage u
           JOIN current_price cp ON cp.model = u.model
          WHERE u."occurredAt" >= $1 AND u."occurredAt" < $2
            AND NOT (u.metadata ? 'run_id' AND u.metadata ? 'kind')`,
        [period.from, period.to],
      );
      return microsToUsd(row?.cost ?? 0);
    } catch {
      return 0;
    }
  }

  /**
   * Against plans (CR1 A4): each plan's cost this period beside what it earns at the prices entered
   * on Ally admin → Plans (plan price × subscribers, extra seats × their seat price). Plans without
   * a price earn nothing here, so their margin reads as the cost.
   */
  async planMargins(period: Period) {
    const months = Math.max(
      1,
      (period.to.getTime() - period.from.getTime()) / (30 * DAY_MS),
    );
    const plans: Array<Record<string, string | null>> =
      await this.dataSource.query(
        // A creator with no subscription is on the default plan, so their cost belongs there too.
        `SELECT p.id, p.key, p.name, p."priceMicros",
              count(DISTINCT s."userId") FILTER (WHERE s.status = 'active')
                + CASE WHEN p.key = $3 THEN
                    (SELECT count(DISTINCT c.created_by) FROM chatbots c
                      WHERE c.created_by IS NOT NULL
                        AND NOT EXISTS (SELECT 1 FROM subscriptions s3 WHERE s3."userId" = c.created_by))
                  ELSE 0 END AS subscribers,
              coalesce((SELECT sum(e."costMicros") FROM usage_events e
                          LEFT JOIN subscriptions s2 ON s2."userId" = e."creatorUserId"
                         WHERE e."creatorUserId" IS NOT NULL
                           AND (s2."planId" = p.id OR (s2.id IS NULL AND p.key = $3))
                           AND e."createdAt" >= $1 AND e."createdAt" < $2), 0) AS cost
         FROM plans p LEFT JOIN subscriptions s ON s."planId" = p.id
        GROUP BY p.id ORDER BY p."createdAt"`,
        [period.from, period.to, DEFAULT_PLAN_KEY],
      );
    const seats: Array<Record<string, string | null>> =
      await this.dataSource.query(
        `SELECT t.key, t.name, t."priceMicros",
              count(s.id) FILTER (WHERE s.kind = 'extra' AND s.status IN ('active','expiring')) AS extra,
              count(s.id) FILTER (WHERE s.kind = 'included' AND s.status IN ('active','expiring')) AS included
         FROM seat_types t LEFT JOIN seats s ON s."seatTypeId" = t.id
        GROUP BY t.id ORDER BY t.rank`,
      );
    const seatRows = seats.map((row) => {
      const price =
        row.priceMicros === null ? null : microsToUsd(row.priceMicros);
      return {
        key: row.key,
        name: row.name,
        price,
        extraSeats: Number(row.extra),
        includedSeats: Number(row.included),
        earns: price === null ? 0 : price * Number(row.extra) * months,
      };
    });
    const planRows = plans.map((row) => {
      const price =
        row.priceMicros === null ? null : microsToUsd(row.priceMicros);
      const earns =
        price === null ? 0 : price * Number(row.subscribers) * months;
      const cost = microsToUsd(row.cost);
      return {
        key: row.key,
        name: row.name,
        price,
        subscribers: Number(row.subscribers),
        cost,
        earns,
        margin: earns - cost,
        costPerSubscriber: Number(row.subscribers)
          ? cost / Number(row.subscribers)
          : null,
      };
    });
    return { months, plans: planRows, seatTypes: seatRows };
  }

  async recentAlerts(limit = 20) {
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT kind, "subjectKey", day, detail, "createdAt" FROM cost_alerts
        WHERE "createdAt" >= now() - interval '7 days' ORDER BY "createdAt" DESC LIMIT $1`,
      [limit],
    );
    return rows;
  }

  /** A period's usage events as CSV (no message text; ids and numbers only). */
  async exportCsv(period: Period): Promise<string> {
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT e."createdAt", e."creatorUserId", e."chatbotId", c.name AS assistant, e."conversationId",
              e.channel, e.kind, e."runId", e.step, e.seq, e.provider, e."modelName",
              e."inputTokens", e."cachedTokens", e."outputTokens", e.units, e.unit, e."costMicros"
         FROM usage_events e LEFT JOIN chatbots c ON c.id = e."chatbotId"
        WHERE e."createdAt" >= $1 AND e."createdAt" < $2
        ORDER BY e."createdAt" LIMIT 200000`,
      [period.from, period.to],
    );
    const header = [
      'created_at',
      'creator_user_id',
      'assistant_id',
      'assistant',
      'conversation_id',
      'channel',
      'kind',
      'run_id',
      'step',
      'seq',
      'provider',
      'model',
      'input_tokens',
      'cached_tokens',
      'output_tokens',
      'units',
      'unit',
      'cost_usd',
    ];
    const lines = rows.map((row) =>
      [
        (row.createdAt as Date)?.toISOString?.() ?? row.createdAt,
        row.creatorUserId,
        row.chatbotId,
        row.assistant,
        row.conversationId,
        row.channel,
        row.kind,
        row.runId,
        row.step,
        row.seq,
        row.provider,
        row.modelName,
        row.inputTokens,
        row.cachedTokens,
        row.outputTokens,
        row.units,
        row.unit,
        row.costMicros === null
          ? ''
          : (Number(row.costMicros) / 1_000_000).toFixed(6),
      ]
        .map(csvCell)
        .join(','),
    );
    return [header.join(','), ...lines].join('\n') + '\n';
  }
}

/** Quote a CSV cell, and neutralise spreadsheet formulas (a name starting with = + - @). */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
