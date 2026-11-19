import { DataSource } from 'typeorm';
import { BILLING_ENTITIES } from './billing-entities';
import {
  closeTestDataSource,
  describePg,
  openTestDataSource,
  resetTables,
  seedChatbot,
} from '../../whatsapp/shared-store/test/shared-store.pg';
import {
  BillingModelType,
  BillingStatus,
  CostAlertKind,
  UsageChannel,
  UsageKind,
} from '../enum/billing.enum';
import { BillingAuditService } from '../service/billing-audit.service';
import { BillingCatalogueService } from '../service/billing-catalogue.service';
import { CostAlertService } from '../service/cost-alert.service';
import { CostReportService } from '../service/cost-report.service';
import { UsageEventService } from '../service/usage-event.service';
import { WhatsAppPricingService } from '../service/whatsapp-pricing.service';

/**
 * CR1 Part A on real Postgres: recording, idempotency, price versions, repricing, the delete rule,
 * WhatsApp fees, the Costs totals and alerts that fire once. Runs only with CHATBOT_STORE_TEST_DB.
 */
describePg('Billing: costs and models (Postgres)', () => {
  let dataSource: DataSource;
  let usage: UsageEventService;
  let catalogue: BillingCatalogueService;
  let reports: CostReportService;
  let alerts: CostAlertService;
  let bot: string;
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const events = {
    emit: (name: string, payload: unknown) => emitted.push({ name, payload }),
  };

  beforeAll(async () => {
    dataSource = await openTestDataSource(BILLING_ENTITIES);
    usage = new UsageEventService(dataSource, events as never);
    const audit = new BillingAuditService(dataSource);
    catalogue = new BillingCatalogueService(dataSource, audit, usage);
    reports = new CostReportService(dataSource);
    alerts = new CostAlertService(
      dataSource,
      { nodeEnv: 'test', ai: {} } as never,
      { sendEmail: async () => true } as never,
      events as never,
    );
  });
  afterAll(() => closeTestDataSource(dataSource));

  beforeEach(async () => {
    await resetTables(dataSource);
    await dataSource.query(
      `TRUNCATE usage_events, cost_alerts, billing_audit, fixed_costs`,
    );
    await dataSource.query(
      `DELETE FROM billing_models WHERE model LIKE 'test-%'; DELETE FROM billing_model_prices WHERE version > 1`,
    );
    await dataSource.query(
      `UPDATE cost_settings SET "dailyBudgetMicros" = 20000000, "conversationAlertMicros" = 500000,
              "spikeMultiplier" = 5, "spikeMinMicros" = 1000000`,
    );
    usage.invalidateCatalogue();
    emitted.length = 0;
    bot = await seedChatbot(dataSource);
  });

  const call = (
    over: Partial<Parameters<UsageEventService['record']>[0]> = {},
  ) =>
    usage.record({
      runId: 'run-1',
      kind: UsageKind.CUSTOMER_REPLY,
      channel: UsageChannel.BOT_PAGE,
      chatbotId: bot,
      conversationId: 'conv-1',
      provider: 'openai',
      model: 'gpt-5-mini',
      inputTokens: 10_000,
      outputTokens: 1_000,
      ...over,
    });

  it('prices a call, charges it to the assistant’s creator, and records it once', async () => {
    const first = await call();
    expect(first?.costMicros).toBeCloseTo(10_000 * 0.25 + 1_000 * 2, 3); // $0.0045
    expect(first?.creatorUserId).toBe(1);
    expect(await call()).toBeNull(); // a redelivered SQS message
    expect(await call({ seq: 1 })).not.toBeNull(); // the run's next call
    const [{ n }] = await dataSource.query(
      `SELECT count(*) AS n FROM usage_events`,
    );
    expect(Number(n)).toBe(2);
  });

  it('matches a dated snapshot to its model', async () => {
    const event = await call({
      model: 'gpt-4o-mini-2024-07-18',
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(event?.modelName).toBe('gpt-4o-mini-2024-07-18');
    expect(event?.costMicros).toBeCloseTo(150_000, 3);
  });

  it('records an unknown model as unpriced, alerts, and prices it once it is added', async () => {
    const event = await call({
      model: 'test-new-model',
      inputTokens: 2_000_000,
      outputTokens: 0,
    });
    expect(event?.costMicros).toBeNull();
    expect(emitted.map((e) => e.name)).toContain('billing.usage.unpriced');
    expect(await catalogue.unknownModels()).toEqual([
      expect.objectContaining({ model: 'test-new-model', events: 1 }),
    ]);

    await catalogue.addModel(
      {
        provider: 'openai',
        model: 'test-new-model',
        type: BillingModelType.CHAT,
        price: {
          inputPerMillionUsd: 1,
          outputPerMillionUsd: 2,
          effectiveFrom: '2026-01-01',
        },
        note: 'New model from OpenAI',
      },
      9,
    );
    const [row] = await dataSource.query(
      `SELECT "costMicros" FROM usage_events WHERE id = $1`,
      [event!.id],
    );
    expect(Number(row.costMicros)).toBe(2_000_000);
  });

  it('a new price version applies from its date; old usage keeps its price', async () => {
    const old = await call({ occurredAt: new Date('2026-11-10T10:00:00Z') });
    const [model] = await catalogue
      .listModels()
      .then((rows) => rows.filter((r) => r.model === 'gpt-5-mini'));
    await catalogue.updatePrice(
      model.id,
      {
        inputPerMillionUsd: 0.5,
        outputPerMillionUsd: 4,
        effectiveFrom: '2026-11-15',
        note: 'Price rise',
      },
      9,
    );
    const later = await call({
      runId: 'run-2',
      occurredAt: new Date('2026-11-16T10:00:00Z'),
    });
    const [kept] = await dataSource.query(
      `SELECT "costMicros" FROM usage_events WHERE id = $1`,
      [old!.id],
    );
    expect(Number(kept.costMicros)).toBeCloseTo(4_500, 3);
    expect(later?.costMicros).toBeCloseTo(9_000, 3);
    const { versions, history } = await catalogue.priceHistory(model.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(history[0]).toMatchObject({
      action: 'price',
      note: 'Price rise',
      actorUserId: 9,
    });
  });

  it('deletes only a model nothing was recorded against; otherwise it must be retired', async () => {
    const added = await catalogue.addModel(
      {
        provider: 'openai',
        model: 'test-typo',
        type: BillingModelType.CHAT,
        price: { inputPerMillionUsd: 1 },
        note: 'Oops',
      },
      9,
    );
    await expect(catalogue.deleteModel(added.id, '', 9)).rejects.toThrow(
      'note',
    );
    await call({ model: 'test-typo' });
    await expect(catalogue.deleteModel(added.id, 'Mistake', 9)).rejects.toThrow(
      'Retire it instead',
    );
    const retired = await catalogue.setStatus(
      added.id,
      BillingStatus.RETIRED,
      'Gone',
      9,
    );
    expect(retired.status).toBe('retired');
    expect(retired.usageCount).toBe(1);

    const fresh = await catalogue.addModel(
      {
        provider: 'openai',
        model: 'test-unused',
        type: BillingModelType.CHAT,
        price: { inputPerMillionUsd: 1 },
        note: 'Try',
      },
      9,
    );
    await expect(
      catalogue.deleteModel(fresh.id, 'Added by mistake', 9),
    ).resolves.toEqual({ deleted: true });
  });

  it('records a billable WhatsApp message at the India rate, once', async () => {
    const [contact] = await dataSource.query(
      `INSERT INTO chatbot_contacts (chatbot_id) VALUES ($1) RETURNING id`,
      [bot],
    );
    const [conversation] = await dataSource.query(
      `INSERT INTO chatbot_conversations (chatbot_id, contact_id, channel, started_at, last_message_at)
       VALUES ($1, $2, 'whatsapp', now(), now()) RETURNING id`,
      [bot, contact.id],
    );
    await dataSource.query(
      `INSERT INTO chatbot_messages (conversation_id, channel, direction, role, text, status, provider_message_id)
       VALUES ($1, 'whatsapp', 'outbound', 'assistant', 'hi', 'sent', 'wamid.X')`,
      [conversation.id],
    );
    const pricing = new WhatsAppPricingService(dataSource, catalogue, usage);
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: 'wamid.X',
                    status: 'delivered',
                    timestamp: '1795000000',
                    recipient_id: '919000000001',
                    pricing: { billable: true, category: 'utility' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(await pricing.recordStatuses(body)).toBe(1);
    expect(await pricing.recordStatuses(body)).toBe(0);
    const [row] = await dataSource.query(
      `SELECT * FROM usage_events WHERE kind = 'whatsapp'`,
    );
    expect(row).toMatchObject({
      chatbotId: bot,
      channel: 'whatsapp',
      conversationId: conversation.id,
    });
    expect(Number(row.costMicros)).toBe(1_400);
    expect(row.detail).toMatchObject({ category: 'utility', country: 'IN' });
  });

  it('totals, breakdowns and the export', async () => {
    await call();
    await call({
      runId: 'run-2',
      kind: UsageKind.CRISIS_CHECK,
      model: 'gpt-6-luna',
      inputTokens: 1_000,
      outputTokens: 100,
    });
    await call({
      runId: 'run-3',
      channel: UsageChannel.OWNER,
      kind: UsageKind.TRY_IT,
      conversationId: null,
    });
    const overview = await reports.overview();
    expect(overview.today).toBeCloseTo(0.0045 * 2 + 0.00015, 6);
    expect(overview.customerConversations).toBe(1);
    const byKind = await reports.breakdown('kind', {
      from: new Date(Date.now() - 86_400_000),
      to: new Date(Date.now() + 1000),
    });
    expect(byKind.map((r) => r.key).sort()).toEqual([
      'crisis_check',
      'customer_reply',
      'try_it',
    ]);
    const csv = await reports.exportCsv({
      from: new Date(Date.now() - 86_400_000),
      to: new Date(Date.now() + 1000),
    });
    expect(csv.split('\n')[0]).toContain('cost_usd');
    expect(csv.trim().split('\n')).toHaveLength(4);
  });

  it('budget, spike and conversation alerts fire once a day', async () => {
    await dataSource.query(
      `UPDATE cost_settings SET "dailyBudgetMicros" = 1000, "conversationAlertMicros" = 1000, "spikeMinMicros" = 1000`,
    );
    await call();
    expect(await alerts.checkDailyBudget()).toBe(true);
    expect(await alerts.checkDailyBudget()).toBe(false);
    expect(await alerts.checkSpikes()).toBe(1);
    expect(await alerts.checkSpikes()).toBe(0);
    expect(await alerts.checkConversations()).toBe(1);
    expect(await alerts.checkConversations()).toBe(0);
    const kinds = (
      await dataSource.query(`SELECT kind FROM cost_alerts ORDER BY kind`)
    ).map((r: { kind: string }) => r.kind);
    expect(kinds).toEqual(
      [
        CostAlertKind.ASSISTANT_SPIKE,
        CostAlertKind.CONVERSATION_COST,
        CostAlertKind.DAILY_BUDGET,
      ].sort(),
    );
  });

  it('a spike needs the assistant over the $1 floor too', async () => {
    await call(); // $0.0045 today, nothing before: 5× of zero, but under $1
    expect(await alerts.checkSpikes()).toBe(0);
  });
});
