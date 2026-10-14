import type {
  CourseBlueprint,
  CourseBlueprintItem,
  CourseCopilotBudget,
  CourseCopilotJob,
  CourseCopilotSessionDetail,
  CourseOutline,
} from "@types";

/** Shared builders for the Course Copilot work-pane tests. */

export const item = (overrides: Partial<CourseBlueprintItem> = {}): CourseBlueprintItem => ({
  id: "item-1",
  type: "ARTICLE",
  title: "Item",
  purpose: "",
  objectiveRefs: [],
  estimatedMinutes: 8,
  source: { kind: "new" },
  spec: {},
  ...overrides,
});

/**
 * Two sections, four items:
 *   s1  Foundations   a (ARTICLE, O1)   q (QUIZ, pass mark 70)
 *   s2  Practice      r (ROLEPLAY, library)   v (VIDEO, needs a link)
 */
export const makeBlueprint = (): CourseBlueprint => ({
  title: "Listening basics",
  description: "A short course.",
  estimatedDurationMinutes: 36,
  competencyIds: [],
  cover: { mode: "generate" },
  sections: [
    {
      id: "s1",
      title: "Foundations",
      description: "",
      purpose: "Build the core ideas",
      items: [
        item({
          id: "a",
          type: "ARTICLE",
          title: "What listening is",
          purpose: "Explains active listening",
          objectiveRefs: [0],
          estimatedMinutes: 8,
          spec: { wordTarget: 600 },
        }),
        item({
          id: "q",
          type: "QUIZ",
          title: "Check your understanding",
          estimatedMinutes: 5,
          spec: { questions: 6 },
          completionCriteria: { passScore: 70 },
        }),
      ],
    },
    {
      id: "s2",
      title: "Practice",
      description: "",
      purpose: "Apply it",
      items: [
        item({
          id: "r",
          type: "ROLEPLAY",
          title: "A hard first call",
          estimatedMinutes: 15,
          source: { kind: "library", scenarioId: 12 },
        }),
        item({
          id: "v",
          type: "VIDEO",
          title: "Watch a real call",
          estimatedMinutes: 5,
          source: { kind: "needs-input", what: "video-url" },
        }),
      ],
    },
  ],
  estimate: { usd: 2.4, minutes: 33, items: 4, newRoleplays: 0, images: 1 },
});

export const budget = (overrides: Partial<CourseCopilotBudget> = {}): CourseCopilotBudget => ({
  ceilingUsd: 10,
  spentUsd: 0,
  remainingUsd: 10,
  held: false,
  ...overrides,
});

export const job = (overrides: Partial<CourseCopilotJob> = {}): CourseCopilotJob => ({
  id: "job-1",
  kind: "article",
  blueprintItemId: "a",
  title: "What listening is",
  status: "queued",
  attempts: 0,
  error: null,
  summary: null,
  skippedReason: null,
  startedAt: null,
  finishedAt: null,
  costUsd: null,
  scenarioId: null,
  caseId: null,
  ...overrides,
});

export const outline = (overrides: Partial<CourseOutline> = {}): CourseOutline => ({
  trackId: "track-1",
  title: "Listening basics",
  description: "A short course.",
  coverImageUrl: null,
  status: "DRAFT",
  estimatedDurationMinutes: 36,
  competencyIds: null,
  structureLocked: false,
  sections: [],
  ...overrides,
});

export const makeDetail = (
  overrides: {
    status?: CourseCopilotSessionDetail["session"]["status"];
    session?: Partial<CourseCopilotSessionDetail["session"]>;
    detail?: Partial<CourseCopilotSessionDetail>;
  } = {},
): CourseCopilotSessionDetail => ({
  session: {
    id: "session-1",
    title: "Listening basics",
    mode: "CREATE",
    status: overrides.status ?? "INTERVIEWING",
    trackId: null,
    trackTitle: null,
    trackStatus: null,
    createdAt: "2026-10-14T09:00:00Z",
    updatedAt: "2026-10-14T09:00:00Z",
    brief: {},
    briefReadiness: { ready: false, missing: [] },
    blueprint: null,
    blueprintVersion: 0,
    approvedBlueprint: null,
    changeLog: [],
    generatedScenarioIds: [],
    generatedCaseIds: [],
    ...overrides.session,
  },
  messages: [],
  jobs: [],
  events: [],
  lastEventSeq: 0,
  outline: null,
  readiness: null,
  budget: budget(),
  ...overrides.detail,
});
