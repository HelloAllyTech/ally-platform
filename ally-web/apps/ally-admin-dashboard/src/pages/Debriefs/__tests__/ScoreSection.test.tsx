import { render, screen, within } from "@testing-library/react";
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
import { ScoreByLanguage } from "../metrics/ScoreSection";
import { ok } from "./consoleFixtures";
/* eslint-enable import/first */

const VIEW = {
  current: 7.8,
  previous: 7.8,
  debriefs: 128,
  byWeek: [
    { week: "2026-10-26", score: 7.6, n: 30 },
    { week: "2026-11-02", score: 7.7, n: 31 },
    { week: "2026-11-09", score: 7.8, n: 33 },
  ],
  markers: [
    { week: "2026-11-02", kind: "live", changeId: "c1", title: "Shorter Work on this" },
    { week: "2026-11-09", kind: "undone", changeId: "c2", title: "Cheaper Writer" },
  ],
  measures: [
    {
      key: "quality",
      label: "Quality score (judge)",
      weight: 0.4,
      value: 7.9,
      display: "7.9",
      trend: "+0.1",
      tone: "up",
    },
    {
      key: "flags",
      label: "Cards flagged",
      weight: 0.15,
      value: 0.03,
      display: "3%",
      trend: "steady",
      tone: "flat",
    },
  ],
  gates: [
    { key: "risk", label: "New missed clear risk cues", ok: true, display: "0" },
    { key: "cost", label: "Cost per session", ok: false, display: "$1.20" },
  ],
  byLanguage: [
    { language: "en", score: 8.0, n: 90 },
    { language: "hi", score: 7.1, n: 12 },
  ],
};

beforeEach(() => h.score.mockReset());

describe("Analytics › Debriefs › More detail › Overall score by language", () => {
  it("shows only the score by language; the score, its parts and the gates lead the page", () => {
    h.score.mockReturnValue(ok(VIEW));
    render(<ScoreByLanguage />);
    expect(h.score).toHaveBeenCalledWith({ days: 84 });
    const byLang = screen.getByTestId("score-by-language");
    expect(byLang).toHaveTextContent("English");
    expect(byLang).toHaveTextContent("12 debriefs · too few to read");
    expect(screen.queryByTestId("score-measure-quality")).toBeNull();
    expect(screen.queryByTestId("score-chart")).toBeNull();
  });

  it("loading and errors use the page's chart card", () => {
    h.score.mockReturnValue({ data: undefined, isError: false });
    const { unmount } = render(<ScoreByLanguage />);
    expect(screen.getByTestId("chart-Overall score by language")).toHaveTextContent("loading");
    unmount();
    h.score.mockReturnValue({ data: undefined, isError: true, refetch: vi.fn() });
    render(<ScoreByLanguage />);
    expect(screen.getByTestId("chart-Overall score by language")).toHaveTextContent("error");
  });
});
