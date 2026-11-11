import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({ metrics: vi.fn() }));

// Carbon needs a real layout engine; the stubs expose what each chart was given.
vi.mock("@components/charts", () => ({
  LineChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="line-chart" data-points={data.length} />
  ),
  AreaChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="area-chart" data-series={JSON.stringify(data)} />
  ),
}));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetDebriefMetricsQuery: (args: unknown) => h.metrics(args),
}));

// eslint-disable-next-line import/first
import { groupLabel, MetricsTab, orchestratorRows, targetState } from "../MetricsTab";
// eslint-disable-next-line import/first
import { kappaWords } from "../metrics/metricsCharts";
// eslint-disable-next-line import/first
import { headlineNumbers, niceCeiling, weekOnWeek, wilson } from "../metrics/metricsData";
// eslint-disable-next-line import/first
import { emptyView, fullView, rate } from "./metricsFixture";

const answer = (data: unknown, extra: Record<string, unknown> = {}) => ({
  data,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
  ...extra,
});

describe("Debriefs tab: headline tiles", () => {
  beforeEach(() => h.metrics.mockReturnValue(answer(fullView())));

  it("shows pass rate with its 95% range and count, and the other five headline numbers", () => {
    const view = fullView();
    const n = headlineNumbers(view);
    render(<MetricsTab />);
    const tiles = screen.getByTestId("metrics-tiles");
    const ci = wilson(n.pass.n, n.pass.of);
    expect(tiles).toHaveTextContent(`${Math.round((n.pass.n / n.pass.of) * 1000) / 10}%`);
    expect(tiles).toHaveTextContent(`${n.pass.n} of ${n.pass.of} scored debriefs passed`);
    expect(ci.low).not.toBeNull();
    expect(tiles).toHaveTextContent("Hard-fail rate");
    expect(tiles).toHaveTextContent("Judge score, mean");
    expect(tiles).toHaveTextContent(String(n.debriefs));
    expect(tiles).toHaveTextContent("Not ready: model unreachable");
    expect(tiles).toHaveTextContent("Not scored yet");
    expect(tiles).toHaveTextContent("vs the week before");
  });

  it("compares only two weeks that both have enough to read", () => {
    expect(weekOnWeek([rate(15, 20), rate(18, 20)])).toBeCloseTo(15);
    expect(weekOnWeek([rate(1, 5), rate(18, 20)])).toBeNull();
    expect(weekOnWeek([rate(18, 20)])).toBeNull();
  });
});

describe("Debriefs tab: pass rate", () => {
  beforeEach(() => h.metrics.mockReturnValue(answer(fullView())));

  it("plots pass rate and hard-fail rate by week with a 95% band, and names thin weeks", () => {
    render(<MetricsTab />);
    const pass = JSON.parse(
      within(screen.getByTestId("metrics-pass-by-week"))
        .getByTestId("area-chart")
        .getAttribute("data-series")!,
    );
    expect(pass).toHaveLength(12);
    expect(pass[11]).toMatchObject({ group: "Pass rate", key: "2026-11-09" });
    expect(pass[11].min).toBeLessThan(pass[11].value);
    expect(pass[11].max).toBeGreaterThan(pass[11].value);
    expect(screen.getByTestId("metrics-hard-fail-by-week")).toBeInTheDocument();
    // The first week has 13 scored debriefs.
    expect(screen.getByTestId("metrics-quality")).toHaveTextContent(
      "Too few to read (under 20 scored): 2026-08-24",
    );
  });

  it("keeps the exact numbers in a table view, with the window total summed in the browser", () => {
    const group = (n: number, of: number) => ({
      passRate: { n, of, value: of ? n / of : null, low: 0.62, high: 0.9 },
      outages: 1,
      unjudged: 2,
      hardFailRate: { n: of - n, of, value: of ? (of - n) / of : null },
      judgeMean: 8.4,
    });
    h.metrics.mockReturnValue(
      answer({
        ...fullView(),
        quality: {
          byWeek: [{ week: "2026-11-02", ...group(24, 30) }],
          byLanguage: [{ language: "hi-IN", debriefs: 30, ...group(24, 30) }],
          bySegment: [
            {
              language: "hi-IN",
              writerModel: "gemini-3-flash-preview",
              judgeVersion: "gemini-2.5-pro/v3+g1",
              debriefs: 30,
              ...group(24, 30),
            },
          ],
        },
      }),
    );
    render(<MetricsTab />);
    expect(screen.getByTestId("metrics-quality-headline")).toHaveTextContent(
      "80% (95% range 62.7%–90.5%, 24 of 30)",
    );
    expect(screen.getByTestId("metrics-tiles")).toHaveTextContent(
      "95% range 62.7%–90.5%. 24 of 30 scored debriefs passed.",
    );
    expect(screen.getByTestId("metrics-quality-weeks")).toHaveTextContent("95% range 62%–90%");
    expect(screen.getByTestId("metrics-quality-segments")).toHaveTextContent(
      "gemini-2.5-pro/v3+g1",
    );
  });

  it("draws every breakdown as sorted dots with whiskers, thin groups hollow and labelled", () => {
    render(<MetricsTab />);
    const lang = screen.getAllByTestId("metrics-by-language-dots-row");
    expect(lang.map(r => r.textContent?.slice(0, 5))).toEqual(["en-IN", "hi-IN", "ta-IN", "kn-IN"]);
    // kn-IN has 9 scored: too few to read, sorted last and marked.
    expect(lang[3]).toHaveAttribute("data-thin", "true");
    expect(lang[3]).toHaveTextContent("too few to read");
    expect(lang[0]).not.toHaveAttribute("data-thin");
    expect(lang[0]).toHaveTextContent("Hard fail");
    // Ordered groups keep their order.
    const lengths = screen.getAllByTestId("metrics-breakdown-session-length-dots-row");
    expect(lengths.map(r => r.querySelector("span span")?.textContent)).toEqual([
      "6-15",
      "16-30",
      "31-60",
      "61+",
    ]);
    expect(screen.getByTestId("metrics-breakdown-step-model")).toHaveTextContent(
      "Safety reader: gpt-5-mini (backup)",
    );
    expect(screen.getByTestId("metrics-breakdown-risk")).toHaveTextContent("38 of 58");
  });

  it("shows the eight largest skills until the reader asks for all", () => {
    render(<MetricsTab />);
    expect(screen.getAllByTestId("metrics-breakdown-skill-dots-row")).toHaveLength(8);
    fireEvent.click(within(screen.getByTestId("metrics-breakdown-skill")).getByText("Show all 12"));
    expect(screen.getAllByTestId("metrics-breakdown-skill-dots-row")).toHaveLength(12);
  });

  it("leaves an empty breakdown out", () => {
    const v = fullView();
    v.quality!.breakdowns!.course = [];
    h.metrics.mockReturnValue(answer(v));
    render(<MetricsTab />);
    expect(screen.queryByTestId("metrics-breakdown-course")).toBeNull();
  });
});

describe("Debriefs tab: steering, guardrails, experience, uptake", () => {
  beforeEach(() => h.metrics.mockReturnValue(answer(fullView())));

  it("charts the steering score with its three parts and says which weeks lacked a part", () => {
    render(<MetricsTab />);
    expect(screen.getByTestId("line-chart")).toHaveAttribute("data-points", "48");
    expect(screen.getByTestId("metrics-steering")).toHaveTextContent(
      "Judge 50% · Practise next 25% · Thumbs-up 25%",
    );
    expect(screen.getByTestId("steering-partial")).toHaveTextContent("2026-08-24: Without thumbs");
  });

  it("draws every guardrail against its target, with the baselines and the state in words", () => {
    render(<MetricsTab />);
    const g = screen.getByTestId("metrics-guardrails");
    expect(g).toHaveTextContent("Below today's debrief: 13.7%");
    expect(g).toHaveTextContent("Not above before launch: 7%");
    // the slowest 10% took 131 s against 120 s
    expect(screen.getByTestId("metrics-guardrails-visible")).toHaveTextContent("Off target");
    expect(screen.getByTestId("metrics-guardrails-cost")).toHaveTextContent("On target");
    expect(screen.getByTestId("metrics-guardrails-fabricated")).toHaveTextContent("Off target");
    expect(g).toHaveTextContent("Measured offline by the safety-recall gate");
  });

  it("shows experience over the window against targets, and by language and device", () => {
    render(<MetricsTab />);
    expect(screen.getByTestId("metrics-experience-opened")).toHaveTextContent("On target");
    expect(screen.getByTestId("metrics-experience-read")).toHaveTextContent("Off target");
    expect(screen.getByTestId("metrics-experience-listened")).not.toHaveTextContent("target");
    expect(screen.getByTestId("metrics-by-language")).toHaveTextContent("kn-IN");
    expect(screen.getByTestId("metrics-by-device")).toHaveTextContent("ios");
  });

  it("marks a rate with fewer than 20 counted as too few to read", () => {
    expect(targetState(1, { atLeast: 0.85 }, 5)).toBe("thin");
    expect(targetState(null, { atLeast: 0.85 })).toBe("no_data");
    expect(targetState(0.9, { atLeast: 0.85 }, 40)).toBe("met");
  });

  it("draws uptake lift per month as whiskers, insufficient below 150 pairs", () => {
    render(<MetricsTab />);
    const u = screen.getByTestId("metrics-uptake");
    expect(screen.getByTestId("uptake-2026-08")).toHaveTextContent(
      "Insufficient data (64 of 150 pairs)",
    );
    expect(screen.getByTestId("uptake-2026-10")).toHaveTextContent(
      "0.11 (0.03 to 0.19) over 233 pairs",
    );
    expect(u).toHaveTextContent("+0.11 [+0.03 to +0.19] · 233");
    expect(u).toHaveTextContent("insufficient data, needs 150 pairs (n = 64)");
  });
});

describe("Debriefs tab: each agent", () => {
  beforeEach(() => h.metrics.mockReturnValue(answer(fullView())));

  it("puts the step that fails most at the top, and times every step", () => {
    render(<MetricsTab />);
    const fails = screen.getAllByTestId("agents-failures-row");
    expect(fails[0]).toHaveTextContent("Analyst (agent)");
    // Course patterns ran 14 times: too few to read, last.
    expect(fails[fails.length - 1]).toHaveTextContent("Course patterns");
    expect(fails[fails.length - 1]).toHaveAttribute("data-thin", "true");
    const times = screen.getAllByTestId("agents-time-row");
    expect(times[0]).toHaveTextContent("Writer");
    expect(times[0]).toHaveTextContent("18.2s / 31s");
  });

  it("reads the Evaluator's agreement with the judge on a plain-language scale", () => {
    render(<MetricsTab />);
    expect(screen.getByTestId("evaluator-kappa")).toHaveTextContent(
      "0.62: substantial agreement beyond chance, over 412 debriefs",
    );
    expect(kappaWords(0.1)).toBe("Slight");
    expect(kappaWords(-0.2)).toBe("No agreement");
    expect(kappaWords(0.95)).toBe("Almost perfect");
  });

  it("shows the PM agent's outcomes and the writer's failures as bars", () => {
    render(<MetricsTab />);
    expect(screen.getByTestId("pm-outcome")).toHaveTextContent("Waiting 10");
    const failures = screen.getByTestId("writer-failures");
    expect(failures).toHaveTextContent("Quote doesn't match what was said41");
    expect(failures).toHaveTextContent("A card is too long33");
    // No raw check id reaches the chart.
    expect(failures).not.toHaveTextContent(/[a-z]+_[a-z]+/);
    expect(screen.getByTestId("agent-registry-protocol_check")).toHaveTextContent(
      "Findings that name the protocol",
    );
  });

  it("keeps every agent's numbers in the table view", () => {
    render(<MetricsTab />);
    const t = screen.getByTestId("metrics-agents-table");
    const row = (measure: string) => within(t).getAllByText(measure)[0].closest("tr")!;
    expect(row("First drafts that passed every check")).toHaveTextContent("289 of 412");
    expect(
      row("Agreement with the judge on missed risk cues, beyond chance (0–1)"),
    ).toHaveTextContent("0.62");
    expect(row("Pass rate (needs the Ask Ally judge)")).toHaveTextContent("Not measured yet");
    expect(row("Promoted / reverted / rejected / waiting")).toHaveTextContent("1 / 0 / 2 / 10");
  });
});

describe("Debriefs tab: states", () => {
  it("says there are no live debriefs, and draws no empty charts, when every organisation is off", () => {
    h.metrics.mockReturnValue(answer(emptyView()));
    render(<MetricsTab />);
    expect(screen.getByTestId("metrics-no-live")).toHaveTextContent(
      "No live debriefs in this window",
    );
    expect(screen.getByTestId("metrics-no-live")).toHaveTextContent("Organisations");
    expect(screen.queryByTestId("metrics-quality")).toBeNull();
    expect(screen.queryByTestId("metrics-guardrails")).toBeNull();
    expect(screen.getByTestId("metrics-tiles")).toHaveTextContent("Debriefs");
    expect(screen.getByTestId("metrics-uptake")).toHaveTextContent(
      "No month has paired sessions yet.",
    );
  });

  it("shows tile and chart skeletons while the first answer loads", () => {
    h.metrics.mockReturnValue({ data: undefined, isError: false, refetch: vi.fn() });
    render(<MetricsTab />);
    expect(screen.getByTestId("debrief-metrics-loading")).toBeInTheDocument();
  });

  it("offers a retry when the metrics cannot be loaded", () => {
    const refetch = vi.fn();
    h.metrics.mockReturnValue({ data: undefined, isError: true, error: {}, refetch });
    render(<MetricsTab />);
    expect(screen.getByText("Couldn't load the debrief metrics")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Retry"));
    expect(refetch).toHaveBeenCalled();
  });

  const choose = async (user: ReturnType<typeof userEvent.setup>, name: RegExp, option: string) => {
    await user.click(screen.getByRole("combobox", { name }));
    await user.click(await screen.findByRole("option", { name: option }));
  };
  const lastQuery = () => h.metrics.mock.calls[h.metrics.mock.calls.length - 1][0];

  it("reads the page's time range, in weeks", () => {
    h.metrics.mockReturnValue(answer(fullView()));
    const { rerender } = render(<MetricsTab />);
    expect(lastQuery()).toEqual({ weeks: 13 });
    rerender(<MetricsTab range="30d" />);
    expect(lastQuery()).toEqual({ weeks: 5 });
    rerender(<MetricsTab range="12m" />);
    expect(lastQuery()).toEqual({ weeks: 52 });
  });

  it("filters every metric by organisation, language, level, debrief type, release and judge version", async () => {
    const user = userEvent.setup();
    h.metrics.mockReturnValue(answer(fullView()));
    render(<MetricsTab />);
    for (const id of [
      "organisation",
      "language",
      "learnerLevel",
      "recipe",
      "releaseVersion",
      "judgeVersion",
    ]) {
      expect(screen.getByTestId(`metrics-filter-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByRole("combobox", { name: /learner level/i })).toHaveTextContent(
      "All learner levels",
    );
    await choose(user, /learner level/i, "Lay helper");
    await choose(user, /language/i, "hi-IN");
    await choose(user, /release/i, "v5");
    await waitFor(() =>
      expect(lastQuery()).toMatchObject({
        weeks: 13,
        learnerLevel: "lay",
        language: "hi-IN",
        releaseVersion: 5,
      }),
    );
    expect(screen.getByTestId("metrics-unfiltered-note")).toHaveTextContent(
      "Not filtered: baselines, uptake lift and the PM agent.",
    );
    await user.click(screen.getByTestId("metrics-filter-clear"));
    await waitFor(() => expect(lastQuery()).toEqual({ weeks: 13 }));
  });

  it("says when the filters match nothing", async () => {
    const user = userEvent.setup();
    h.metrics.mockReturnValue(answer({ ...emptyView(), filterOptions: fullView().filterOptions }));
    render(<MetricsTab />);
    await choose(user, /language/i, "ta-IN");
    await waitFor(() =>
      expect(screen.getByTestId("metrics-no-live")).toHaveTextContent(
        "No live debriefs match these filters",
      ),
    );
  });

  it("holds the last answer, dimmed, while a new filter loads", () => {
    h.metrics.mockReturnValue(answer(fullView(), { isFetching: true }));
    const { container } = render(<MetricsTab />);
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
    expect(container.firstElementChild).toHaveClass("opacity-60");
  });

  it("zooms a small-rate axis to a round ceiling", () => {
    expect(niceCeiling([0.03])).toBe(0.05);
    expect(niceCeiling([0.12, 0.04])).toBe(0.2);
    expect(niceCeiling([0.9])).toBe(1);
  });
});

describe("the orchestrator's rows in the agents table", () => {
  const rt = (n: number, of: number) => ({
    n,
    of,
    value: of ? n / of : null,
    low: of ? 0.1 : null,
    high: of ? 0.9 : null,
  });
  const health = { ran: 7, failRate: rt(1, 8), retryRate: rt(0, 8), msP50: 1200, msP90: 3000 };
  const agentRow = (agent: string, floor = false) => ({
    agent,
    floor,
    ...health,
    offered: 3,
    chosenRate: floor ? rt(0, 0) : rt(1, 3),
    findingsPerRunMean: 1,
    droppedQuoteRate: rt(1, 2),
    usedByWriterRate: rt(1, 1),
    judgedHardFailRate: rt(0, 1),
    topHardFails: [],
  });
  const o = {
    runs: 7,
    planner: {
      ...health,
      fallbackRate: rt(1, 7),
      timeoutRate: rt(1, 7),
      fallbackReasons: [{ code: "planner_failed", runs: 1 }],
      agentsChosenMean: 1.3,
      agentsChosenP50: 1,
      droppedForBudgetRate: rt(1, 7),
      droppedForTimeRate: rt(0, 7),
      droppedUnavailableRate: rt(0, 7),
      chosen: [{ code: "guidance_lookup", runs: 4 }],
    },
    topUp: { reachedRate: rt(1, 7), addedRate: rt(1, 1), passAfterTopUpRate: rt(1, 1) },
    skippedThenMissed: {
      overall: rt(2, 3),
      byAgent: [{ agent: "protocol_check", whenSkipped: rt(1, 2), whenChosen: rt(0, 1) }],
    },
    agents: [agentRow("analyst", true), agentRow("protocol_check"), agentRow("course_patterns")],
    protocolCheck: {
      contradictsProtocolRate: rt(0, 1),
      contradictsProtocolWithoutRate: rt(1, 2),
      appliedRate: rt(1, 1),
      protocolNamedRate: rt(1, 1),
    },
    languageSpecialist: { sessions: 1, missWithRate: rt(1, 1), missWithoutRate: rt(0, 0) },
    historyDeep: {
      unsupportedProgressWithRate: rt(0, 0),
      unsupportedProgressWithoutRate: rt(1, 1),
    },
    aggregates: [
      { agent: "course_patterns", ran: 1, noQuoteRate: rt(1, 1), smallGroupRefusedRate: rt(1, 1) },
    ],
  };
  const rows = orchestratorRows(o, x => `${x.msP50} / ${x.msP90}`);
  const find = (agent: string, measure: string) =>
    rows.find(r => r[0] === agent && r[1] === measure)?.[2];

  it("shows the planner's fallbacks, time, choices and skipped-then-missed with ranges", () => {
    expect(
      find(
        "Planner",
        "Fell back to the standard plan (planner failed, timed out or could not run)",
      ),
    ).toBe("14.3% (95% range 10%–90%, 1 of 7)");
    expect(find("Planner", "Why it fell back")).toBe("Planner failed or returned a bad plan (1)");
    expect(find("Planner", "Time, median / slowest 10%")).toBe("1200 / 3000");
    expect(find("Planner", "Agents chosen per debrief, mean / median")).toBe("1.3 / 1");
    expect(find("Planner", "Skipped Protocol check, then its miss showed up")).toContain("1 of 2");
    expect(find("Top-up", "Debriefs that passed after a top-up added agents")).toContain("1 of 1");
  });

  it("gives every registry agent its rows in plain words, plus the agent-specific ones", () => {
    expect(find("Analyst (agent)", "Chosen when available")).toBe(
      "Always runs (not chosen by the planner)",
    );
    expect(find("Protocol check", "Chosen when available")).toContain("1 of 3");
    expect(find("Protocol check", "Findings that name the protocol")).toContain("1 of 1");
    expect(find("Course patterns", "Refused: fewer than 5 learners in the group")).toContain(
      "1 of 1",
    );
  });
});

describe("groupLabel", () => {
  it("names the step in a step-model group and capitalises plain groups", () => {
    expect(groupLabel("safety_reader: gemini-2.5-flash")).toBe("Safety reader: gemini-2.5-flash");
    expect(groupLabel("risk cue")).toBe("Risk cue");
    expect(groupLabel("hi-IN")).toBe("hi-IN");
    expect(groupLabel("16-30")).toBe("16-30");
  });
});
