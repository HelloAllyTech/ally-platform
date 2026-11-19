import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CR1 Part A — what every assistant really costs Ally.
 *
 * Tables (all platform-wide, no tenant_id: they are Ally's own books, read only by super admins):
 *   - billing_models        every model or paid service Ally can be billed for, by provider + model id.
 *                           Separate from `llm_models` (the runtime pickers' catalogue), which refuses
 *                           providers no runtime can execute and must not list embeddings or STT.
 *   - billing_model_prices  a model's price, versioned: a change is a new row effective from a date,
 *                           so old usage keeps the price it was recorded with.
 *   - whatsapp_rates        Meta's per-message rates by category and recipient country, versioned alike.
 *   - usage_events          one row per metered call on an assistant (and each billable WhatsApp
 *                           message), idempotent on (runId, kind, step, seq). costMicros NULL = unpriced.
 *   - fixed_costs           hosting, database, subscriptions: entered by hand per month.
 *   - cost_settings         singleton: daily budget and alert thresholds.
 *   - cost_alerts           one row per alert sent, unique per (kind, subject, day): "fires once".
 *   - billing_audit         who changed what, when and why, for every CR1 admin change.
 *
 * Money is in micros (millionths of a US dollar), numeric so a 30-token call at a tenth of a cent
 * per million isn't rounded to zero. Prices are micros per 1M tokens (or per unit).
 *
 * Seeds the starting model list (prices checked 19 Nov 2026, effective 1 Nov 2026), India's WhatsApp
 * rates (effective 1 Oct 2026), the settings agreed at the CR1 plan stop, and grants the new
 * `manage_costs` toggle to every admin who already holds `admin_user_management`.
 */
type Seed = [
  provider: string,
  model: string,
  label: string,
  type: string,
  status: 'active' | 'retired',
  input: number | null,
  cached: number | null,
  output: number | null,
  unitPrice: number | null,
  unit: string | null,
  notes: string | null,
];

const MODELS: Seed[] = [
  // OpenAI
  [
    'openai',
    'gpt-6-luna',
    'GPT-6 Luna',
    'classifier',
    'active',
    0.1,
    0.01,
    0.5,
    null,
    null,
    'Crisis check (Skills Store)',
  ],
  [
    'openai',
    'gpt-5-mini',
    'GPT-5 mini',
    'chat',
    'active',
    0.25,
    0.025,
    2,
    null,
    null,
    'Default for customer replies, setup, checkups and memory',
  ],
  [
    'openai',
    'gpt-5',
    'GPT-5',
    'chat',
    'active',
    1.25,
    0.125,
    10,
    null,
    null,
    null,
  ],
  [
    'openai',
    'gpt-4.1',
    'GPT-4.1',
    'chat',
    'active',
    2,
    0.5,
    8,
    null,
    null,
    null,
  ],
  [
    'openai',
    'gpt-4.1-mini',
    'GPT-4.1 mini',
    'chat',
    'active',
    0.4,
    0.1,
    1.6,
    null,
    null,
    'Helpline turn',
  ],
  [
    'openai',
    'gpt-4o',
    'GPT-4o',
    'chat',
    'active',
    2.5,
    1.25,
    10,
    null,
    null,
    null,
  ],
  [
    'openai',
    'gpt-4o-mini',
    'GPT-4o mini',
    'classifier',
    'active',
    0.15,
    0.075,
    0.6,
    null,
    null,
    'Crisis and translate code default; leaves the OpenAI API on 14 Jan 2027',
  ],
  [
    'openai',
    'text-embedding-3-small',
    'Embedding 3 small',
    'embedding',
    'active',
    0.02,
    null,
    0,
    null,
    null,
    'Knowledge search and indexing',
  ],
  [
    'openai',
    'whisper-1',
    'Whisper',
    'transcription',
    'active',
    null,
    null,
    null,
    0.006,
    'minute',
    null,
  ],
  [
    'openai',
    'tts-1',
    'TTS-1',
    'tts',
    'active',
    null,
    null,
    null,
    15,
    'million_chars',
    null,
  ],
  [
    'openai',
    'gpt-4',
    'GPT-4',
    'chat',
    'retired',
    30,
    null,
    60,
    null,
    null,
    null,
  ],
  [
    'openai',
    'gpt-3.5-turbo',
    'GPT-3.5 Turbo',
    'chat',
    'retired',
    0.5,
    null,
    1.5,
    null,
    null,
    null,
  ],
  ['openai', 'o1', 'o1', 'chat', 'retired', 15, null, 60, null, null, null],
  [
    'openai',
    'o1-mini',
    'o1 mini',
    'chat',
    'retired',
    1.1,
    null,
    4.4,
    null,
    null,
    null,
  ],
  // Anthropic
  [
    'anthropic',
    'claude-sonnet-4-6',
    'Claude Sonnet 4.6',
    'chat',
    'active',
    3,
    0.3,
    15,
    null,
    null,
    'Anthropic default in ally-ai',
  ],
  [
    'anthropic',
    'claude-sonnet-5-5',
    'Claude Sonnet 5.5',
    'chat',
    'active',
    2,
    0.2,
    10,
    null,
    null,
    null,
  ],
  [
    'anthropic',
    'claude-haiku-4-5',
    'Claude Haiku 4.5',
    'chat',
    'active',
    1,
    0.1,
    5,
    null,
    null,
    null,
  ],
  [
    'anthropic',
    'claude-opus-5-5',
    'Claude Opus 5.5',
    'chat',
    'active',
    4,
    0.2,
    20,
    null,
    null,
    null,
  ],
  [
    'anthropic',
    'claude-sonnet-5',
    'Claude Sonnet 5',
    'chat',
    'retired',
    3,
    0.3,
    15,
    null,
    null,
    null,
  ],
  [
    'anthropic',
    'claude-opus-5',
    'Claude Opus 5',
    'chat',
    'retired',
    5,
    0.5,
    25,
    null,
    null,
    null,
  ],
  [
    'anthropic',
    'claude-opus-4-7',
    'Claude Opus 4.7',
    'chat',
    'retired',
    5,
    0.5,
    25,
    null,
    null,
    null,
  ],
  [
    'anthropic',
    'claude-haiku-5-5',
    'Claude Haiku 5.5',
    'chat',
    'retired',
    0.1,
    0.01,
    0.5,
    null,
    null,
    null,
  ],
  // Google
  [
    'gemini',
    'gemini-2.5-pro',
    'Gemini 2.5 Pro',
    'chat',
    'active',
    1.25,
    0.125,
    10,
    null,
    null,
    'Judges and analytics',
  ],
  [
    'gemini',
    'gemini-2.5-flash',
    'Gemini 2.5 Flash',
    'chat',
    'active',
    0.3,
    0.03,
    2.5,
    null,
    null,
    null,
  ],
  [
    'gemini',
    'gemini-3-flash-preview',
    'Gemini 3 Flash (preview)',
    'chat',
    'active',
    0.5,
    0.05,
    3,
    null,
    null,
    'Debrief',
  ],
  [
    'gemini',
    'gemini-2.0-flash',
    'Gemini 2.0 Flash',
    'chat',
    'retired',
    0.1,
    0.025,
    0.4,
    null,
    null,
    null,
  ],
  // Sarvam
  [
    'sarvam',
    'saaras:v2.5',
    'Sarvam Saaras',
    'transcription',
    'active',
    null,
    null,
    null,
    0.006,
    'minute',
    null,
  ],
];

// USD per delivered billable message to India (Meta's card, 1 Oct 2026).
const WHATSAPP_INDIA: Array<[string, number]> = [
  ['marketing', 0.0118],
  ['utility', 0.0014],
  ['authentication', 0.0014],
  ['service', 0.0014],
];

const micros = (usd: number | null): number | null =>
  usd === null ? null : Math.round(usd * 1_000_000 * 1000) / 1000;

export class CreateBillingCosts1985300000000 implements MigrationInterface {
  name = 'CreateBillingCosts1985300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "billing_models" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "provider" character varying(40) NOT NULL,
        "model" character varying(200) NOT NULL,
        "label" character varying(200) NOT NULL,
        "type" character varying(20) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "notes" text,
        "createdBy" integer,
        CONSTRAINT "PK_billing_models_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_billing_models_type" CHECK ("type" IN ('chat','embedding','classifier','transcription','tts','other')),
        CONSTRAINT "CHK_billing_models_status" CHECK ("status" IN ('active','retired'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_billing_models_provider_model" ON "billing_models" ("provider", "model")`,
    );

    await queryRunner.query(`
      CREATE TABLE "billing_model_prices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "modelId" uuid NOT NULL,
        "version" integer NOT NULL,
        "inputPer1MMicros" numeric(20,3),
        "cachedInputPer1MMicros" numeric(20,3),
        "outputPer1MMicros" numeric(20,3),
        "unitPriceMicros" numeric(20,3),
        "unit" character varying(20),
        "effectiveFrom" date NOT NULL,
        "note" text NOT NULL,
        "createdBy" integer,
        CONSTRAINT "PK_billing_model_prices_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_billing_model_prices_model" FOREIGN KEY ("modelId") REFERENCES "billing_models"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_billing_model_prices_unit" CHECK ("unit" IS NULL OR "unit" IN ('minute','page','million_chars','call'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_billing_model_prices_version" ON "billing_model_prices" ("modelId", "version")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_billing_model_prices_effective" ON "billing_model_prices" ("modelId", "effectiveFrom")`,
    );

    await queryRunner.query(`
      CREATE TABLE "whatsapp_rates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "category" character varying(40) NOT NULL,
        "country" character varying(2) NOT NULL,
        "version" integer NOT NULL,
        "priceMicros" numeric(20,3) NOT NULL,
        "effectiveFrom" date NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "note" text NOT NULL,
        "createdBy" integer,
        CONSTRAINT "PK_whatsapp_rates_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_whatsapp_rates_category" CHECK ("category" IN ('marketing','utility','authentication','authentication_international','service')),
        CONSTRAINT "CHK_whatsapp_rates_status" CHECK ("status" IN ('active','retired'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_whatsapp_rates_version" ON "whatsapp_rates" ("category", "country", "version")`,
    );

    await queryRunner.query(`
      CREATE TABLE "usage_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "recordedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "creatorUserId" integer,
        "chatbotId" uuid,
        "draftId" uuid,
        "conversationId" character varying(120),
        "channel" character varying(20) NOT NULL,
        "runId" character varying(120) NOT NULL,
        "step" integer NOT NULL DEFAULT 0,
        "seq" integer NOT NULL DEFAULT 0,
        "kind" character varying(30) NOT NULL,
        "provider" character varying(40),
        "modelName" character varying(200),
        "modelId" uuid,
        "priceId" uuid,
        "inputTokens" integer NOT NULL DEFAULT 0,
        "cachedTokens" integer NOT NULL DEFAULT 0,
        "outputTokens" integer NOT NULL DEFAULT 0,
        "units" numeric(20,3),
        "unit" character varying(20),
        "costMicros" numeric(20,3),
        "detail" jsonb,
        CONSTRAINT "PK_usage_events_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_usage_events_channel" CHECK ("channel" IN ('bot_page','bubble','whatsapp','owner','other')),
        CONSTRAINT "CHK_usage_events_kind" CHECK ("kind" IN ('customer_reply','crisis_check','memory_check','summary','setup','site_reading','indexing','checkup','judge','change_by_chat','try_it','instructions','whatsapp','other'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_usage_events_run_kind_step_seq" ON "usage_events" ("runId", "kind", "step", "seq")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_usage_events_created" ON "usage_events" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_usage_events_chatbot_created" ON "usage_events" ("chatbotId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_usage_events_creator_created" ON "usage_events" ("creatorUserId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_usage_events_conversation" ON "usage_events" ("conversationId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_usage_events_unpriced" ON "usage_events" ("provider", "modelName") WHERE "costMicros" IS NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "fixed_costs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "month" date NOT NULL,
        "label" character varying(200) NOT NULL,
        "amountMicros" numeric(20,3) NOT NULL,
        "note" text,
        "createdBy" integer,
        CONSTRAINT "PK_fixed_costs_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_fixed_costs_month" CHECK (date_trunc('month', "month") = "month"),
        CONSTRAINT "CHK_fixed_costs_amount" CHECK ("amountMicros" >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_fixed_costs_month" ON "fixed_costs" ("month")`,
    );

    await queryRunner.query(`
      CREATE TABLE "cost_settings" (
        "id" integer NOT NULL DEFAULT 1,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "dailyBudgetMicros" numeric(20,3) NOT NULL,
        "conversationAlertMicros" numeric(20,3) NOT NULL,
        "spikeMultiplier" numeric(6,2) NOT NULL,
        "spikeMinMicros" numeric(20,3) NOT NULL,
        "updatedBy" integer,
        CONSTRAINT "PK_cost_settings_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_cost_settings_singleton" CHECK ("id" = 1)
      )
    `);
    await queryRunner.query(
      `INSERT INTO "cost_settings" ("id", "dailyBudgetMicros", "conversationAlertMicros", "spikeMultiplier", "spikeMinMicros")
       VALUES (1, 20000000, 500000, 5, 1000000)`,
    );

    await queryRunner.query(`
      CREATE TABLE "cost_alerts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "kind" character varying(30) NOT NULL,
        "subjectKey" character varying(200) NOT NULL,
        "day" date NOT NULL,
        "detail" jsonb,
        CONSTRAINT "PK_cost_alerts_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_cost_alerts_kind" CHECK ("kind" IN ('daily_budget','assistant_spike','conversation_cost','unpriced_model','usage_feed_off','token_drift','seat_renewal'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_cost_alerts_once" ON "cost_alerts" ("kind", "subjectKey", "day")`,
    );

    await queryRunner.query(`
      CREATE TABLE "billing_audit" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "subjectType" character varying(40) NOT NULL,
        "subjectId" character varying(120) NOT NULL,
        "action" character varying(40) NOT NULL,
        "before" jsonb,
        "after" jsonb,
        "note" text NOT NULL,
        "actorUserId" integer,
        CONSTRAINT "PK_billing_audit_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_billing_audit_subject" ON "billing_audit" ("subjectType", "subjectId", "createdAt")`,
    );

    for (const [
      provider,
      model,
      label,
      type,
      status,
      input,
      cached,
      output,
      unitPrice,
      unit,
      notes,
    ] of MODELS) {
      const [row]: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO "billing_models" ("provider", "model", "label", "type", "status", "notes")
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING "id"`,
        [provider, model, label, type, status, notes],
      );
      await queryRunner.query(
        `INSERT INTO "billing_model_prices"
           ("modelId", "version", "inputPer1MMicros", "cachedInputPer1MMicros", "outputPer1MMicros",
            "unitPriceMicros", "unit", "effectiveFrom", "note")
         VALUES ($1, 1, $2, $3, $4, $5, $6, '2026-01-01', $7)`,
        [
          row.id,
          micros(input),
          micros(cached),
          micros(output),
          micros(unitPrice),
          unit,
          'Starting list (CR1), providers’ list prices checked 19 Nov 2026',
        ],
      );
    }

    for (const [category, usd] of WHATSAPP_INDIA) {
      await queryRunner.query(
        `INSERT INTO "whatsapp_rates" ("category", "country", "version", "priceMicros", "effectiveFrom", "note")
         VALUES ($1, 'IN', 1, $2, '2026-10-01', $3)`,
        [
          category,
          micros(usd),
          'Meta India card, 1 Oct 2026 (CR1 starting rates)',
        ],
      );
    }

    // A new key grants itself to nobody. Costs are for the people who already run Ally admin.
    await queryRunner.query(`
      INSERT INTO "admin_feature_toggles" ("userId", "featureKey", "enabled")
      SELECT t."userId", 'manage_costs', true
        FROM "admin_feature_toggles" t
       WHERE t."featureKey" = 'admin_user_management' AND t."enabled" = true
      ON CONFLICT ("userId", "featureKey") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "admin_feature_toggles" WHERE "featureKey" = 'manage_costs'`,
    );
    await queryRunner.query(`DROP TABLE "billing_audit"`);
    await queryRunner.query(`DROP TABLE "cost_alerts"`);
    await queryRunner.query(`DROP TABLE "cost_settings"`);
    await queryRunner.query(`DROP TABLE "fixed_costs"`);
    await queryRunner.query(`DROP TABLE "usage_events"`);
    await queryRunner.query(`DROP TABLE "whatsapp_rates"`);
    await queryRunner.query(`DROP TABLE "billing_model_prices"`);
    await queryRunner.query(`DROP TABLE "billing_models"`);
  }
}
