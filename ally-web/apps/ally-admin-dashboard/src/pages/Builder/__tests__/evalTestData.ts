import type {
  BuilderEvalFixture,
  BuilderEvalRun,
  BuilderEvalSuite,
  BuilderEvalSuiteDetail,
} from "@types";

/** Shared builders for the eval page's tests. Plain data: no mocks live here. */

export const interviewFixture = (
  overrides: Partial<BuilderEvalFixture> = {},
): BuilderEvalFixture => ({
  id: "fix-1",
  name: "Digest email",
  kind: "interview",
  sourceSessionId: "2bc3a5cf-0000-4000-8000-000000000000",
  notes: "Session 2bc3a5cf asked six questions it never read.",
  active: true,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  payload: {
    openingMessage: "A weekly digest email summarising what shipped",
    adminScript: ["Weekly, on Mondays", "To the whole team"],
    checklist: [
      { id: "C1", text: "Reuses the existing digest job", kind: "must" },
      { id: "C2", text: "Plans a new table for digests", kind: "must_not" },
    ],
  },
  ...overrides,
});

export const reviewFixture = (overrides: Partial<BuilderEvalFixture> = {}): BuilderEvalFixture =>
  interviewFixture({
    id: "fix-2",
    name: "Clean control",
    kind: "prd_review",
    sourceSessionId: null,
    notes: "A PRD with nothing wrong with it.",
    payload: { prd: {} as never, expect: { blocking: false } },
    ...overrides,
  });

export const gatesWith = (overrides: Partial<NonNullable<BuilderEvalRun["gates"]>> = {}) => ({
  unseenFailures: 0,
  askedBeforeReading: 0,
  unrepairedEditFailures: 0,
  falseUpdateClaims: 0,
  falseReadyClaims: 0,
  consistent: true,
  evidenceCited: true,
  ...overrides,
});

export const evalRun = (overrides: Partial<BuilderEvalRun> = {}): BuilderEvalRun => ({
  id: "run-1",
  suiteId: "suite-1",
  fixtureId: "fix-1",
  repetition: 1,
  status: "failed",
  gates: gatesWith({ unseenFailures: 2, evidenceCited: false }),
  metrics: {
    turns: 9,
    questions: 4,
    corrections: 1,
    correctedItems: ["C1"],
    readyReached: true,
    readinessScore: 88,
    toolCalls: 14,
    toolFailures: 3,
    costUsd: 1.5,
    durationMs: 125_000,
  },
  judge: {
    met: 1,
    total: 2,
    score: 0.5,
    items: [
      { id: "C1", met: false, evidence: "The PRD plans a fresh digest scheduler." },
      { id: "C2", met: true, evidence: "No new table is mentioned." },
    ],
  },
  critic: null,
  transcript: [
    {
      turn: 1,
      admin: "A weekly digest email",
      builder: "Let me look at what exists.",
      question: "Who receives it?",
      toolCalls: [{ name: "update_prd", ok: false, summary: "section not found" }],
    },
  ],
  finalPrd: null,
  error: null,
  ...overrides,
});

export const evalSuite = (overrides: Partial<BuilderEvalSuite> = {}): BuilderEvalSuite => ({
  id: "suite-1",
  trigger: "manual",
  status: "completed",
  fixtureIds: ["fix-1", "fix-2"],
  repetitions: 3,
  candidate: null,
  summary: {
    fixtures: [
      {
        fixtureId: "fix-1",
        name: "Digest email",
        kind: "interview",
        runs: 3,
        passed: 1,
        gateViolations: 3,
        corrections: 2,
        judgeScore: 0.5,
      },
      {
        fixtureId: "fix-2",
        name: "Clean control",
        kind: "prd_review",
        runs: 3,
        passed: 3,
        gateViolations: 0,
        corrections: 0,
        judgeScore: null,
      },
    ],
    runs: 6,
    passed: 4,
    errored: 0,
    gateViolations: 3,
    corrections: 2,
    judgeScore: 0.5,
    costUsd: 12,
  },
  verdict: null,
  publishedAt: null,
  error: null,
  createdAt: "2026-10-20T09:00:00.000Z",
  completedAt: "2026-10-20T09:30:00.000Z",
  ...overrides,
});

export const evalSuiteDetail = (
  overrides: Partial<BuilderEvalSuiteDetail> = {},
): BuilderEvalSuiteDetail => ({
  ...evalSuite(),
  runs: [evalRun()],
  ...overrides,
});
