import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import axios from 'axios';
import { DataSource } from 'typeorm';
import { SESService } from 'src/aws/service/ses.service';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import { CostAlertKind } from '../enum/billing.enum';
import { microsToUsd } from '../util/pricing.util';
import { periodStarts } from './cost-report.service';
import { USAGE_EVENT_UNPRICED } from './usage-event.service';

const DAY_MS = 86_400_000;
const usd = (micros: number | string) => `$${microsToUsd(micros).toFixed(2)}`;

/**
 * Alerts to Ally about cost (CR1 Part A): email to every admin holding `manage_costs`, a Slack
 * line, and a banner on the Costs screen (from `cost_alerts`). Each alert fires once per subject
 * per day — the unique key on `cost_alerts` is the "once".
 *
 *   - the day's total over the daily budget;
 *   - an assistant costing more than N× its 7-day daily average today AND over the spike minimum
 *     ($1, decided at the CR1 plan stop), so a quiet assistant's first busy day isn't a spike;
 *   - one conversation over the conversation threshold;
 *   - a model that isn't in the list (its usage is recorded as unpriced);
 *   - the usage feed is off (ally-ai has no LLM_USAGE__QUEUE_URL): nothing is being metered.
 */
@Injectable()
export class CostAlertService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = LoggerService.getInstance(CostAlertService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AppConfigService,
    @Optional() private readonly ses?: SESService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('hourly', 'billing-cost-alerts', () =>
      this.runChecks(),
    );
  }

  /** Startup: a production that meters nothing must say so loudly (CR1 plan stop, decision 7). */
  onApplicationBootstrap(): void {
    if (this.config.nodeEnv !== 'production') return;
    void this.checkUsageFeed().catch(() => undefined);
  }

  async runChecks(now = new Date()): Promise<void> {
    const checks: Array<[string, () => Promise<unknown>]> = [
      ['daily budget', () => this.checkDailyBudget(now)],
      ['assistant spikes', () => this.checkSpikes(now)],
      ['conversation cost', () => this.checkConversations(now)],
      ['usage feed', () => this.checkUsageFeed(now)],
    ];
    for (const [name, check] of checks) {
      try {
        await check();
      } catch (error) {
        this.logger.warn(
          `Cost alert check "${name}" failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }
  }

  async checkDailyBudget(now = new Date()): Promise<boolean> {
    const { day } = periodStarts(now);
    const [row] = await this.dataSource.query(
      `SELECT coalesce(sum(e."costMicros"), 0) AS total, s."dailyBudgetMicros" AS budget
         FROM cost_settings s LEFT JOIN usage_events e ON e."createdAt" >= $1
        WHERE s.id = 1 GROUP BY s."dailyBudgetMicros"`,
      [day],
    );
    if (
      !row ||
      Number(row.budget) <= 0 ||
      Number(row.total) <= Number(row.budget)
    ) {
      return false;
    }
    return this.fire(
      CostAlertKind.DAILY_BUDGET,
      'all',
      now,
      `Ally's AI costs today are ${usd(row.total)}, over the daily budget of ${usd(row.budget)}.`,
      { total: Number(row.total), budget: Number(row.budget) },
    );
  }

  async checkSpikes(now = new Date()): Promise<number> {
    const { day } = periodStarts(now);
    const weekAgo = new Date(day.getTime() - 7 * DAY_MS);
    const rows: Array<Record<string, string>> = await this.dataSource.query(
      `WITH s AS (SELECT "spikeMultiplier" AS m, "spikeMinMicros" AS floor FROM cost_settings WHERE id = 1),
            today AS (
              SELECT "chatbotId", sum("costMicros") AS cost FROM usage_events
               WHERE "createdAt" >= $1 AND "chatbotId" IS NOT NULL GROUP BY "chatbotId"),
            past AS (
              SELECT "chatbotId", coalesce(sum("costMicros"), 0) / 7.0 AS avg FROM usage_events
               WHERE "createdAt" >= $2 AND "createdAt" < $1 AND "chatbotId" IS NOT NULL GROUP BY "chatbotId")
       SELECT t."chatbotId", t.cost, coalesce(p.avg, 0) AS avg, c.name
         FROM today t CROSS JOIN s
         LEFT JOIN past p ON p."chatbotId" = t."chatbotId"
         LEFT JOIN chatbots c ON c.id = t."chatbotId"
        WHERE t.cost > s.floor AND t.cost > s.m * coalesce(p.avg, 0)`,
      [day, weekAgo],
    );
    let fired = 0;
    for (const row of rows) {
      const sent = await this.fire(
        CostAlertKind.ASSISTANT_SPIKE,
        row.chatbotId,
        now,
        `"${row.name ?? row.chatbotId}" has cost ${usd(row.cost)} today, against a 7-day average of ${usd(row.avg)} a day.`,
        {
          chatbotId: row.chatbotId,
          cost: Number(row.cost),
          average: Number(row.avg),
        },
      );
      if (sent) fired += 1;
    }
    return fired;
  }

  async checkConversations(now = new Date()): Promise<number> {
    const { day } = periodStarts(now);
    const rows: Array<Record<string, string>> = await this.dataSource.query(
      `SELECT e."conversationId", min(e."chatbotId"::text) AS "chatbotId", sum(e."costMicros") AS cost
         FROM usage_events e, cost_settings s
        WHERE s.id = 1 AND e."createdAt" >= $1 AND e."conversationId" IS NOT NULL
          AND e.channel IN ('bot_page','bubble','whatsapp')
        GROUP BY e."conversationId", s."conversationAlertMicros"
       HAVING sum(e."costMicros") > s."conversationAlertMicros"`,
      [new Date(day.getTime() - DAY_MS)],
    );
    let fired = 0;
    for (const row of rows) {
      const sent = await this.fire(
        CostAlertKind.CONVERSATION_COST,
        row.conversationId,
        now,
        `One conversation has cost ${usd(row.cost)} (assistant ${row.chatbotId}, conversation ${row.conversationId}).`,
        {
          conversationId: row.conversationId,
          chatbotId: row.chatbotId,
          cost: Number(row.cost),
        },
      );
      if (sent) fired += 1;
    }
    return fired;
  }

  @OnEvent(USAGE_EVENT_UNPRICED, { async: true })
  async onUnpriced(payload: {
    provider: string | null;
    model: string;
    at?: Date;
  }): Promise<void> {
    try {
      await this.fire(
        CostAlertKind.UNPRICED_MODEL,
        `${payload.provider ?? '?'}/${payload.model}`.slice(0, 200),
        new Date(),
        `Usage was recorded for "${payload.model}" (${payload.provider ?? 'unknown provider'}), which isn't in Ally admin → Models. Add it with a price so its cost is counted.`,
        { provider: payload.provider, model: payload.model },
      );
    } catch (error) {
      this.logger.warn(
        `Unpriced-model alert failed: ${error instanceof Error ? error.message : ''}`,
      );
    }
  }

  /** ally-ai reports `usage_feed: off` on its health endpoint when it has no queue to send usage to. */
  async checkUsageFeed(now = new Date()): Promise<boolean> {
    if (this.config.nodeEnv !== 'production' || !this.config.ai.apiUrl)
      return false;
    let feed: string | undefined;
    try {
      const response = await axios.get(`${this.config.ai.apiUrl}/api/health`, {
        timeout: 5_000,
      });
      feed = response.data?.usage_feed;
    } catch {
      return false; // ally-ai unreachable is someone else's alert
    }
    if (feed !== 'off') return false;
    this.logger.error(
      'LLM usage feed is OFF: ally-ai has no LLM_USAGE__QUEUE_URL, so Ally is not metering costs or tokens.',
    );
    return this.fire(
      CostAlertKind.USAGE_FEED_OFF,
      'ally-ai',
      now,
      'The LLM usage feed is off: ally-ai has no LLM_USAGE__QUEUE_URL, so no AI cost or token use is being recorded.',
      null,
    );
  }

  /** Sends once per (kind, subject, day). True when this call sent it. */
  async fire(
    kind: CostAlertKind,
    subjectKey: string,
    now: Date,
    message: string,
    detail: Record<string, unknown> | null,
  ): Promise<boolean> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO cost_alerts (kind, "subjectKey", day, detail)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (kind, "subjectKey", day) DO NOTHING RETURNING id`,
      [
        kind,
        subjectKey,
        now.toISOString().slice(0, 10),
        JSON.stringify({ message, ...(detail ?? {}) }),
      ],
    );
    if (!rows.length) return false;
    this.events?.emit('exception', {
      statusCode: 200,
      timestamp: now.toISOString(),
      path: 'billing/costs',
      message,
      type: `Cost alert: ${kind}`,
    });
    const recipients = await this.recipients();
    if (recipients.length && this.ses) {
      await this.ses
        .sendEmail({
          to: recipients,
          subject: `Ally costs: ${message.slice(0, 80)}`,
          body: `${message}\n\nSee Ally admin → Costs.`,
          purpose: 'billing-cost-alert',
          maskRecipientsInLog: true,
          alertOnFailure: false,
        })
        .catch(() => false);
    }
    return true;
  }

  private async recipients(): Promise<string[]> {
    const rows: Array<{ email: string }> = await this.dataSource.query(
      `SELECT DISTINCT u.email FROM admin_feature_toggles t JOIN users u ON u.id = t."userId"
        WHERE t."featureKey" = 'manage_costs' AND t.enabled = true AND u.email IS NOT NULL`,
    );
    return rows.map((row) => row.email);
  }
}
