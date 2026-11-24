import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CustomerOverview } from "@types";

import { StaffForYouView, resolveCustomerLayout } from "../StaffForYouView";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { language: "en" },
  }),
}));
vi.mock("@hooks", () => ({ useUser: () => ({ user: { name: "Kriti Rao" } }) }));
const prefs = { data: undefined as unknown, saved: vi.fn() };
vi.mock("@api", () => ({
  useGetUserPreferencesQuery: () => ({ data: { data: prefs.data }, isLoading: false }),
  useUpdateUserPreferencesMutation: () => [prefs.saved],
  useRecordCustomerOutreachMutation: () => [vi.fn(), { isLoading: false }],
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const org = (id: string, over: Record<string, unknown> = {}) => ({
  tenantId: id,
  name: `Org ${id}`,
  code: id,
  learners: 20,
  activeLearners28d: 5,
  completedLast28d: 10,
  completedPrev28d: 10,
  lastCompletedAt: null,
  daysSinceLastCompleted: 30,
  trend: [0, 0, 0],
  creditUtilisationPct: null,
  ratingsAverage90d: null,
  ratingsCount90d: 0,
  reviewSharePercent: null,
  neverStartedLearners: 0,
  belowFloor: false,
  reasons: [{ id: "quiet", polarity: "attention", severity: 3, params: { days: 30 } }],
  score: 3,
  contactedAt: null,
  contactNote: null,
  recentlyContacted: false,
  ...over,
});
const overview = (orgs: ReturnType<typeof org>[]) =>
  ({
    generatedAt: "2026-11-24T10:00:00Z",
    trendBuckets: [],
    summary: {
      orgs: orgs.length,
      activeOrgs: orgs.length,
      quietOrgs: orgs.length,
      needsOutreach: orgs.length,
    },
    orgs,
    movers: { up: [], down: [] },
  }) as unknown as CustomerOverview;

const renderIt = (
  saved: unknown = undefined,
  o = overview([org("a")]),
  onLayoutChange = vi.fn(),
) => {
  render(<StaffForYouView overview={o} saved={saved} onLayoutChange={onLayoutChange} />);
  return onLayoutChange;
};

beforeEach(() => {
  prefs.data = undefined;
  prefs.saved.mockReset();
  prefs.saved.mockReturnValue({ unwrap: () => Promise.resolve() });
});

describe("resolveCustomerLayout", () => {
  it("is the default until a person chooses, and keeps an emptied list empty", () => {
    expect(resolveCustomerLayout(undefined)).toEqual(["strip", "reach", "up", "down", "table"]);
    expect(resolveCustomerLayout([])).toEqual([]);
  });

  it("keeps the cards a person chose, in the page's order, dropping unknown ones", () => {
    expect(resolveCustomerLayout(["table", "nope", "reach", 4, "reach"])).toEqual([
      "reach",
      "table",
    ]);
  });
});

describe("For you for Ally staff", () => {
  it("greets by name and shows the default cards", () => {
    renderIt();
    expect(screen.getByTestId("statistics-greeting").textContent).toContain("Kriti");
    ["strip", "reach", "up", "down", "table"].forEach(id =>
      expect(screen.getByTestId(`customers-card-${id}`)).toBeTruthy(),
    );
    expect(screen.queryByTestId("customers-card-quiet")).toBeNull();
  });

  it("says how many need a message, and what changed since the last visit", () => {
    renderIt();
    expect(screen.getByTestId("statistics-summary").textContent).toContain("summary.needs");
    expect(prefs.saved.mock.calls[0][0].statistics_seen_customers.current.findings).toEqual(["a"]);
  });

  it("compares with the last visit, counting a contacted organisation as handled", () => {
    prefs.data = {
      statistics_seen_customers: {
        current: {
          at: new Date(Date.now() - 30 * 3_600_000).toISOString(),
          findings: ["a", "b"],
          active: 2,
          sessions: 2,
        },
      },
    };
    renderIt(undefined, overview([org("a"), org("b", { recentlyContacted: true }), org("c")]));
    const text = screen.getByTestId("statistics-summary").textContent ?? "";
    expect(text).toContain("since.changed");
    expect(text).toContain('"added":1');
    expect(text).toContain('"resolved":1');
  });

  it("removes a card and adds one back, from Customise", () => {
    const onLayoutChange = renderIt(["strip", "reach"]);
    expect(screen.queryByTestId("customers-remove-reach")).toBeNull();
    fireEvent.click(screen.getByTestId("customers-customise"));
    fireEvent.click(screen.getByTestId("customers-remove-reach"));
    expect(onLayoutChange).toHaveBeenLastCalledWith(["strip"]);
    fireEvent.click(screen.getByTestId("customers-add-quiet"));
    expect(onLayoutChange).toHaveBeenLastCalledWith(["strip", "reach", "quiet"]);
    expect(screen.getByTestId("customers-library")).toBeTruthy();
    fireEvent.click(screen.getByTestId("customers-done"));
    expect(screen.queryByTestId("customers-library")).toBeNull();
  });

  it("says so when every card has been removed", () => {
    renderIt([]);
    expect(screen.getByTestId("customers-empty")).toBeTruthy();
  });
});
