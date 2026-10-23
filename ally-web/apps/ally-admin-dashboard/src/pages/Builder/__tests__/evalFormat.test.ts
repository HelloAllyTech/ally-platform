import { describe, expect, it } from "vitest";

import type {
  BuilderEvalFixture,
  BuilderEvalGates,
  BuilderEvalRun,
  BuilderEvalSuite,
  BuilderEvalSuiteDetail,
} from "@types";

import {
  anySuiteRunning,
  asArray,
  averageCostPerRun,
  checklistOf,
  checklistsEqual,
  cleanChecklist,
  expectationOf,
  expectsNothingToBuild,
  fixtureRows,
  formatEvalCost,
  formatJudgeScore,
  formatPassed,
  formatRunDuration,
  formatStarted,
  gateEntries,
  gateViolationCount,
  groupRunsByFixture,
  interviewContextOf,
  MAX_CHECKLIST_ITEMS,
  MAX_CHECKLIST_TEXT,
  nextChecklistId,
  outcomeNote,
  parsePastedExport,
  shortNote,
  suiteRows,
} from "../eval/evalFormat";

const interviewFixture = (overrides: Partial<BuilderEvalFixture> = {}): BuilderEvalFixture => ({
  id: "f1",
  name: "Asked before reading",
  kind: "interview",
  sourceSessionId: null,
  notes: null,
  active: true,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  payload: {
    openingMessage: "A weekly digest",
    adminScript: ["Weekly", "Email"],
    checklist: [
      { id: "C1", text: "Reuses the digest job", kind: "must" },
      { id: "C2", text: "Plans no new table", kind: "must_not" },
    ],
  },
  ...overrides,
});

const gates = (overrides: Partial<BuilderEvalGates> = {}): BuilderEvalGates => ({
  unseenFailures: 0,
  askedBeforeReading: 0,
  unrepairedEditFailures: 0,
  falseUpdateClaims: 0,
  falseReadyClaims: 0,
  consistent: true,
  evidenceCited: true,
  ...overrides,
});

const suite = (overrides: Partial<BuilderEvalSuite> = {}): BuilderEvalSuite => ({
  id: "s1",
  trigger: "manual",
  status: "completed",
  fixtureIds: ["f1", "f2"],
  repetitions: 3,
  candidate: null,
  summary: {
    fixtures: [],
    runs: 6,
    passed: 4,
    errored: 0,
    gateViolations: 3,
    corrections: 2,
    judgeScore: 0.666,
    costUsd: 12,
  },
  verdict: null,
  publishedAt: null,
  error: null,
  createdAt: "2026-10-20T09:00:00.000Z",
  completedAt: "2026-10-20T09:30:00.000Z",
  ...overrides,
});

describe("asArray", () => {
  it("passes an array through and turns everything else into an empty one", () => {
    expect(asArray([1, 2])).toEqual([1, 2]);
    expect(asArray(undefined)).toEqual([]);
    expect(asArray(null)).toEqual([]);
    expect(asArray("C1")).toEqual([]);
    expect(asArray({ 0: "a" })).toEqual([]);
  });
});

describe("checklistOf", () => {
  it("reads an interview fixture's checklist", () => {
    expect(checklistOf(interviewFixture())).toEqual([
      { id: "C1", text: "Reuses the digest job", kind: "must" },
      { id: "C2", text: "Plans no new table", kind: "must_not" },
    ]);
  });

  it("is empty for a PRD-review fixture, which has an expectation rather than a checklist", () => {
    const fixture = interviewFixture({
      kind: "prd_review",
      payload: { prd: {} as never, expect: { blocking: true } },
    });
    expect(checklistOf(fixture)).toEqual([]);
  });

  it("survives a checklist an agent or a paste got wrong", () => {
    const notAnArray = interviewFixture({
      payload: { openingMessage: "x", adminScript: [], checklist: "C1: do it" as never },
    });
    expect(checklistOf(notAnArray)).toEqual([]);

    const mixed = interviewFixture({
      payload: {
        openingMessage: "x",
        adminScript: [],
        checklist: [
          null,
          "a string",
          { text: 42 },
          { text: "No id, odd kind", kind: "should" },
          { id: "C9", text: "Kept", kind: "must_not" },
        ] as never,
      },
    });
    // The missing id is numbered among the items that were kept, as the server does.
    expect(checklistOf(mixed)).toEqual([
      { id: "C1", text: "No id, odd kind", kind: "must" },
      { id: "C9", text: "Kept", kind: "must_not" },
    ]);
  });
});

describe("interviewContextOf and expectationOf", () => {
  it("returns what the admin said, dropping anything that is not text", () => {
    const fixture = interviewFixture({
      payload: {
        openingMessage: "Open",
        adminScript: ["one", 2, null, "three"] as never,
        checklist: [],
      },
    });
    expect(interviewContextOf(fixture)).toEqual({
      openingMessage: "Open",
      adminScript: ["one", "three"],
    });
  });

  it("reads a seeded defect and a clean control", () => {
    const defect = interviewFixture({
      kind: "prd_review",
      payload: { prd: {} as never, expect: { blocking: true, via: "testPlanRepos" } },
    });
    const control = interviewFixture({
      kind: "prd_review",
      payload: { prd: {} as never, expect: { blocking: false } },
    });
    expect(expectationOf(defect)).toEqual({ blocking: true, via: "testPlanRepos" });
    expect(expectationOf(control)).toEqual({ blocking: false, via: null });
    expect(expectationOf(interviewFixture())).toBeNull();
  });
});

describe("nextChecklistId", () => {
  it("numbers from one", () => {
    expect(nextChecklistId([])).toBe("C1");
  });

  it("goes past the highest id, leaving gaps where items were removed", () => {
    expect(
      nextChecklistId([
        { id: "C1", text: "a", kind: "must" },
        { id: "C5", text: "b", kind: "must" },
      ]),
    ).toBe("C6");
  });

  it("copes with ids that are not numbered", () => {
    expect(nextChecklistId([{ id: "intro", text: "a", kind: "must" }])).toBe("C2");
  });
});

describe("cleanChecklist and checklistsEqual", () => {
  it("trims, drops blanks and clips to what the server accepts", () => {
    const long = "x".repeat(MAX_CHECKLIST_TEXT + 50);
    const cleaned = cleanChecklist([
      { id: "C1", text: "  Reuses the digest job  ", kind: "must" },
      { id: "C2", text: "   ", kind: "must" },
      { id: "C3", text: long, kind: "must_not" },
    ]);
    expect(cleaned.map(item => item.id)).toEqual(["C1", "C3"]);
    expect(cleaned[0].text).toBe("Reuses the digest job");
    expect(cleaned[1].text).toHaveLength(MAX_CHECKLIST_TEXT);
  });

  it("holds no more than the server's limit", () => {
    const many = Array.from({ length: MAX_CHECKLIST_ITEMS + 5 }, (_, index) => ({
      id: `C${index + 1}`,
      text: `item ${index}`,
      kind: "must" as const,
    }));
    expect(cleanChecklist(many)).toHaveLength(MAX_CHECKLIST_ITEMS);
  });

  it("compares by id, text and kind, in order", () => {
    const a = [{ id: "C1", text: "x", kind: "must" as const }];
    expect(checklistsEqual(a, [{ id: "C1", text: "x", kind: "must" }])).toBe(true);
    expect(checklistsEqual(a, [{ id: "C1", text: "x", kind: "must_not" }])).toBe(false);
    expect(checklistsEqual(a, [])).toBe(false);
  });
});

describe("fixtureRows", () => {
  it("derives name, kind, checklist size, active and a short note", () => {
    const rows = fixtureRows([
      interviewFixture({ notes: "Session 2bc3a5cf asked six questions it never read.\nMore." }),
      interviewFixture({
        id: "f2",
        name: "Clean control",
        kind: "prd_review",
        active: false,
        payload: { prd: {} as never, expect: { blocking: false } },
      }),
      interviewFixture({
        id: "f3",
        name: "No checklist yet",
        payload: { openingMessage: "x", adminScript: [], checklist: [] },
      }),
    ]);

    expect(rows).toEqual([
      {
        id: "f1",
        name: "Asked before reading",
        kind: "interview",
        checklistSize: 2,
        expectsNothingToBuild: false,
        active: true,
        note: "Session 2bc3a5cf asked six questions it never read.",
      },
      {
        id: "f2",
        name: "Clean control",
        kind: "prd_review",
        checklistSize: null,
        expectsNothingToBuild: false,
        active: false,
        note: "",
      },
      {
        id: "f3",
        name: "No checklist yet",
        kind: "interview",
        checklistSize: 0,
        expectsNothingToBuild: false,
        active: true,
        note: "",
      },
    ]);
  });

  it("marks an interview fixture that expects nothing to build, and only that", () => {
    const shipped = interviewFixture({
      payload: {
        openingMessage: "Version simulations every 24 hours",
        adminScript: [],
        checklist: [],
        expectedOutcome: "nothing_to_build",
      },
    });

    expect(fixtureRows([shipped])[0].expectsNothingToBuild).toBe(true);
    expect(expectsNothingToBuild(interviewFixture())).toBe(false);
    // Only an interview has an outcome to expect; a stray field on a review changes nothing.
    expect(
      expectsNothingToBuild(
        interviewFixture({
          kind: "prd_review",
          payload: { expectedOutcome: "nothing_to_build" } as never,
        }),
      ),
    ).toBe(false);
  });

  it("is empty for a list that has not arrived or arrived wrong", () => {
    expect(fixtureRows(undefined)).toEqual([]);
    expect(fixtureRows({ not: "a list" } as never)).toEqual([]);
  });
});

describe("shortNote", () => {
  it("clips a long first line", () => {
    const note = shortNote("a".repeat(200), 20);
    expect(note).toHaveLength(20);
    expect(note.endsWith("…")).toBe(true);
  });

  it("is empty for no note", () => {
    expect(shortNote(null)).toBe("");
    expect(shortNote("   ")).toBe("");
  });
});

describe("parsePastedExport", () => {
  it("reads a fixtures export", () => {
    const parsed = parsePastedExport(
      JSON.stringify({ version: 1, fixtures: [{ name: "One" }, { name: "Two" }, "junk"] }),
    );
    expect(parsed).toEqual({ type: "fixtures", fixtures: [{ name: "One" }, { name: "Two" }] });
  });

  it("reads a bare list of fixtures", () => {
    expect(parsePastedExport(JSON.stringify([{ name: "One" }]))).toEqual({
      type: "fixtures",
      fixtures: [{ name: "One" }],
    });
  });

  it("reads a session from another environment, with its title for a name", () => {
    const session = { id: "s1", title: "Digest email", messages: [{ role: "user" }] };
    expect(parsePastedExport(JSON.stringify(session))).toEqual({
      type: "session",
      session,
      title: "Digest email",
    });
  });

  it("says why it cannot read what it was given", () => {
    expect(parsePastedExport("   ")).toEqual({ type: "invalid", reason: "empty" });
    expect(parsePastedExport("{ nope")).toEqual({ type: "invalid", reason: "notJson" });
    expect(parsePastedExport(JSON.stringify({ hello: "world" }))).toEqual({
      type: "invalid",
      reason: "unrecognised",
    });
    expect(parsePastedExport(JSON.stringify({ fixtures: [] }))).toEqual({
      type: "invalid",
      reason: "noFixtures",
    });
    expect(parsePastedExport("42")).toEqual({ type: "invalid", reason: "unrecognised" });
  });
});

describe("suiteRows", () => {
  it("derives the totals a suite is read by", () => {
    const [row] = suiteRows([suite()]);
    expect(row).toMatchObject({
      id: "s1",
      trigger: "manual",
      status: "completed",
      passed: 4,
      runs: 6,
      plannedRuns: 6,
      gateViolations: 3,
      corrections: 2,
      judgeScore: 0.666,
      costUsd: 12,
      verdict: null,
      published: false,
      promptCode: null,
    });
  });

  it("has no totals for a suite still running, rather than zeros that read as a result", () => {
    const [row] = suiteRows([suite({ status: "running", summary: null })]);
    expect(row).toMatchObject({
      passed: null,
      runs: null,
      gateViolations: null,
      corrections: null,
      judgeScore: null,
      costUsd: null,
      plannedRuns: 6,
    });
  });

  it("carries a prompt gate's verdict and whether it was published", () => {
    const rows = suiteRows([
      suite({
        id: "gate-pass",
        trigger: "prompt_gate",
        candidate: { promptCode: "builder_interviewer_system", content: "x" },
        verdict: { pass: true, reasons: [], baselineSuiteId: "base" },
        publishedAt: "2026-10-20T10:00:00.000Z",
      }),
      suite({
        id: "gate-fail",
        trigger: "prompt_gate",
        candidate: { promptCode: "builder_platform_rules", content: "y" },
        verdict: { pass: false, reasons: ["Gate violations rose."], baselineSuiteId: "base" },
      }),
    ]);

    expect(rows[0]).toMatchObject({
      verdict: "pass",
      published: true,
      promptCode: "builder_interviewer_system",
    });
    expect(rows[1]).toMatchObject({
      verdict: "fail",
      published: false,
      promptCode: "builder_platform_rules",
    });
  });

  it("is empty for a list that has not arrived", () => {
    expect(suiteRows(undefined)).toEqual([]);
  });

  it("lists the newest first, whatever order they arrived in", () => {
    const rows = suiteRows([
      suite({ id: "oldest", createdAt: "2026-10-01T00:00:00.000Z" }),
      suite({ id: "newest", createdAt: "2026-10-20T00:00:00.000Z" }),
      suite({ id: "middle", createdAt: "2026-10-10T00:00:00.000Z" }),
    ]);
    expect(rows.map(row => row.id)).toEqual(["newest", "middle", "oldest"]);
  });
});

describe("anySuiteRunning", () => {
  it("is true while one suite is running", () => {
    expect(anySuiteRunning([suite(), suite({ id: "s2", status: "running" })])).toBe(true);
  });

  it("is false when every suite has settled, errored ones included", () => {
    expect(anySuiteRunning([suite(), suite({ id: "s2", status: "errored" })])).toBe(false);
    expect(anySuiteRunning(undefined)).toBe(false);
  });
});

describe("averageCostPerRun", () => {
  it("averages over completed suites, by run", () => {
    // 12 over 6 runs and 3 over 3 runs: 15 over 9.
    const average = averageCostPerRun([
      suite(),
      suite({ id: "s2", summary: { ...suite().summary!, runs: 3, costUsd: 3 } }),
      suite({ id: "s3", status: "running", summary: null }),
      suite({ id: "s4", status: "errored", summary: { ...suite().summary!, costUsd: 99 } }),
    ]);
    expect(average).toBeCloseTo(15 / 9);
  });

  it("is null before any suite has finished, so the warning does not invent a price", () => {
    expect(averageCostPerRun([suite({ status: "running", summary: null })])).toBeNull();
    expect(averageCostPerRun(undefined)).toBeNull();
  });
});

describe("formatting", () => {
  it("shows a missing score or cost as a dash, which is not zero", () => {
    expect(formatJudgeScore(null)).toBe("—");
    expect(formatJudgeScore(0)).toBe("0.00");
    expect(formatJudgeScore(0.666)).toBe("0.67");
    expect(formatEvalCost(undefined)).toBe("—");
    expect(formatEvalCost(0)).toBe("~$0.00");
    expect(formatEvalCost(1.234)).toBe("~$1.23");
  });

  it("formats passed over runs", () => {
    expect(formatPassed(4, 6)).toBe("4 of 6");
    expect(formatPassed(null, null)).toBe("—");
  });

  it("formats a run's clock", () => {
    expect(formatRunDuration(18_400)).toBe("18s");
    expect(formatRunDuration(125_000)).toBe("2m 05s");
    expect(formatRunDuration(null)).toBe("—");
    expect(formatRunDuration(-1)).toBe("—");
  });

  it("formats a start time, and a missing one", () => {
    expect(formatStarted("2026-10-20T09:00:00.000Z")).not.toBe("—");
    expect(formatStarted(null)).toBe("—");
    expect(formatStarted("not a date")).toBe("—");
  });
});

describe("gates", () => {
  it("lists every gate, marking each non-zero count and each false flag as failing", () => {
    const entries = gateEntries(
      gates({
        unseenFailures: 2,
        falseUpdateClaims: 1,
        falseReadyClaims: 1,
        evidenceCited: false,
      }),
    );

    expect(entries.map(entry => entry.key)).toEqual([
      "unseenFailures",
      "askedBeforeReading",
      "unrepairedEditFailures",
      "falseUpdateClaims",
      "falseReadyClaims",
      "consistent",
      "evidenceCited",
    ]);
    expect(entries.filter(entry => entry.failing).map(entry => entry.key)).toEqual([
      "unseenFailures",
      "falseUpdateClaims",
      "falseReadyClaims",
      "evidenceCited",
    ]);
    expect(gateViolationCount(gates({ falseReadyClaims: 2 }))).toBe(2);
  });

  it("leaves out a gate the run was scored before, rather than flag it", () => {
    const older = gates();
    delete older.falseReadyClaims;

    expect(gateEntries(older).map(entry => entry.key)).not.toContain("falseReadyClaims");
    expect(gateViolationCount(older)).toBe(0);
  });

  it("has no entries for a run with no gates, such as one that errored before scoring", () => {
    expect(gateEntries(null)).toEqual([]);
    expect(gateViolationCount(undefined)).toBe(0);
  });

  it("counts violations the way the backend does: every count, plus one per false flag", () => {
    expect(gateViolationCount(gates())).toBe(0);
    expect(
      gateViolationCount(
        gates({
          unseenFailures: 6,
          askedBeforeReading: 1,
          consistent: false,
          evidenceCited: false,
        }),
      ),
    ).toBe(9);
  });
});

describe("groupRunsByFixture", () => {
  const run = (overrides: Partial<BuilderEvalRun>): BuilderEvalRun => ({
    id: "r",
    fixtureId: "f1",
    repetition: 1,
    status: "passed",
    gates: null,
    metrics: null,
    judge: null,
    critic: null,
    transcript: null,
    finalPrd: null,
    error: null,
    ...overrides,
  });

  const detail = (overrides: Partial<BuilderEvalSuiteDetail> = {}): BuilderEvalSuiteDetail => ({
    ...suite({
      summary: {
        fixtures: [
          {
            fixtureId: "f1",
            name: "Name at the time",
            kind: "interview",
            runs: 2,
            passed: 1,
            gateViolations: 0,
            corrections: 0,
            judgeScore: null,
          },
        ],
        runs: 3,
        passed: 2,
        errored: 0,
        gateViolations: 0,
        corrections: 0,
        judgeScore: null,
        costUsd: 0,
      },
    }),
    runs: [
      run({ id: "r2", repetition: 2, status: "failed" }),
      run({ id: "r1", repetition: 1 }),
      run({ id: "r3", fixtureId: "f2", repetition: 1 }),
    ],
    ...overrides,
  });

  it("gathers runs under their fixture, in repetition order, counting the passes", () => {
    const groups = groupRunsByFixture(detail(), [
      interviewFixture({ id: "f2", name: "Live name" }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].fixtureId).toBe("f1");
    expect(groups[0].runs.map(r => r.id)).toEqual(["r1", "r2"]);
    expect(groups[0].passed).toBe(1);
    expect(groups[1].runs.map(r => r.id)).toEqual(["r3"]);
  });

  it("names a fixture as the suite ran it, then as it is now, and leaves a deleted one unnamed", () => {
    const groups = groupRunsByFixture(detail(), [
      interviewFixture({ id: "f2", name: "Live name" }),
    ]);
    expect(groups[0].name).toBe("Name at the time");
    expect(groups[1].name).toBe("Live name");

    const deleted = groupRunsByFixture(detail(), []);
    expect(deleted[1].name).toBeNull();
  });

  it("says a fixture expected nothing to build as its runs recorded it, else as it is now", () => {
    const shipped = interviewFixture({
      id: "f2",
      payload: {
        openingMessage: "x",
        adminScript: [],
        checklist: [],
        expectedOutcome: "nothing_to_build",
      },
    });
    const metrics = (expectedOutcome?: "prd_ready" | "nothing_to_build") =>
      ({
        turns: 2,
        questions: 0,
        corrections: 0,
        correctedItems: [],
        readyReached: false,
        readinessScore: 82,
        toolCalls: 4,
        toolFailures: 0,
        costUsd: 0.3,
        durationMs: 1,
        ...(expectedOutcome ? { expectedOutcome } : {}),
      }) as BuilderEvalRun["metrics"];

    // Runs from before the expectation was recorded: the live fixture answers.
    expect(groupRunsByFixture(detail(), [shipped])[1].expectsNothingToBuild).toBe(true);
    // Runs that recorded it win over a fixture that has changed since.
    const scoredAsPrd = detail({
      runs: [run({ id: "r3", fixtureId: "f2", metrics: metrics("prd_ready") })],
    });
    expect(groupRunsByFixture(scoredAsPrd, [shipped])[0].expectsNothingToBuild).toBe(false);
    const scoredAsNothing = detail({
      runs: [run({ id: "r1", metrics: metrics("nothing_to_build") })],
    });
    expect(groupRunsByFixture(scoredAsNothing, [])[0].expectsNothingToBuild).toBe(true);
  });

  it("is empty with no suite, or runs that are not a list", () => {
    expect(groupRunsByFixture(undefined, [])).toEqual([]);
    expect(groupRunsByFixture(detail({ runs: null as never }), [])).toEqual([]);
  });
});

describe("outcomeNote", () => {
  const metrics = (
    outcome: "prd_ready" | "nothing_to_build" | "neither" | undefined,
    expectedOutcome: "prd_ready" | "nothing_to_build" | undefined,
  ) =>
    ({
      turns: 2,
      questions: 0,
      corrections: 0,
      correctedItems: [],
      readyReached: outcome === "prd_ready",
      readinessScore: 82,
      toolCalls: 4,
      toolFailures: 0,
      costUsd: 0.3,
      durationMs: 1,
      ...(outcome ? { outcome } : {}),
      ...(expectedOutcome ? { expectedOutcome } : {}),
    }) as BuilderEvalRun["metrics"];

  it("reads a nothing-to-build fixture's run against that expectation", () => {
    expect(outcomeNote(metrics("nothing_to_build", "nothing_to_build"))).toEqual({
      key: "nothingAsExpected",
      failing: false,
    });
    expect(outcomeNote(metrics("prd_ready", "nothing_to_build"))).toEqual({
      key: "plannedBuild",
      failing: true,
    });
    expect(outcomeNote(metrics("neither", "nothing_to_build"))).toEqual({
      key: "didNotConclude",
      failing: true,
    });
  });

  // Suite 5d24dd95 scored three such runs as plain "not ready" failures.
  it("on a PRD fixture, says only when Builder concluded there was nothing to build", () => {
    expect(outcomeNote(metrics("nothing_to_build", "prd_ready"))).toEqual({
      key: "nothingButPrdExpected",
      failing: true,
    });
    expect(outcomeNote(metrics("prd_ready", "prd_ready"))).toBeNull();
    expect(outcomeNote(metrics("neither", "prd_ready"))).toBeNull();
  });

  it("says nothing for a run from before the outcome was recorded", () => {
    expect(outcomeNote(metrics(undefined, undefined))).toBeNull();
    expect(outcomeNote(null)).toBeNull();
  });
});
