import "@constants";
import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";
import { store } from "@store";
import type { RoadmapItemDetail, RoadmapItemRow, RoadmapItemsResponse } from "@types";

const capture = vi.hoisted(() => vi.fn());
const mockReview = vi.hoisted(() => vi.fn());
const unwrapOf = (fn: ReturnType<typeof vi.fn>) =>
  vi.fn((arg: unknown) => ({ unwrap: () => Promise.resolve(fn(arg)) }));

vi.mock("@ally-ui-mono/ui-shared", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  captureEvent: capture,
}));
vi.mock("../../../api/roadmapV2Flow", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useReviewRoadmapItemMutation: () => [unwrapOf(mockReview)],
  useReviewRoadmapBatchMutation: () => [unwrapOf(vi.fn())],
  useUndoRoadmapReviewMutation: () => [unwrapOf(vi.fn())],
  useSetRoadmapLeadMutation: () => [unwrapOf(vi.fn())],
  useStartRoadmapPlanningMutation: () => [unwrapOf(vi.fn()), { isLoading: false }],
  useGetRoadmapItemSimilarQuery: () => ({ data: { matches: [] } }),
  useGetRoadmapLeadSuggestionsQuery: () => ({
    data: {
      suggestedUserId: 7,
      candidates: [
        {
          user: { id: 7, name: "Priya", role: "builder" },
          leading: 1,
          limit: 3,
          freeSlots: 2,
          appsTouched: [],
          matchingIdeas: 0,
          score: 5,
        },
      ],
    },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetRoadmapItemQuery: (code: string) => ({ data: detail(code), isLoading: false }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), custom: vi.fn(), dismiss: vi.fn() },
}));

import { jobClock } from "../hooks/useRoadmapJobTimer";
import { RoadmapRoleProvider } from "../RoadmapGate";
import { TriageView } from "../triage/TriageView";

const row = (code: string, overrides: Partial<RoadmapItemRow> = {}): RoadmapItemRow => ({
  id: `id-${code}`,
  code,
  title: `Idea ${code}`,
  shownStage: "submitted",
  statusParts: { stage: "submitted", since: null, votes: 4 },
  author: { id: 1, name: "Ravi", role: "idea" },
  votes: 4,
  votedByMe: false,
  starred: false,
  unread: false,
  updatedAt: "2026-11-10T00:00:00Z",
  stageSince: "2026-11-02T00:00:00Z",
  whyHere: { kind: "awaitingReview", since: "2026-11-02T00:00:00Z" },
  ...overrides,
});

function detail(code: string): RoadmapItemDetail {
  return {
    ...row(code),
    summary: { who: "Learners mid-course", problem: "They forget to return" },
    runs: [],
    prs: [],
    releases: [],
    people: [],
    can: { review: true, pickLead: true },
    watchLevel: "none",
  } as RoadmapItemDetail;
}

const data = (): RoadmapItemsResponse => ({
  sections: {
    backlog: [
      row("OPP-414"),
      row("OPP-402", {
        shownStage: "accepted",
        whyHere: { kind: "needsLead", since: "2026-11-01T00:00:00Z" },
      }),
    ],
  },
});

const renderTriage = (open: string) =>
  render(
    <Provider store={store}>
      <MemoryRouter>
        <RoadmapRoleProvider value={{ role: "owner", can: {} } as never}>
          <TriageView
            data={data()}
            isLoading={false}
            isError={false}
            onRetry={vi.fn()}
            breakpoint="desktop"
            selected={open}
            open={open}
            onOpen={vi.fn()}
            onVisibleCodes={vi.fn()}
          />
        </RoadmapRoleProvider>
      </MemoryRouter>
    </Provider>,
  );

const events = (name: string) => capture.mock.calls.filter(([event]) => event === name);

beforeEach(() => {
  jobClock.reset();
  capture.mockClear();
  mockReview.mockReset();
  mockReview.mockReturnValue({ item: detail("OPP-414"), undoToken: "u1" });
});
afterEach(() => vi.useRealTimers());

describe("triage_one timing (P8, §4.16)", () => {
  it("starts when a row awaiting review takes focus and completes on its next step (Start planning)", async () => {
    renderTriage("OPP-414");
    expect(events("roadmap_job_started")).toEqual([
      ["roadmap_job_started", { job: "triage_one", role: "owner", item_id: "OPP-414" }],
    ]);

    fireEvent.keyDown(window, { key: "l" });
    await waitFor(() => expect(events("roadmap_job_completed")).toHaveLength(1));
    const [, props] = events("roadmap_job_completed")[0];
    expect(props).toMatchObject({ job: "triage_one", role: "owner", item_id: "OPP-414" });
    expect(typeof props.duration_ms).toBe("number");
  });

  it("does not time a Needs a lead row: picking a lead is not a review", () => {
    renderTriage("OPP-402");
    expect(events("roadmap_job_started")).toHaveLength(0);
  });
});
