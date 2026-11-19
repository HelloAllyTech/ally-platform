import { expect } from "@playwright/test";

import type { Page, Route } from "@playwright/test";

/**
 * Ally admin → Models and → Costs (CR1) from fixtures: a super admin with `manage_costs` logs in
 * through the mocked OTP flow, and every `/v1/admin/billing/...` call answers from here. Fictional
 * numbers, shaped as ally-be answers them (prices in micros, cost reports in dollars).
 */

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const price = (
  modelId: string,
  input: number | null,
  cached: number | null,
  output: number | null,
  extra: Partial<{
    unitPriceMicros: number;
    unit: string;
    effectiveFrom: string;
    version: number;
  }> = {},
) => ({
  id: `${modelId}-p${extra.version ?? 1}`,
  modelId,
  version: extra.version ?? 1,
  inputPer1MMicros: input,
  cachedInputPer1MMicros: cached,
  outputPer1MMicros: output,
  unitPriceMicros: extra.unitPriceMicros ?? null,
  unit: extra.unit ?? null,
  effectiveFrom: extra.effectiveFrom ?? "2026-11-01",
  note: "Starting list",
  createdBy: 7,
  createdAt: "2026-11-01T09:00:00.000Z",
});

const model = (
  id: string,
  provider: string,
  name: string,
  label: string,
  type: string,
  current: ReturnType<typeof price> | null,
  usageCount: number,
  notes: string | null = null,
  status = "active",
) => ({
  id,
  provider,
  model: name,
  label,
  type,
  status,
  notes,
  current,
  versions: current?.version ?? 0,
  usageCount,
  unpricedCount: 0,
});

const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

export const MODELS = [
  model(
    id(1),
    "openai",
    "gpt-4.1-mini",
    "GPT-4.1 mini",
    "chat",
    price(id(1), 400_000, 100_000, 1_600_000, { version: 2, effectiveFrom: "2026-11-15" }),
    18_420,
    "Default for customer replies",
  ),
  model(
    id(2),
    "openai",
    "gpt-4.1",
    "GPT-4.1",
    "chat",
    price(id(2), 2_000_000, 500_000, 8_000_000),
    1_204,
  ),
  model(
    id(3),
    "openai",
    "text-embedding-3-small",
    "Embedding 3 small",
    "embedding",
    price(id(3), 20_000, null, null),
    9_310,
  ),
  model(
    id(4),
    "anthropic",
    "claude-haiku-4-5",
    "Claude Haiku 4.5",
    "classifier",
    price(id(4), 1_000_000, 100_000, 5_000_000),
    6_782,
    "Crisis check",
  ),
  model(
    id(5),
    "deepgram",
    "nova-3",
    "Nova 3",
    "transcription",
    price(id(5), null, null, null, { unitPriceMicros: 4_300, unit: "minute" }),
    0,
  ),
  model(
    id(6),
    "openai",
    "gpt-4o-mini",
    "GPT-4o mini",
    "chat",
    price(id(6), 150_000, 75_000, 600_000),
    3_015,
    null,
    "retired",
  ),
];

const UNKNOWN = [
  { provider: "openai", model: "gpt-5.1-mini", events: 42, since: "2026-11-18T08:00:00.000Z" },
];

const rate = (country: string, category: string, micros: number) => {
  const v = {
    id: `${country}-${category}`,
    country,
    category,
    version: 1,
    priceMicros: micros,
    effectiveFrom: "2026-10-01",
    status: "active",
    note: "Meta rate card, Oct 2026",
    createdBy: 7,
    createdAt: "2026-10-01T09:00:00.000Z",
  };
  return { country, category, status: "active", current: v, versions: [v] };
};

const RATES = [
  rate("IN", "marketing", 11_800),
  rate("IN", "utility", 1_400),
  rate("IN", "authentication", 1_400),
  rate("IN", "service", 0),
  rate("GB", "marketing", 52_900),
  rate("GB", "utility", 22_000),
];

const OVERVIEW = {
  today: 3.42,
  week: 18.9,
  month: 61.25,
  whatsappMonth: 4.1,
  fixedMonth: 180,
  otherProductsMonth: 22.5,
  monthWithFixed: 263.75,
  unpricedEventsMonth: 42,
  customerConversations: 312,
  customerMessages: 1480,
  costPerConversation: 0.1963,
  costPerMessage: 0.0414,
  dailyBudget: 20,
  settings: { dailyBudget: 20, conversationAlert: 0.5, spikeMultiplier: 5, spikeMin: 1 },
  alerts: [
    {
      kind: "unpriced_model",
      subjectKey: "openai/gpt-5.1-mini",
      day: "2026-11-18",
      detail: { message: "openai gpt-5.1-mini isn't in the price list (42 calls)." },
      createdAt: "2026-11-18T08:05:00.000Z",
    },
    {
      kind: "assistant_spike",
      subjectKey: "bot-sunrise",
      day: "2026-11-17",
      detail: { message: "Sunrise Mind cost $6.20 today, 5.4× its 7-day average." },
      createdAt: "2026-11-17T21:00:00.000Z",
    },
  ],
  periodStarts: {},
};

/** 30 days ending 19 Nov 2026, a gentle rise with a weekend dip. */
const TREND = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 21 + i));
  const weekend = [0, 6].includes(d.getUTCDay());
  return {
    day: d.toISOString().slice(0, 10),
    ai: Number(((weekend ? 0.9 : 1.6) + i * 0.05).toFixed(2)),
    whatsapp: Number(((weekend ? 0.05 : 0.15) + (i % 3) * 0.02).toFixed(2)),
  };
});

const BREAKDOWN: Record<string, unknown[]> = {
  assistant: [
    {
      key: "bot-sunrise",
      label: "Sunrise Mind",
      cost: 24.18,
      calls: 6120,
      tokens: 8_210_400,
      unpriced: 0,
    },
    {
      key: "bot-calm",
      label: "Calm Corner Clinic",
      cost: 17.6,
      calls: 4890,
      tokens: 6_002_100,
      unpriced: 12,
    },
    {
      key: "bot-harbor",
      label: "Harbor Counselling",
      cost: 11.92,
      calls: 3011,
      tokens: 3_998_700,
      unpriced: 30,
    },
    { key: null, label: "Setup drafts", cost: 7.55, calls: 912, tokens: 2_400_300, unpriced: 0 },
  ],
  publisher: [
    {
      key: "11",
      label: "Dr Meera Kulkarni",
      cost: 35.78,
      calls: 9010,
      tokens: 12_000_000,
      unpriced: 12,
    },
    { key: "12", label: "Harbor team", cost: 25.47, calls: 5923, tokens: 8_611_500, unpriced: 30 },
  ],
  kind: [
    {
      key: "customer_reply",
      label: "customer_reply",
      cost: 38.2,
      calls: 1480,
      tokens: 11_000_000,
      unpriced: 0,
    },
    {
      key: "crisis_check",
      label: "crisis_check",
      cost: 6.1,
      calls: 1480,
      tokens: 2_100_000,
      unpriced: 0,
    },
    { key: "whatsapp", label: "whatsapp", cost: 4.1, calls: 520, tokens: 0, unpriced: 0 },
  ],
  model: [
    {
      key: "gpt-4.1-mini",
      label: "gpt-4.1-mini",
      cost: 40.3,
      calls: 9100,
      tokens: 14_000_000,
      unpriced: 0,
    },
    {
      key: "gpt-5.1-mini",
      label: "gpt-5.1-mini",
      cost: 0,
      calls: 42,
      tokens: 51_000,
      unpriced: 42,
    },
  ],
  channel: [
    { key: "whatsapp", label: "whatsapp", cost: 30.1, calls: 7010, tokens: 9_000_000, unpriced: 0 },
    { key: "bot_page", label: "bot_page", cost: 19.4, calls: 4300, tokens: 6_000_000, unpriced: 0 },
    { key: "owner", label: "owner", cost: 11.75, calls: 3623, tokens: 5_611_500, unpriced: 42 },
  ],
};

const ASSISTANT = {
  assistant: { id: "bot-sunrise", name: "Sunrise Mind", creatorEmail: "meera@sunrise.example" },
  total: 24.18,
  byKind: [
    { kind: "customer_reply", cost: 18.4, calls: 980 },
    { kind: "crisis_check", cost: 3.1, calls: 980 },
    { kind: "whatsapp", cost: 2.68, calls: 310 },
  ],
  topConversations: [
    {
      conversationId: "c-1",
      channel: "whatsapp",
      cost: 0.62,
      messages: 34,
      started: "2026-11-12T10:00:00.000Z",
    },
    {
      conversationId: "c-2",
      channel: "bot_page",
      cost: 0.41,
      messages: 22,
      started: "2026-11-14T15:20:00.000Z",
    },
  ],
};

const FIXED = [
  {
    id: "f1",
    month: "2026-11-01",
    label: "Hetzner servers",
    amountMicros: 120_000_000,
    note: "Nov invoice",
  },
  {
    id: "f2",
    month: "2026-11-01",
    label: "Weaviate Cloud",
    amountMicros: 45_000_000,
    note: "Nov invoice",
  },
  { id: "f3", month: "2026-11-01", label: "Sentry", amountMicros: 15_000_000, note: "Nov invoice" },
];

/** Logs in as a super admin holding `manage_costs`, and answers the billing API. */
export async function mockBilling(page: Page) {
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/api\/v1/, "");
    if (path === "/admin/billing/models") return json(route, MODELS);
    if (path === "/admin/billing/models/unknown") return json(route, UNKNOWN);
    if (/^\/admin\/billing\/models\/[^/]+\/history$/.test(path)) {
      return json(route, { versions: [MODELS[0].current], history: [] });
    }
    if (path === "/admin/billing/whatsapp-rates") return json(route, RATES);
    if (path === "/admin/billing/costs") return json(route, OVERVIEW);
    if (path === "/admin/billing/costs/trend") return json(route, TREND);
    if (path === "/admin/billing/costs/breakdown") {
      return json(route, BREAKDOWN[url.searchParams.get("by") ?? "assistant"] ?? []);
    }
    if (path.startsWith("/admin/billing/costs/assistants/")) return json(route, ASSISTANT);
    if (path === "/admin/billing/costs/fixed") return json(route, FIXED);
    if (path === "/users/me") {
      return json(route, {
        id: 7,
        userId: 7,
        email: "ops@ally.example",
        name: "Ally Ops",
        role: "SUPER_DUPER_ADMIN",
        roles: ["SUPER_DUPER_ADMIN"],
      });
    }
    if (path === "/users/me/preferences") return json(route, {});
    if (path === "/users/me/feature-toggles") {
      return json(route, ["manage_costs", "manage_llm_model_catalog"]);
    }
    if (path === "/authorization/permissions") return json(route, ["system:access"]);
    return json(route, []);
  });
  await page.route("**/api/v2/auth/generate-otp", r => json(r, { message: "Code sent" }));
  await page.route("**/api/v2/auth/verify-otp", r =>
    json(r, { accessToken: "cr1-token", refreshToken: "cr1-refresh" }),
  );
}

/** The login screen is drawn at the URL opened; log in through it (as assistantsAccess does). */
export async function logIn(page: Page) {
  await page.getByPlaceholder("Enter your email address").fill("ops@ally.example");
  await page.getByRole("button", { name: /^(Next|Send code)$/ }).click();
  const digits = page.locator('input[inputmode="numeric"]');
  await expect(digits.first()).toBeVisible();
  const count = await digits.count();
  for (let i = 0; i < count; i++) await digits.nth(i).fill(String((i % 9) + 1));
  await expect(digits.first()).toBeHidden();
}
