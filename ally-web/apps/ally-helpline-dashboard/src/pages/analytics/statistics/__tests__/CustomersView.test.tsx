import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CustomerOrgRow, CustomerOverview } from "@types";

import { draftMessage } from "../customerDrafts";
import {
  CUSTOMER_CARD_IDS,
  CustomerCard,
  CustomerCardId,
  DEFAULT_CUSTOMER_LAYOUT,
} from "../CustomersView";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { language: "en" },
  }),
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

const record = vi.fn();
vi.mock("@api", () => ({
  useGetCustomerStatisticsQuery: () => ({ data: undefined }),
  useRecordCustomerOutreachMutation: () => [record, { isLoading: false }],
}));

const org = (over: Partial<CustomerOrgRow> = {}): CustomerOrgRow => ({
  tenantId: "t1",
  name: "Acme Health",
  code: "acme",
  learners: 40,
  activeLearners28d: 3,
  completedLast28d: 12,
  completedPrev28d: 50,
  lastCompletedAt: "2026-11-01T00:00:00Z",
  daysSinceLastCompleted: 23,
  trend: [5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0],
  creditUtilisationPct: 92.4,
  ratingsAverage90d: 4.1,
  ratingsCount90d: 20,
  reviewSharePercent: 60,
  neverStartedLearners: 4,
  belowFloor: false,
  reasons: [
    { id: "quiet", polarity: "attention", severity: 3, params: { days: 23 } },
    { id: "creditsNearLimit", polarity: "attention", severity: 2, params: { percent: 92 } },
  ],
  score: 5,
  contactedAt: null,
  contactNote: null,
  recentlyContacted: false,
  ...over,
});

const overview = (orgs: CustomerOrgRow[]): CustomerOverview => ({
  generatedAt: "2026-11-24T10:00:00Z",
  trendBuckets: [],
  summary: { orgs: orgs.length, activeOrgs: 1, quietOrgs: 1, needsOutreach: 1 },
  orgs,
  movers: { up: [], down: [{ tenantId: "t1", name: "Acme Health", from: 50, to: 12 }] },
});

const ALL: CustomerCardId[] = [...CUSTOMER_CARD_IDS];
const CardList = ({
  overview,
  ids = ALL,
}: {
  overview: CustomerOverview;
  ids?: CustomerCardId[];
}) => (
  <>
    {ids.map(id => (
      <CustomerCard key={id} id={id} overview={overview} />
    ))}
  </>
);

beforeEach(() => {
  record.mockReset();
  record.mockReturnValue({ unwrap: () => Promise.resolve() });
  toastError.mockReset();
});

describe("the Customers cards", () => {
  it("lists the organisations that need a message, each with its reasons", () => {
    render(
      <CardList
        overview={overview([
          org(),
          org({ tenantId: "t2", name: "Fine Co", reasons: [], score: 0 }),
        ])}
        ids={["reach", "table"]}
      />,
    );
    expect(screen.getByTestId("customers-reach-t1")).toBeTruthy();
    expect(screen.queryByTestId("customers-reach-t2")).toBeNull();
    expect(screen.getByTestId("customers-reason-quiet")).toBeTruthy();
    expect(screen.getByTestId("customers-reason-creditsNearLimit")).toBeTruthy();
    // Every organisation is in the table.
    expect(screen.getByTestId("customers-row-t1")).toBeTruthy();
    expect(screen.getByTestId("customers-row-t2")).toBeTruthy();
  });

  it("says so when no organisation needs a message", () => {
    render(<CardList overview={overview([org({ reasons: [], score: 0 })])} />);
    expect(screen.getByTestId("customers-reach-none")).toBeTruthy();
  });

  it("starts with five cards: the numbers, who to reach, rises, falls and the table", () => {
    expect(DEFAULT_CUSTOMER_LAYOUT).toEqual(["strip", "reach", "up", "down", "table"]);
    expect(CUSTOMER_CARD_IDS.length).toBeGreaterThan(DEFAULT_CUSTOMER_LAYOUT.length);
  });

  it("lists the organisations behind a reason in the cards for it", () => {
    render(
      <CardList
        overview={overview([
          org(),
          org({ tenantId: "t2", name: "Fine Co", reasons: [], score: 0 }),
        ])}
        ids={["quiet", "credits", "lowRating"]}
      />,
    );
    expect(
      within(screen.getByTestId("customers-card-quiet")).getByText("Acme Health"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("customers-card-credits")).getByText("Acme Health"),
    ).toBeTruthy();
    // Nothing in this organisation's numbers is a rating or a review worry.
    expect(screen.getByTestId("customers-card-lowRating").textContent).toContain(
      "customers.listNone",
    );
    expect(screen.queryByText("Fine Co")).toBeNull();
  });

  it("shows the strip, the movers and an em dash where a number is not drawn", () => {
    render(
      <CardList
        overview={overview([
          org({ creditUtilisationPct: null, ratingsAverage90d: null, belowFloor: true }),
        ])}
      />,
    );
    expect(screen.getByTestId("customers-strip").textContent).toContain("customers.strip.needs");
    expect(screen.getByTestId("customers-card-down").textContent).toContain("Acme Health");
    expect(screen.getByTestId("customers-row-t1").textContent).toContain("—");
  });

  it("shows a drafted message with one line per worry, and copies it", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: write } });
    render(<CardList overview={overview([org()])} />);
    fireEvent.click(screen.getByTestId("customers-draft-t1"));
    const text = screen.getByTestId("customers-draft-text").textContent ?? "";
    expect(text).toContain("Hi Acme Health team,");
    expect(text).toContain("no completed session for 23 days");
    expect(text).toContain("92% of your simulation credits");
    fireEvent.click(screen.getByTestId("customers-copy"));
    await waitFor(() => expect(write).toHaveBeenCalledWith(draftMessage(org())));
  });

  it("records a contact with the note, and shows a failure instead of closing", async () => {
    render(<CardList overview={overview([org()])} />);
    fireEvent.click(screen.getByTestId("customers-contacted-open-t1"));
    fireEvent.change(screen.getByTestId("customers-note"), {
      target: { value: "  Called the lead " },
    });
    fireEvent.click(screen.getByTestId("customers-save-contact"));
    await waitFor(() =>
      expect(record).toHaveBeenCalledWith({ tenantId: "t1", note: "Called the lead" }),
    );
    await waitFor(() => expect(screen.queryByTestId("customers-note")).toBeNull());

    record.mockReturnValue({ unwrap: () => Promise.reject(new Error("no")) });
    fireEvent.click(screen.getByTestId("customers-contacted-open-t1"));
    fireEvent.click(screen.getByTestId("customers-save-contact"));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByTestId("customers-note")).toBeTruthy();
  });

  it("shows when an organisation was last contacted, with the note", () => {
    render(
      <CardList
        overview={overview([
          org({
            contactedAt: "2026-11-20T10:00:00Z",
            contactNote: "Emailed",
            recentlyContacted: true,
          }),
        ])}
      />,
    );
    expect(screen.getByTestId("customers-contacted").textContent).toContain("Emailed");
  });
});

describe("draftMessage", () => {
  it("leaves out good news and says nothing about learners by name", () => {
    const text = draftMessage({
      name: "Acme",
      reasons: [
        { id: "activityUp", polarity: "celebrate", severity: 0, params: { from: 10, to: 30 } },
        {
          id: "neverStarted",
          polarity: "attention",
          severity: 2,
          params: { count: 1, percent: 50 },
        },
      ],
    });
    expect(text).not.toContain("picking up");
    expect(text).toContain("1 learner (50%) has not completed a session yet.");
  });
});
