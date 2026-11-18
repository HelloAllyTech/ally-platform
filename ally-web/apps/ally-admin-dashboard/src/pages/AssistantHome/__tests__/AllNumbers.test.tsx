import React from "react";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

/**
 * All numbers on the Overview (chunk CL1): the classic usage tab's numbers, from the same four
 * analytics queries, in owner words.
 */
const queries = {
  overview: vi.fn(),
  timeseries: vi.fn(),
  languages: vi.fn(),
  coverage: vi.fn(),
};
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetWaAnalyticsOverviewQuery: (arg: unknown) => queries.overview(arg),
  useGetWaAnalyticsTimeseriesQuery: (arg: unknown) => queries.timeseries(arg),
  useGetWaAnalyticsLanguagesQuery: (arg: unknown) => queries.languages(arg),
  useGetWaCorpusCoverageQuery: (arg: unknown) => queries.coverage(arg),
}));

const { AllNumbers } = await import("../sections/AllNumbers");
const { HOME } = await import("../copy");
const t = HOME.allNumbers;

const OVERVIEW = {
  inbound: 1200,
  outbound: 1180,
  uniqueContacts: 310,
  answered: 900,
  declined: 100,
  clarified: 40,
  crisis: 2,
  template: 30,
  errors: 3,
  rateLimited: 0,
  unidentified: 5,
  declineRate: 0.1,
  latencyP50Ms: 6400,
  latencyP95Ms: 14200,
};
const result = (data: unknown, extra: Record<string, unknown> = {}) => ({
  data,
  isError: false,
  refetch: vi.fn(),
  ...extra,
});

beforeEach(() => {
  queries.overview.mockReturnValue(result(OVERVIEW));
  queries.timeseries.mockReturnValue(
    result([
      { bucket: "2026-11-08T00:00:00.000Z", handledBy: "rag", count: 30 },
      { bucket: "2026-11-08T00:00:00.000Z", handledBy: "declined", count: 5 },
      { bucket: "2026-11-09T00:00:00.000Z", handledBy: "rag", count: 12 },
      { bucket: "2026-11-09T00:00:00.000Z", handledBy: "template", count: 2 },
    ]),
  );
  queries.languages.mockReturnValue(
    result([
      { language: "English", total: 800, answered: 720, declined: 80, declineRate: 0.1 },
      { language: "Marathi", total: 4, answered: 3, declined: 1, declineRate: null },
    ]),
  );
  queries.coverage.mockReturnValue(
    result({
      rows: [
        { documentId: "d1", title: "Fees", chunkCount: 4, citations: 40, isArchived: false },
        { documentId: "d2", title: "Team", chunkCount: 3, citations: 0, isArchived: false },
        { documentId: "d3", title: "Old", chunkCount: 2, citations: 0, isArchived: true },
      ],
      totalDocuments: 3,
      omittedDocuments: 0,
    }),
  );
});

describe("All numbers", () => {
  it("shows the headline numbers in owner words", () => {
    render(<AllNumbers botId="bot-1" />);
    const stats = [
      ...screen
        .getByTestId("all-numbers")
        .querySelectorAll(".ally-home__stats dd:not(.ally-numbers__note)"),
    ];
    expect(stats.map(dd => dd.textContent)).toEqual(["1,200", "310", "10%", "6.4 s"]);
    expect(screen.getByText("1 in 20 took 14.2 s or longer")).toBeTruthy();
    expect(screen.getByText(t.errors)).toBeTruthy();
    expect(screen.getByText(t.unidentified)).toBeTruthy();
  });

  it("asks for the last 30 days, then the period chosen, for this assistant", () => {
    render(<AllNumbers botId="bot-1" />);
    const first = queries.overview.mock.lastCall?.[0] as { from: string; chatbotId: string };
    expect(first.chatbotId).toBe("bot-1");
    const days = (from: string) => Math.round((Date.now() - Date.parse(from)) / 86_400_000);
    expect(days(first.from)).toBe(30);

    fireEvent.click(screen.getByRole("radio", { name: t.last90 }));
    const next = queries.overview.mock.lastCall?.[0] as { from: string };
    expect(days(next.from)).toBe(90);
    // Every query asks for the same window.
    expect(queries.coverage.mock.lastCall?.[0]).toEqual(queries.overview.mock.lastCall?.[0]);
  });

  it("draws a bar per day with its total, and other outcomes as Other", () => {
    render(<AllNumbers botId="bot-1" />);
    expect(screen.getByRole("img", { name: "8 Nov: 35 replies" })).toBeTruthy();
    const ninth = screen.getByRole("img", { name: "9 Nov: 14 replies" });
    expect(ninth.querySelector(".ally-numbers__swatch--other")).toBeTruthy();
  });

  it("says when a language has too few questions for a rate", () => {
    render(<AllNumbers botId="bot-1" />);
    const marathi = screen.getByRole("row", { name: /Marathi/ });
    expect(within(marathi).getByText(t.tooFew)).toBeTruthy();
  });

  it("lists the documents it used and counts the unused ones, leaving out archived ones", () => {
    render(<AllNumbers botId="bot-1" />);
    expect(screen.getByText("Fees")).toBeTruthy();
    expect(screen.getByText("40 times")).toBeTruthy();
    expect(screen.getByText(t.notUsedOne)).toBeTruthy();
    expect(screen.queryByText("Old")).toBeNull();
  });

  it("says so when nothing came in", () => {
    queries.overview.mockReturnValue(result({ ...OVERVIEW, inbound: 0 }));
    render(<AllNumbers botId="bot-1" />);
    expect(screen.getByText(t.empty)).toBeTruthy();
  });

  it("offers a retry when a number can't load", () => {
    const refetch = vi.fn();
    queries.timeseries.mockReturnValue(result(undefined, { isError: true, refetch }));
    render(<AllNumbers botId="bot-1" />);
    expect(screen.getByRole("alert").textContent).toContain(t.loadFailed);
    fireEvent.click(screen.getByRole("button", { name: t.retry }));
    expect(refetch).toHaveBeenCalled();
  });
});
