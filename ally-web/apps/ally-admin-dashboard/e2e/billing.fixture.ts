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

// ── CR1 Parts B and C ──

const bar = (used: number, limit: number | null, resetsOn = "2026-12-01") => ({
  used,
  limit,
  resetsOn,
});

const seat = (
  id: string,
  kind: "included" | "extra",
  typeKey: string,
  typeName: string,
  assigneeEmail: string | null,
  messages: ReturnType<typeof bar>,
  extra: Partial<{ startDate: string; nextRenewal: string | null; status: string }> = {},
) => ({
  id,
  kind,
  typeKey,
  typeName,
  assigneeEmail,
  startDate: extra.startDate ?? "2026-10-14",
  nextRenewal: extra.nextRenewal ?? null,
  status: extra.status ?? "active",
  messages,
});

const SUNRISE_SEATS = [
  seat("s-1", "included", "basic", "Basic", "meera@sunrise.example", bar(212, 500)),
  seat("s-2", "included", "basic", "Basic", "ravi@sunrise.example", bar(431, 500)),
  seat("s-3", "included", "basic", "Basic", "anita@sunrise.example", bar(58, 500)),
  seat("s-4", "included", "basic", "Basic", null, bar(0, 500)),
  seat("s-5", "included", "basic", "Basic", null, bar(0, 500)),
  seat(
    "s-6",
    "extra",
    "premium",
    "Premium",
    "dr.kulkarni@sunrise.example",
    bar(1840, 3000, "2026-11-24"),
    {
      startDate: "2026-09-24",
      nextRenewal: "2026-11-24",
      status: "expiring",
    },
  ),
  seat(
    "s-7",
    "extra",
    "premium",
    "Premium",
    "front.desk@sunrise.example",
    bar(620, 3000, "2026-12-03"),
    {
      startDate: "2026-11-03",
      nextRenewal: "2026-12-03",
    },
  ),
];

const HARBOR_SEATS = [
  seat("h-1", "included", "basic", "Basic", "meera@sunrise.example", bar(40, 500)),
  seat("h-2", "included", "basic", "Basic", null, bar(0, 500)),
  seat("h-3", "included", "basic", "Basic", null, bar(0, 500)),
  seat("h-4", "included", "basic", "Basic", null, bar(0, 500)),
  seat("h-5", "included", "basic", "Basic", null, bar(0, 500)),
];

const ASSISTANTS = [
  {
    chatbotId: "bot-sunrise",
    name: "Sunrise Mind",
    status: "live",
    seats: SUNRISE_SEATS,
    seatSummary: "5 included · 2 extra Premium",
    unassigned: 2,
    customers: bar(254, 300),
  },
  {
    chatbotId: "bot-harbor",
    name: "Harbor Counselling",
    status: "live",
    seats: HARBOR_SEATS,
    seatSummary: "5 included",
    unassigned: 4,
    customers: bar(37, 300),
  },
  {
    chatbotId: "bot-calm",
    name: "Calm Corner (draft)",
    status: "draft",
    seats: [],
    seatSummary: "0 included",
    unassigned: 0,
    customers: bar(0, 300),
  },
];

export const MY_PLAN = {
  isCreator: true,
  plan: {
    key: "free",
    name: "Free",
    maxPublished: 3,
    published: 2,
    line: "Free · 2 of 3 assistants published",
    status: "active",
  },
  period: { start: "2026-11-01", end: "2026-12-01" },
  ownerRuns: bar(46, 100),
  assistants: ASSISTANTS,
  alerts: [
    { what: "Customer conversations on Sunrise Mind", percent: 84 },
    { what: "Messages for ravi@sunrise.example on Sunrise Mind", percent: 86 },
  ],
};

const audit = (action: string, note: string, createdAt: string, extra = {}) => ({
  id: `a-${action}-${createdAt}`,
  createdAt,
  subjectType: "spend_cap",
  subjectId: "41",
  action,
  before: null,
  after: null,
  note,
  actorUserId: 7,
  actorName: "Ally Ops",
  actorEmail: "ops@ally.example",
  ...extra,
});

export const USER_PLAN = {
  ...MY_PLAN,
  spend: { usedUsd: 2.37, capUsd: 10, capSource: "plan", resetsOn: "2026-12-01" },
  subscription: {
    id: "sub-1",
    planKey: "free",
    planName: "Free",
    status: "active",
    periodStart: "2026-10-01",
    periodEnd: null,
    note: "Starting plan at launch",
  },
  history: [
    audit("add_seats", "Two Premium seats for the clinic's doctors", "2026-11-03T10:12:00.000Z", {
      subjectType: "seats",
    }),
    audit("set_plan", "Starting plan at launch", "2026-10-01T09:00:00.000Z", {
      subjectType: "subscription",
    }),
  ],
};

export const USER_SPEND = {
  isCreator: true,
  planName: "Free",
  usedUsd: 2.37,
  capUsd: 10,
  capSource: "plan",
  planCapUsd: 10,
  resetsOn: "2026-12-01",
  usage: {
    byAssistant: [
      { chatbotId: "bot-sunrise", name: "Sunrise Mind", tokens: 612_400, costUsd: 1.84 },
      { chatbotId: "bot-harbor", name: "Harbor Counselling", tokens: 141_900, costUsd: 0.41 },
      { chatbotId: null, name: "Setup drafts", tokens: 45_700, costUsd: 0.12 },
    ],
    byKind: [
      { kind: "customer_reply", tokens: 498_000, costUsd: 1.31 },
      { kind: "crisis_check", tokens: 160_100, costUsd: 0.48 },
      { kind: "setup", tokens: 98_200, costUsd: 0.39 },
      { kind: "checkup", tokens: 43_700, costUsd: 0.19 },
    ],
  },
  history: [
    audit("plan", "Pilot over: back to the plan's cap", "2026-11-12T08:05:00.000Z"),
    audit("set", "Raised for the clinic's launch week", "2026-11-01T00:00:00.000Z"),
  ],
};

const SEAT_TYPES = [
  {
    id: id(31),
    key: "basic",
    name: "Basic",
    messagesPerMonth: 500,
    rank: 1,
    price: 4,
    active: true,
  },
  {
    id: id(32),
    key: "premium",
    name: "Premium",
    messagesPerMonth: 3000,
    rank: 2,
    price: 12,
    active: true,
  },
];

export const PLANS_CATALOGUE = {
  plans: [
    {
      id: id(21),
      key: "free",
      name: "Free",
      maxPublished: 3,
      includedSeats: 5,
      includedSeatTypeId: id(31),
      customerConversations: 300,
      ownerRuns: 100,
      seatsRequired: true,
      price: null,
      costCap: 10,
      active: true,
    },
    {
      id: id(22),
      key: "pro",
      name: "Pro",
      maxPublished: 20,
      includedSeats: 5,
      includedSeatTypeId: id(31),
      customerConversations: 3000,
      ownerRuns: 1000,
      seatsRequired: true,
      price: 49,
      costCap: 120,
      active: true,
    },
    {
      id: id(23),
      key: "internal",
      name: "Internal",
      maxPublished: null,
      includedSeats: 5,
      includedSeatTypeId: id(32),
      customerConversations: null,
      ownerRuns: null,
      seatsRequired: false,
      price: null,
      costCap: null,
      active: true,
    },
  ],
  seatTypes: SEAT_TYPES,
  renewalsDue: [
    {
      id: "s-6",
      chatbotId: "bot-sunrise",
      assistant: "Sunrise Mind",
      nextRenewal: "2026-11-24",
      status: "expiring",
      assigneeEmail: "dr.kulkarni@sunrise.example",
      seatType: "Premium",
      creatorEmail: "meera@sunrise.example",
      creatorUserId: 41,
    },
    {
      id: "s-9",
      chatbotId: "bot-harbor",
      assistant: "Harbor Counselling",
      nextRenewal: "2026-11-25",
      status: "expiring",
      assigneeEmail: null,
      seatType: "Basic",
      creatorEmail: "team@harbor.example",
      creatorUserId: 12,
    },
  ],
};

const PLAN_COSTS = {
  months: 1,
  plans: [
    {
      key: "free",
      name: "Free",
      price: null,
      subscribers: 14,
      cost: 21.4,
      earns: 0,
      margin: -21.4,
      costPerSubscriber: 1.5286,
    },
    {
      key: "pro",
      name: "Pro",
      price: 49,
      subscribers: 6,
      cost: 37.6,
      earns: 294,
      margin: 256.4,
      costPerSubscriber: 6.2667,
    },
    {
      key: "internal",
      name: "Internal",
      price: null,
      subscribers: 4,
      cost: 2.25,
      earns: 0,
      margin: -2.25,
      costPerSubscriber: 0.5625,
    },
  ],
  seatTypes: [
    { key: "basic", name: "Basic", price: 4, extraSeats: 3, includedSeats: 95, earns: 12 },
    { key: "premium", name: "Premium", price: 12, extraSeats: 9, includedSeats: 20, earns: 108 },
  ],
};

export const CUSTOM_LOGIN = {
  id: 41,
  name: "Dr Meera Kulkarni",
  email: "meera@sunrise.example",
  status: "ACTIVE",
  createdAt: "2026-09-30T00:00:00.000Z",
  roleGrantedAt: "2026-10-01T00:00:00.000Z",
  organisation: "Sunrise Mind Clinic",
  features: ["whatsapp_bot"],
  assistants: 3,
};

const CUSTOM_LOGINS = {
  data: [
    CUSTOM_LOGIN,
    {
      id: 42,
      name: "Harbor team",
      email: "team@harbor.example",
      status: "ACTIVE",
      createdAt: "2026-10-12T00:00:00.000Z",
      roleGrantedAt: "2026-10-12T00:00:00.000Z",
      organisation: "Harbor Counselling",
      features: ["whatsapp_bot", "analytics"],
      assistants: 1,
    },
  ],
  count: 2,
};

const TOGGLE_REGISTRY = [
  { key: "whatsapp_bot", label: "WhatsApp Bot", description: "", platformOnly: false },
  {
    key: "analytics",
    label: "Analytics",
    description: "Dashboards for their organisation.",
    platformOnly: false,
  },
  { key: "users", label: "Users", description: "Users and organisations.", platformOnly: false },
];

/** Share → People's seats for the assistant home fixture: an owner's view of Sunrise Mind. */
export const ASSISTANT_SEATS = {
  chatbotId: "bot-sunrise",
  name: "Sunrise Mind",
  published: true,
  seatsRequired: true,
  seats: SUNRISE_SEATS,
  seatSummary: "5 included · 2 extra Premium",
  unassigned: 2,
  customers: bar(254, 300),
  people: [
    { email: "meera@sunrise.example", role: "owner", hasSeat: true },
    { email: "ravi@sunrise.example", role: "editor", hasSeat: true },
    { email: "anita@sunrise.example", role: "invited", hasSeat: true },
    { email: "dr.kulkarni@sunrise.example", role: "invited", hasSeat: true },
    { email: "front.desk@sunrise.example", role: "invited", hasSeat: true },
    { email: "intern@sunrise.example", role: "invited", hasSeat: false },
  ],
};

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
    if (path === "/admin/billing/costs/plans") return json(route, PLAN_COSTS);
    if (path === "/admin/billing/plans") return json(route, PLANS_CATALOGUE);
    if (/^\/admin\/billing\/users\/\d+\/spend$/.test(path)) return json(route, USER_SPEND);
    if (/^\/admin\/billing\/users\/\d+\/plan$/.test(path)) return json(route, USER_PLAN);
    if (path === "/custom-logins") return json(route, CUSTOM_LOGINS);
    if (path === "/authorization/feature-toggles/registry") return json(route, TOGGLE_REGISTRY);
    if (/^\/users\/\d+\/feature-toggles$/.test(path)) {
      return json(
        route,
        TOGGLE_REGISTRY.map(entry => ({ ...entry, enabled: entry.key === "whatsapp_bot" })),
      );
    }
    if (path === "/me/plan") return json(route, MY_PLAN);
    if (path === "/platform-admins") return json(route, { data: [], count: 0 });
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
      return json(route, ["manage_costs", "manage_llm_model_catalog", "admin_user_management"]);
    }
    if (path === "/authorization/permissions") {
      return json(route, ["system:access", "edit:user", "view:users"]);
    }
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
