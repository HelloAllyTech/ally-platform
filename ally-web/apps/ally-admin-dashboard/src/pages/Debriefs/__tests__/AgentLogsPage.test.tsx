import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({ logs: vi.fn() }));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("@api", async importOriginal => {
  const { ok, MODELS } = await import("./consoleFixtures");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useGetDebriefRunLogsQuery: () => h.logs(),
    useGetDebriefModelsQuery: () => ok(MODELS),
  };
});

/* eslint-disable import/first */
import { AgentLogEntry } from "@types";

import { Found } from "../session/AgentLogFindings";
import { AgentLogsPage, whyItRan } from "../session/AgentLogsPage";
import {
  filterEntries,
  givenItems,
  NO_FILTERS,
  overallOf,
  runSummary,
  stepOptions,
} from "../session/agentLogParts";
import { ok } from "./consoleFixtures";
/* eslint-enable import/first */

const WRITER_PROMPT = "You are the Writer. Write kindly.";

const base = (over: Partial<AgentLogEntry>): AgentLogEntry => ({
  seq: 0,
  kind: "code",
  step: "plan",
  round: null,
  startedAt: "2026-11-16T08:32:05Z",
  model: null,
  fallbackModel: null,
  prompt: null,
  input: {},
  output: {},
  tokensIn: null,
  tokensOut: null,
  costUsd: null,
  ms: 10,
  retries: 0,
  error: null,
  attention: false,
  origin: "fixed",
  planReason: null,
  ...over,
});

const TRANSCRIPT =
  "<transcript>\n[turn 1] CLIENT: Exams में फिर से fail हो गया।\n[turn 2] COUNSELLOR: ओह, कौन सा subject था?\n[turn 3] CLIENT: Maths.\n</transcript>";

const ENTRIES: AgentLogEntry[] = [
  base({
    seq: 1,
    step: "plan",
    input: { ceilingUsd: 0.475, deadlineMs: 150000, learnerTurns: 6 },
    output: { why: "A practice session.", next: ["safety_reader", "analyst"], recipe: "standard" },
  }),
  base({
    seq: 2,
    kind: "model",
    step: "safety_reader",
    model: "gemini-2.5-flash",
    costUsd: 0.004,
    input: `{{system_prompt}}\n\nSESSION LANGUAGE: hi-IN\n\n${TRANSCRIPT}`,
    output: {
      risk_cues: [
        {
          quote: "Kabhi kabhi lagta hai main mar jaaun",
          category: "suicide_or_self_harm",
          turn_index: 5,
          learner_response: "missed",
        },
      ],
      learner_distress: [],
    },
  }),
  base({
    seq: 3,
    kind: "model",
    step: "analyst",
    model: "gemini-2.5-pro",
    input: TRANSCRIPT,
    output: {
      behaviours: [
        {
          skill: "Exploring risk",
          observation: "missed",
          turn_index: 6,
          quote: null,
          note: "Ignored it.",
        },
        { skill: "Rapport", observation: "observed", turn_index: 2, quote: "कौन सा subject था?" },
        { skill: "Validation", observation: "partial", turn_index: 4, quote: null },
        { skill: "Open questions", observation: "missed", turn_index: 8, quote: null },
      ],
    },
  }),
  base({
    seq: 4,
    kind: "model",
    step: "planner",
    input: '<available_agents>\n["guidance_lookup", "history_deep"]\n</available_agents>',
    output: {
      actions: [
        { agent: "guidance_lookup", why: "A missed risk moment.", focus_turns: [5, 6] },
        { agent: "history_deep", why: "62 past debriefs.", focus_turns: [] },
      ],
      considered: [{ agent: "case_memory", why: "not a case" }],
    },
  }),
  base({
    seq: 5,
    step: "guidance_lookup",
    origin: "planned",
    planReason: "A missed risk moment.",
    input: { topic: "Exploring risk", situations: ["The client disclosed suicidal thoughts."] },
    output: {
      lookups: 3,
      passages: [{ code: "DG-0014", title: "Ask directly.", text: "Notice it, ask about it." }],
    },
  }),
  base({
    seq: 6,
    kind: "model",
    step: "history_deep",
    origin: "planned",
    planReason: "62 past debriefs.",
    attention: true,
    output: {
      findings: [
        { kind: "missed", point: "Keeps missing risk cues.", quote: null, turn_index: null },
      ],
    },
  }),
  base({
    seq: 7,
    kind: "model",
    step: "writer",
    model: "gemini-3-flash-preview",
    prompt: {
      code: "debrief_writer_system",
      version: 3,
      href: "/manage-prompts?prompt=debrief_writer_system&version=3",
      inlined: true,
    },
    input: `{{system_prompt}}\n\n${TRANSCRIPT}`,
    output: {
      opening: "You stayed with how tiring the exams felt.",
      what_worked: [
        { skill: "Empathy", lead: "Warm.", body: "It landed.", quote: "That sounds exhausting." },
      ],
      work_on_this: [{ skill: "Goal-setting", lead: "Ask first.", try_saying: "What would help?" }],
      practise_next: { skill: "Collaborative goal-setting", reason: "Next step." },
    },
  }),
  base({
    seq: 8,
    step: "checks",
    round: 0,
    output: {
      advisory: ["total_too_long"],
      failures: [{ code: "total_too_long", detail: "355 words; at most 220" }],
    },
  }),
  base({
    seq: 9,
    kind: "model",
    step: "evaluator",
    round: 0,
    output: {
      fixes: ["Give one concrete line the learner could say."],
      dimensions: [
        { score: 9, dimension: "accuracy" },
        { score: 6, dimension: "actionability" },
      ],
    },
  }),
  base({
    seq: 10,
    step: "score_draft",
    round: 0,
    input: { passScore: 8 },
    output: { next: "decide", overall: 7.5, draftMeetsBar: false },
  }),
  base({
    seq: 11,
    step: "decide",
    output: { why: "Published round 0: it passed every check.", status: "published" },
  }),
  base({
    seq: 12,
    kind: "model",
    step: "judge",
    output: {
      dimensions: [
        { score: 10, dimension: "accuracy" },
        { score: 9, dimension: "personalisation" },
      ],
      hard_fails: [],
    },
  }),
  base({
    seq: 13,
    step: "progress_vetoes",
    origin: null,
    output: { vetoed: ["skill_a"], count: 1 },
  }),
  base({
    seq: 14,
    step: "profile",
    input: { answered: {}, budgetLeftUsd: 0.3554, timeLeftMs: 126670 },
    output: {
      profile: {
        indic: false,
        turns: 39,
        course: false,
        scripts: { Latin: 1 },
        language: "en-IN",
        risk_cues: 2,
        assessment: false,
        code_mixed: false,
        case_memory: false,
        cohort_data: false,
        has_learner: true,
        session_type: "standard",
        time_left_ms: 126672,
        learner_turns: 16,
        org_protocols: 0,
        past_debriefs: 20,
        risk_cue_turns: [18, 39],
        budget_left_usd: 0.3554,
        live_detections: 12,
        script_mismatch: false,
        transcript_gaps: 0,
        learner_distress: false,
        past_work_on_this_points: 8,
      },
      offered: ["learner_history", "progress_reader"],
      floorReserveUsd: 0.044158,
      plannerModel: "gemini-2.5-flash",
      plannerEstimateUsd: 0.004854,
      next: "planner",
    },
  }),
];

const LOGS = {
  runId: "7f3a2c11-0000-0000-0000-000000000000",
  loggedFrom: "2026-11-14",
  run: {
    sessionId: "sess-1",
    scenarioTitle: "Exam stress, first call",
    status: "published",
    recipeKey: "standard",
    releaseVersion: 5,
    language: "hi-IN",
    costUsd: 0.114,
    seconds: 97,
  },
  entries: ENTRIES,
  prompts: { "debrief_writer_system@3": WRITER_PROMPT },
};

const byStep = (step: string) => ENTRIES.find(e => e.step === step)!;
const renderFound = (step: string) =>
  render(<Found entry={byStep(step)} entries={ENTRIES} expandAll={false} />);

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/debriefs/sessions/run-1/logs?cat=needs"]}>
      <Routes>
        <Route path="/debriefs/sessions/:runId/logs" element={<AgentLogsPage />} />
      </Routes>
    </MemoryRouter>,
  );

const writeText = vi.fn(async () => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  h.logs.mockReturnValue(ok(LOGS));
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

describe("agent log parts", () => {
  it("filters by source, step and problems together", () => {
    expect(filterEntries(ENTRIES, NO_FILTERS)).toHaveLength(ENTRIES.length);
    expect(filterEntries(ENTRIES, { ...NO_FILTERS, source: "planned" }).map(e => e.seq)).toEqual([
      5, 6,
    ]);
    expect(filterEntries(ENTRIES, { ...NO_FILTERS, step: "evaluator" }).map(e => e.seq)).toEqual([
      9,
    ]);
    expect(filterEntries(ENTRIES, { ...NO_FILTERS, onlyProblems: true }).map(e => e.seq)).toEqual([
      6,
    ]);
    expect(
      filterEntries(ENTRIES, { source: "fixed", step: "all", onlyProblems: true }),
    ).toHaveLength(0);
    // An entry from before sources were recorded matches only "All".
    expect(
      filterEntries(ENTRIES, { ...NO_FILTERS, source: "fixed" }).map(e => e.seq),
    ).not.toContain(13);
  });

  it("lists each step once, in run order, by its plain name", () => {
    const opts = stepOptions([...ENTRIES, base({ seq: 14, step: "evaluator", round: 1 })]);
    expect(opts.filter(o => o.value === "evaluator")).toHaveLength(1);
    expect(opts[0]).toEqual({ value: "plan", label: "Plan" });
    expect(opts.find(o => o.value === "evaluator")?.label).toBe("Draft score");
  });

  it("summarises time and cost against the plan's limits, and what the planner added", () => {
    const s = runSummary(LOGS);
    expect(s).toMatchObject({
      seconds: 97,
      deadlineSeconds: 150,
      costUsd: 0.114,
      ceilingUsd: 0.475,
    });
    expect(s.plannerAdded).toHaveLength(2);
    expect(runSummary({ ...LOGS, entries: [] })).toMatchObject({
      deadlineSeconds: 150,
      ceilingUsd: null,
      plannerAdded: null,
    });
  });

  it("splits a model's message into labelled parts, the transcript as speaker lines", () => {
    const items = givenItems(byStep("safety_reader"));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ label: "Transcript", count: "3 turns" });
    expect(items[0].body).toMatchObject({
      kind: "transcript",
      lines: [
        { turn: 1, speaker: "Client", text: "Exams में फिर से fail हो गया।" },
        { turn: 2, speaker: "Learner" },
        { turn: 3, speaker: "Client" },
      ],
    });
    const planner = givenItems(byStep("planner"));
    expect(planner[0]).toMatchObject({ label: "Agents it could add", count: "2" });
    expect(planner[0].body).toMatchObject({ kind: "text" });
    expect((planner[0].body as { text: string }).text).not.toContain("[");
  });

  it("an overall comes from the reply or, without one, from the dimensions", () => {
    expect(overallOf({ overall: 9.3 })).toBe(9.3);
    expect(overallOf(byStep("evaluator").output)).toBe(7.5);
    expect(overallOf({})).toBeNull();
  });

  it("says why each entry ran", () => {
    expect(whyItRan(byStep("plan"))).toBe("Always runs.");
    expect(whyItRan(byStep("guidance_lookup"))).toBe(
      "The planner chose it: “A missed risk moment.”",
    );
    expect(whyItRan(byStep("progress_vetoes"))).toMatch(/before sources were kept/);
  });
});

describe("per-step renderers", () => {
  it("Safety reader: a cue table", () => {
    renderFound("safety_reader");
    const table = within(screen.getByTestId("found-safety")).getByRole("table");
    expect(table).toHaveTextContent("“Kabhi kabhi lagta hai main mar jaaun”");
    expect(table).toHaveTextContent("Suicide or self harm");
    expect(table).toHaveTextContent("Missed");
    expect(screen.getByText(/Learner distress: none/)).toBeTruthy();
  });

  it("Analyst: three skill rows, then Show all", () => {
    renderFound("analyst");
    const box = screen.getByTestId("found-analyst");
    expect(box).toHaveTextContent("Exploring risk");
    expect(box).toHaveTextContent("Observed");
    expect(box).not.toHaveTextContent("Open questions");
    fireEvent.click(screen.getByRole("button", { name: /Show all 4 skills/ }));
    expect(box).toHaveTextContent("Open questions");
  });

  it("Planner: what it added with reasons, and what it did not", () => {
    renderFound("planner");
    const box = screen.getByTestId("found-planner");
    expect(box).toHaveTextContent("turns 5, 6 — A missed risk moment.");
    expect(box).toHaveTextContent("Not added:");
    expect(box).toHaveTextContent("(not a case)");
  });

  it("Guidance lookup: the kept passages as quotes with their codes", () => {
    renderFound("guidance_lookup");
    expect(screen.getByTestId("found-guidance")).toHaveTextContent("DG-0014 · Ask directly.");
  });

  it("Writer: the cards as the learner sees them", () => {
    renderFound("writer");
    const cards = screen.getByTestId("found-cards");
    expect(cards).toHaveTextContent("You stayed with how tiring the exams felt.");
    expect(cards).toHaveTextContent("What worked · Empathy");
    expect(cards).toHaveTextContent("Try: “What would help?”");
    expect(cards).toHaveTextContent("Practise this next · Collaborative goal-setting");
  });

  it("Rule checks: warnings and a tick", () => {
    renderFound("checks");
    const box = screen.getByTestId("found-checks");
    expect(box).toHaveTextContent("! Total too long — 355 words; at most 220 (advisory)");
    expect(box).toHaveTextContent("✓ Every other check passed");
  });

  it("Draft score: bars, the overall against the bar of 8, and the fixes", () => {
    renderFound("evaluator");
    const box = screen.getByTestId("found-draft-score");
    expect(box).toHaveTextContent("Actionability");
    expect(screen.getByTestId("draft-overall")).toHaveTextContent("Overall · bar is 87.5");
    expect(box).toHaveTextContent("Give one concrete line the learner could say.");
  });

  it("Decision: one sentence", () => {
    renderFound("decide");
    expect(screen.getByTestId("found-decision")).toHaveTextContent(
      "Published round 0: it passed every check.",
    );
  });

  it("Quality score: the score, hard fails and the lowest dimension", () => {
    renderFound("judge");
    const box = screen.getByTestId("found-quality");
    expect(box).toHaveTextContent("9.5");
    expect(box).toHaveTextContent("No serious problems. Lowest: Personalisation 9.");
  });

  it("findings agents: one line per finding", () => {
    renderFound("history_deep");
    expect(screen.getByTestId("found-findings")).toHaveTextContent(
      "MissedKeeps missing risk cues.",
    );
  });

  it("any other step: a key/value list, never JSON", () => {
    renderFound("progress_vetoes");
    const kv = screen.getByTestId("found-kv");
    expect(kv).toHaveTextContent("Vetoed");
    expect(kv).toHaveTextContent("Skill a");
    expect(kv.textContent).not.toMatch(/[{}"]/);
  });
});

describe("session profile and the generic card: plain by default, raw behind Show details", () => {
  it("the profile card is one sentence and the facts worth reading", () => {
    renderFound("profile");
    expect(screen.getByTestId("found-profile-sentence")).toHaveTextContent(
      "Looked over the session, then asked the planner to choose from: Learner history, Progress reader.",
    );
    const facts = screen.getByTestId("found-profile-facts");
    expect(
      within(facts)
        .getAllByRole("listitem")
        .map(li => li.textContent),
    ).toEqual([
      "2 risk cues, at turns 18 and 39",
      "16 learner turns of 39",
      "English (India)",
      "20 past debriefs, 8 earlier points to work on",
      "12 moments flagged live",
    ]);
    // Nothing for no, zero or false, and nothing mechanical.
    const card = screen.getByTestId("found-profile");
    expect(card.textContent).not.toMatch(
      /Indic|Code mixed|Case memory|Cohort|Time left|Budget|\$|ms\b/,
    );
    expect(screen.queryByTestId("log-details-rows")).toBeNull();
  });

  it("Show details holds the raw fields in plain labels and clean units", () => {
    renderFound("profile");
    fireEvent.click(screen.getByRole("button", { name: /Show details/ }));
    const rows = screen.getByTestId("log-details-rows");
    expect(rows).toHaveTextContent("Time left");
    expect(rows).toHaveTextContent("126.7 s");
    expect(rows).toHaveTextContent("Budget left");
    expect(rows).toHaveTextContent("$0.3554");
    expect(rows).toHaveTextContent("Held back for the safe path");
    expect(rows).toHaveTextContent("$0.0442");
    expect(rows).toHaveTextContent("Planner cost estimate");
    expect(rows).toHaveTextContent("$0.0049");
    expect(rows).toHaveTextContent("Earlier points to work on");
    expect(rows).toHaveTextContent("Learner history, Progress reader");
    expect(rows.textContent).not.toMatch(/Floor reserve|Past work on this points|_usd|_ms/);
  });

  it("a planner that was skipped says why, in a sentence", () => {
    render(
      <Found
        entry={base({
          step: "profile",
          output: {
            profile: {},
            offered: [],
            next: "dispatch",
            fallback: "The release names no planner model",
          },
        })}
        entries={ENTRIES}
        expandAll={false}
      />,
    );
    expect(screen.getByTestId("found-profile-sentence")).toHaveTextContent(
      "Used the default plan without asking the planner: the release names no planner model.",
    );
  });

  it("the generic card shows only what is worth reading and keeps the rest under Show details", () => {
    render(
      <Found
        entry={base({
          step: "some_new_step",
          output: { vetoed: ["skill_a"], count: 0, flagged: false, costUsd: 0.5, waitedMs: 2500 },
        })}
        entries={ENTRIES}
        expandAll={false}
      />,
    );
    const kv = screen.getByTestId("found-kv");
    expect(kv).toHaveTextContent("Vetoed");
    expect(kv).toHaveTextContent("Skill a");
    expect(kv.textContent).not.toMatch(/Count|Flagged|Cost|Waited|\$|ms\b/);
    fireEvent.click(screen.getByRole("button", { name: /Show details/ }));
    const rows = screen.getByTestId("log-details-rows");
    expect(rows).toHaveTextContent("Count");
    expect(rows).toHaveTextContent("Flagged");
    expect(rows).toHaveTextContent("$0.50");
    expect(rows).toHaveTextContent("2.50 s");
  });

  it("a card with nothing worth reading says so, and offers the details", () => {
    render(
      <Found
        entry={base({ step: "some_new_step", output: { count: 0, flagged: false } })}
        entries={ENTRIES}
        expandAll={false}
      />,
    );
    expect(screen.getByTestId("found-kv")).toHaveTextContent("Nothing notable.");
    expect(screen.getByRole("button", { name: /Show details/ })).toBeInTheDocument();
  });

  it("'What it was given' on a code step keeps time and money out of sight until Show details", () => {
    renderPage();
    const card = screen
      .getAllByTestId("log-entry")
      .find(c => c.textContent?.includes("Session profile"))!;
    const given = within(card).getByTestId("log-given");
    expect(given.textContent).not.toMatch(/Time left|Budget left|\(ms\)|\(USD\)/);
    expect(given).toHaveTextContent("Steps that answered");
    fireEvent.click(within(given).getByRole("button", { name: /Show details/ }));
    expect(within(given).getByTestId("log-details-rows")).toHaveTextContent("126.7 s");
  });
});

describe("Agent logs page", () => {
  it("shows the summary strip, the timeline and one card per entry", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Agent logs");
    expect(screen.getByTestId("tile-time")).toHaveTextContent("97 s of 150 s");
    expect(screen.getByTestId("tile-cost")).toHaveTextContent("of $0.475");
    expect(screen.getByTestId("tile-planner")).toHaveTextContent("Planner added");
    expect(screen.queryByText(/Outcome/)).toBeNull();
    expect(screen.getAllByTestId("log-entry")).toHaveLength(ENTRIES.length);
    const dots = screen.getAllByTestId("timeline-item");
    expect(dots[4]).toHaveAttribute("data-dot", "outline");
    expect(dots[0]).toHaveAttribute("data-dot", "filled");
  });

  it("each card has its header, why it ran, what it was given and what it found", () => {
    renderPage();
    const writer = screen.getAllByTestId("log-entry")[6];
    expect(within(writer).getByTestId("log-origin")).toHaveTextContent("Fixed");
    expect(within(writer).getByTestId("log-why")).toHaveTextContent("Why it ran: Always runs.");
    expect(within(writer).getByTestId("log-prompt-link")).toHaveAttribute(
      "href",
      "/manage-prompts?prompt=debrief_writer_system&version=3",
    );
    fireEvent.click(within(writer).getByRole("button", { name: /Transcript · 3 turns/ }));
    expect(within(writer).getByTestId("given-transcript")).toHaveTextContent("Learner");
    const old = screen.getAllByTestId("log-entry")[12];
    expect(within(old).getByTestId("log-origin")).toHaveTextContent("Source unknown");
    expect(within(old).getByTestId("log-meta")).toHaveTextContent("no model");
  });

  it("planned cards get the purple edge; problems a red border", () => {
    renderPage();
    const cards = screen.getAllByTestId("log-entry");
    expect(cards[4]).toHaveAttribute("data-origin", "planned");
    expect(cards[5]).toHaveAttribute("data-attention", "true");
    expect(within(cards[5]).getByText("Needs attention")).toBeTruthy();
    expect(within(cards[8]).getByText("Below the bar")).toBeTruthy();
  });

  it("the exact message stays collapsed until asked for, with the prompt's text put back", () => {
    renderPage();
    expect(screen.queryByTestId("log-exact")).toBeNull();
    expect(screen.queryByText(WRITER_PROMPT, { exact: false })).toBeNull();
    const writer = screen.getAllByTestId("log-entry")[6];
    fireEvent.click(within(writer).getByTestId("log-exact-toggle"));
    expect(within(writer).getByTestId("log-exact")).toHaveTextContent(WRITER_PROMPT);
  });

  it("filters by source, step and only problems; Expand all opens what each card was given", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "planned" } });
    expect(screen.getAllByTestId("log-entry")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("Step"), { target: { value: "judge" } });
    expect(screen.getAllByTestId("log-entry")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Step"), { target: { value: "all" } });
    fireEvent.click(screen.getByLabelText("Only problems"));
    expect(screen.getAllByTestId("log-entry")).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("Only problems"));
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "top_up" } });
    expect(screen.getByText("No entry matches these filters")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "all" } });
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getAllByTestId("given-transcript").length).toBeGreaterThan(1);
    expect(screen.getByRole("button", { name: "Collapse all" })).toBeTruthy();
  });

  it("keeps the filters on one row that never wraps", () => {
    renderPage();
    expect(screen.getByTestId("agent-logs-filters").className).toContain("flex-nowrap");
    expect(screen.getByTestId("agent-logs-strip").className).toContain("flex-nowrap");
  });

  it("a run from before logs were kept says from when they are", () => {
    h.logs.mockReturnValue(ok({ ...LOGS, entries: [] }));
    renderPage();
    expect(screen.getByText("No agent logs for this run")).toBeTruthy();
    expect(screen.getByText("Full agent logs are kept for runs from 14 Nov 2026.")).toBeTruthy();
  });

  it("loading and error states", () => {
    h.logs.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { unmount } = renderPage();
    expect(screen.getByTestId("ally-loading")).toBeTruthy();
    unmount();
    h.logs.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { status: 403 },
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Agent logs are for the Ally team only.")).toBeTruthy();
  });
});
