import { fireEvent, render, screen, within } from "@testing-library/react";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({ score: vi.fn() }));

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetDebriefScoreQuery: (arg: unknown) => h.score(arg),
}));
vi.mock("../../Analytics/chartKit", () => ({
  ChartCard: ({ title, loading, error }: any) => (
    <div data-testid={`chart-${title}`}>{loading ? "loading" : error ? "error" : ""}</div>
  ),
}));

/* eslint-disable import/first */
import { improveHeadline, ImprovementSection, toPct } from "../metrics/ImprovementSection";
/* eslint-enable import/first */

const pt = (week: string, n: number, overall: number | null, pass = 0.8) => ({
  week,
  n,
  overall,
  pass,
  helpful: 0.6,
  notFlagged: 0.95,
});

const DIMS = [
  { key: "actionability", weight: 0.15, score: 6.8, previous: 7.2, lost: 0.48 },
  { key: "accuracy", weight: 0.2, score: 8.4, previous: 8.4, lost: 0.32 },
  { key: "evidence_specificity", weight: 0.2, score: 8.5, previous: 8.1, lost: 0.3 },
  { key: "clarity", weight: 0.05, score: 6, previous: null, lost: 0.2 },
];

const VIEW = {
  current: 7.8,
  previous: null,
  debriefs: 59,
  byWeek: [],
  markers: [{ week: "2026-11-09", kind: "live", changeId: "c1", title: "Shorter Work on this" }],
  measures: [
    {
      key: "quality",
      label: "Quality score",
      weight: 0.4,
      value: 7.6,
      display: "",
      trend: "",
      tone: "flat",
    },
    {
      key: "pass",
      label: "Pass rate",
      weight: 0.25,
      value: 0.8,
      display: "",
      trend: "",
      tone: "flat",
    },
    {
      key: "helpful",
      label: "Helpful",
      weight: 0.2,
      value: 0.6,
      display: "",
      trend: "",
      tone: "flat",
    },
    {
      key: "flags",
      label: "Flags",
      weight: 0.15,
      value: 0.05,
      display: "",
      trend: "",
      tone: "flat",
    },
  ],
  gates: [
    { key: "risk", label: "No missed clear risk cue", ok: true, display: "None this week" },
    { key: "cost", label: "Within the session budget", ok: false, display: "$0.90 a session" },
  ],
  byLanguage: [],
  rolling: [
    pt("2026-10-19", 4, 7.0),
    pt("2026-10-26", 12, 7.1),
    pt("2026-11-02", 18, 7.3),
    pt("2026-11-09", 77, 7.5),
    pt("2026-11-16", 80, 7.6),
  ],
  quality: { current: 7.6, previous: 7.3, n: 70, dimensions: DIMS },
};

beforeEach(() => {
  h.score.mockReset();
  h.score.mockReturnValue({ data: VIEW, isError: false, isLoading: false, refetch: vi.fn() });
});

describe("Analytics › Debriefs: what Debrief improves", () => {
  it("reads the same 12 weeks as the rest of the page", () => {
    render(<ImprovementSection />);
    expect(h.score).toHaveBeenCalledWith({ days: 84 });
  });

  it("draws the overall score and its three other parts, with no quality score line", () => {
    render(<ImprovementSection />);
    for (const k of ["overall", "pass", "helpful", "notFlagged"]) {
      expect(screen.getByTestId(`improve-line-${k}`)).toBeTruthy();
    }
    expect(screen.queryByTestId("improve-line-quality")).toBeNull();
    const legend = screen.getByTestId("improve-legend");
    expect(within(legend).getByText("Pass rate")).toBeTruthy();
    expect(within(legend).getByText("25%")).toBeTruthy();
    expect(screen.getAllByTestId("improve-marker")).toHaveLength(1);
  });

  it("draws a point with under 20 debriefs hollow", () => {
    render(<ImprovementSection />);
    // Three thin points × four lines.
    expect(screen.getAllByTestId("improve-point-thin")).toHaveLength(12);
    expect(screen.getAllByTestId("improve-point")).toHaveLength(8);
  });

  it("shows every line's value for a week on hover", () => {
    render(<ImprovementSection />);
    fireEvent.mouseEnter(screen.getAllByTestId("improve-hit")[4]);
    const tip = screen.getByTestId("improve-tooltip");
    expect(within(tip).getByText("7.6 / 10")).toBeTruthy();
    expect(within(tip).getByText("80%")).toBeTruthy();
    expect(within(tip).getByText("80 debriefs in these 4 weeks")).toBeTruthy();
  });

  it("puts every line on one 0–100 scale: the overall ×10, shares ×100", () => {
    expect(toPct(pt("w", 30, 7.6), "overall")).toBeCloseTo(76);
    expect(toPct(pt("w", 30, 7.6), "pass")).toBeCloseTo(80);
    expect(toPct(pt("w", 30, null), "overall")).toBeNull();
  });

  it("compares the last four weeks with the four before only when both have enough", () => {
    expect(improveHeadline(VIEW.rolling as any)).toBe(
      "The overall score is 7.6 over the last 4 weeks.",
    );
    const enough = [
      pt("a", 30, 7.0),
      pt("b", 30, 7),
      pt("c", 30, 7),
      pt("d", 30, 7),
      pt("e", 30, 7.4),
    ];
    expect(improveHeadline(enough as any)).toBe(
      "The overall score rose 0.4 to 7.4 over the last 4 weeks.",
    );
    expect(improveHeadline([])).toMatch(/No overall score yet/);
  });

  it("shows the quality score as one bar of coloured shares, the legend sorted by points lost", () => {
    render(<ImprovementSection />);
    expect(screen.getByTestId("quality-current").textContent).toBe("7.6");
    // Each share is weight × score, out of 10: accuracy 0.2 × 8.4 = 1.68 → 16.8% of the bar.
    expect((screen.getByTestId("quality-seg-accuracy") as HTMLElement).style.width).toBe("16.8%");
    const rows = within(screen.getByTestId("quality-legend")).getAllByRole("listitem");
    expect(rows[0].textContent).toContain("Actionability");
    expect(rows[0].textContent).toContain("▼0.4");
    expect(rows[2].textContent).toContain("▲0.4");
  });

  it("marks a broken gate and leaves a holding one quiet", () => {
    render(<ImprovementSection />);
    expect(screen.getByTestId("gate-risk").getAttribute("data-ok")).toBe("true");
    expect(screen.getByTestId("gate-cost").textContent).toContain("Broken");
  });

  it("says so when it can't load, and the rest of the page still works", () => {
    h.score.mockReturnValue({ data: undefined, isError: true, isLoading: false, refetch: vi.fn() });
    render(<ImprovementSection />);
    expect(screen.getByTestId("chart-What Debrief improves").textContent).toBe("error");
  });
});
