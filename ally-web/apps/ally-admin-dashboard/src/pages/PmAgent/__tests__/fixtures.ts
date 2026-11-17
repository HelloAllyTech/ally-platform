import type {
  PmAgentStateResponse,
  PmCard,
  PmQuestionPayload,
  PmRecommendationPayload,
} from "@types";

export const recPayload = (
  over: Partial<PmRecommendationPayload> = {},
): PmRecommendationPayload => ({
  schemaVersion: 1,
  title: "Show the streak on the start screen",
  whyHeadline: "41% of learners with no streak do not return the next day",
  change: ["Add a streak chip to Start", "No new API"],
  problem: "Learners cannot see their streak before starting.",
  plan: {
    steps: ["Add chip", "Wire to existing XP data"],
    files: ["ally-web/apps/ally-helpline-dashboard/src/Start.tsx"],
    acceptanceCriteria: ["Chip shows the count"],
    testPlan: ["Unit test the chip"],
    defaultsChosen: ["Hide at zero"],
  },
  size: "S",
  risk: "low",
  riskWhy: "UI only",
  rollbackNote: "Revert the PR",
  impactMetric: { name: "next-day return rate", direction: "up" },
  alternativesDropped: ["Push notification"],
  repos: ["ally-web"],
  evidenceIds: ["e1", "e2"],
  ...over,
});

export const recCard = (
  id: string,
  over: Partial<PmCard> = {},
  payload: Partial<PmRecommendationPayload> = {},
): PmCard => ({
  id,
  kind: "recommendation",
  category: "ui_ux",
  status: "open",
  version: 1,
  versionHash: "h",
  title: `Card ${id}`,
  payload: recPayload({ title: `Card ${id}`, ...payload }),
  rank: 1,
  evidenceFreshness: null,
  createdAt: new Date().toISOString(),
  ...over,
});

export const questionPayload = (): PmQuestionPayload => ({
  schemaVersion: 1,
  title: "Which tenants matter most?",
  askedBecause: "I can't tell which tenants to weight.",
  usedFor: "Ranking cards",
  options: [
    { label: "Enterprise tenants", consequence: "Weight enterprise higher", suggested: true },
    { label: "All equally", consequence: "No weighting" },
  ],
  scope: "global",
});

export const questionCard = (id: string): PmCard => ({
  ...recCard(id),
  kind: "question",
  category: "strategy_content",
  title: "Which tenants matter most?",
  payload: questionPayload(),
});

export const stateOf = (over: Partial<PmAgentStateResponse> = {}): PmAgentStateResponse => ({
  agentState: "idle",
  settings: {
    enabled: true,
    monthlyBudgetUsd: 100,
    queueCap: 5,
    runHourIst: 9,
    mandate: "Find good changes",
    pauseAutoBuild: false,
    slackNotify: false,
  },
  budget: { monthlyBudgetUsd: 100, spentUsd: 20, reservedUsd: 0 },
  queue: { open: 2, cap: 5, needsYou: 0 },
  lastRun: { status: "succeeded", finishedAt: new Date().toISOString(), cardsCreated: 2 },
  nextRunAt: null,
  autoBuildPaused: false,
  ...over,
});

export const lessonOf = (
  id: string,
  over: Partial<import("@types").PmLesson> = {},
): import("@types").PmLesson => ({
  id,
  text: `Lesson ${id}`,
  scope: "category",
  category: "ui_ux",
  status: "active",
  source: "weekly_job",
  supportCount: 8,
  supportRatio: 0.82,
  evidenceCardIds: [],
  evalResult: { passed: true, agreementBefore: 0.7, agreementAfter: 0.75, sampleSize: 20 },
  requiresConfirm: false,
  ...over,
});
