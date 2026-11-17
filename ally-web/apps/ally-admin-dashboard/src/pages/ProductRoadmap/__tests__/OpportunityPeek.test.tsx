import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RoadmapOpportunity,
  RoadmapOpportunityEffort,
  RoadmapOpportunitySource,
  RoadmapOpportunityStage,
  RoadmapOpportunityType,
} from "@types";

const state = vi.hoisted(() => ({
  opp: undefined as unknown,
  isError: false,
  comments: [] as unknown[],
  matches: [] as unknown[],
  dupError: false,
  findDuplicates: vi.fn(),
}));

vi.mock("@api", () => ({
  useGetRoadmapOpportunityQuery: () => ({
    data: state.opp,
    isLoading: false,
    isError: state.isError,
    refetch: vi.fn(),
  }),
  useGetRoadmapCommentsQuery: () => ({ data: state.comments }),
  useGetRoadmapOpportunityBriefQuery: () => ({ data: undefined }),
  useRoadmapAiDuplicatesMutation: () => [
    (...args: unknown[]) => {
      state.findDuplicates(...args);
      return Promise.resolve();
    },
    { data: { matches: state.matches }, isLoading: false, isError: state.dupError },
  ],
}));
vi.mock("../useScoreUnit", () => ({ useScoreUnit: () => ({ enabled: false, unit: "votes" }) }));
vi.mock("@ally-ui-mono/ui-shared", () => ({ Tooltip: ({ children }: any) => <>{children}</> }));

import { OpportunityPeek } from "../OpportunityPeek";

const opp = (over: Partial<RoadmapOpportunity> = {}) =>
  ({
    id: "opp-1",
    code: "OPP-0001",
    description: "Voice notes\nLet counsellors dictate a note",
    type: RoadmapOpportunityType.IDEA,
    stage: RoadmapOpportunityStage.NEW,
    productGoal: "Scribe",
    owner: null,
    queueRank: 4,
    effort: RoadmapOpportunityEffort.L,
    plannedMonth: null,
    priorityScore: 12,
    compositeScore: 61,
    voterCount: 3,
    commentCount: 1,
    goalsHelped: 1,
    goalsTotal: 2,
    source: RoadmapOpportunitySource.STAFF,
    createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    creator: { id: 7, email: "asha.rao@example.com", name: "Asha Rao" },
    hasBrief: false,
    ...over,
  }) as RoadmapOpportunity;

const handlers = () => ({
  onClose: vi.fn(),
  onOpenFull: vi.fn(),
  onAccept: vi.fn(),
  onReject: vi.fn(),
  onRestore: vi.fn(),
  onOpenOther: vi.fn(),
  onMerge: vi.fn(),
});

describe("OpportunityPeek", () => {
  beforeEach(() => {
    state.opp = opp();
    state.isError = false;
    state.comments = [];
    state.matches = [];
    state.dupError = false;
    state.findDuplicates.mockClear();
  });

  it("shows the description and the facts the row leaves out", () => {
    render(<OpportunityPeek opportunityId="opp-1" canManage {...handlers()} />);
    expect(screen.getByText("Voice notes")).toBeTruthy();
    expect(screen.getByText("Let counsellors dictate a note")).toBeTruthy();
    expect(screen.getByText("Unassigned")).toBeTruthy();
    expect(screen.getByText(/3 days ago by Asha Rao/)).toBeTruthy();
    expect(screen.getByText("Unscheduled")).toBeTruthy();
    expect(screen.getByText(/12 votes|12 · 3 backers/)).toBeTruthy();
  });

  it("accepts and rejects an Idea, and opens the full drawer", () => {
    const h = handlers();
    render(<OpportunityPeek opportunityId="opp-1" canManage {...h} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "Open full" }));
    expect(h.onAccept).toHaveBeenCalledTimes(1);
    expect(h.onReject).toHaveBeenCalledTimes(1);
    expect(h.onOpenFull).toHaveBeenCalledTimes(1);
  });

  it("offers Restore, not Accept or Reject, on an archived row", () => {
    state.opp = opp({ stage: RoadmapOpportunityStage.ARCHIVED });
    const h = handlers();
    render(<OpportunityPeek opportunityId="opp-1" canManage {...h} />);
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(h.onRestore).toHaveBeenCalledTimes(1);
  });

  it("gives a reader without edit rights no decision buttons", () => {
    render(<OpportunityPeek opportunityId="opp-1" canManage={false} {...handlers()} />);
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });

  it("says it could not load, rather than that the row is gone", () => {
    state.opp = undefined;
    state.isError = true;
    render(<OpportunityPeek opportunityId="opp-1" canManage {...handlers()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load this opportunity");
  });

  it("lists comments", () => {
    state.comments = [
      { id: "c1", body: "Archived: Duplicate", createdAt: new Date().toISOString() },
    ];
    render(<OpportunityPeek opportunityId="opp-1" canManage {...handlers()} />);
    expect(screen.getByText("Archived: Duplicate")).toBeTruthy();
  });

  it("asks the duplicates endpoint once for this description", () => {
    render(<OpportunityPeek opportunityId="opp-1" canManage {...handlers()} />);
    expect(state.findDuplicates).toHaveBeenCalledTimes(1);
    expect(state.findDuplicates).toHaveBeenCalledWith({
      description: "Voice notes\nLet counsellors dictate a note",
      productGoal: "Scribe",
    });
  });

  it("lists possible duplicates without the opportunity itself, and merges from one", () => {
    state.matches = [
      {
        id: "opp-1",
        description: "Voice notes",
        productGoal: "Scribe",
        stage: "new",
        reason: "",
        similarity: 1,
      },
      {
        id: "opp-9",
        description: "Dictate notes",
        productGoal: "Scribe",
        stage: "prioritised",
        reason: "",
        similarity: 0.87,
      },
    ];
    const h = handlers();
    render(<OpportunityPeek opportunityId="opp-1" canManage {...h} />);
    expect(screen.getByText(/87% similar · Prioritised/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dictate notes" }));
    expect(h.onOpenOther).toHaveBeenCalledWith("opp-9");
    fireEvent.click(screen.getByRole("button", { name: "Merge…" }));
    expect(h.onMerge).toHaveBeenCalledWith("opp-1", "opp-9");
    expect(screen.queryByRole("button", { name: "Voice notes" })).toBeNull();
  });

  it("says when there are none", () => {
    render(<OpportunityPeek opportunityId="opp-1" canManage={false} {...handlers()} />);
    expect(screen.getByText("No close matches found.")).toBeTruthy();
  });

  it("offers no Merge to a reader who cannot edit", () => {
    state.matches = [
      {
        id: "opp-9",
        description: "Dictate notes",
        productGoal: "Scribe",
        stage: "new",
        reason: "",
        similarity: 0.9,
      },
    ];
    render(<OpportunityPeek opportunityId="opp-1" canManage={false} {...handlers()} />);
    expect(screen.queryByRole("button", { name: "Merge…" })).toBeNull();
  });

  it("says the check failed rather than that there are no duplicates", () => {
    state.dupError = true;
    render(<OpportunityPeek opportunityId="opp-1" canManage {...handlers()} />);
    expect(screen.getByText("Could not check for duplicates.")).toBeTruthy();
  });
});
