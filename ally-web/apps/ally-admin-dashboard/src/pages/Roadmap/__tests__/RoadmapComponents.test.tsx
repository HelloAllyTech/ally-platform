import "@constants";
import React from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";
import type { RoadmapCan, RoadmapItemDetail, RoadmapItemRow } from "@types";

const mockPatch = vi.fn();
const mockStar = vi.fn();
const mockWatch = vi.fn();
const mockAllocate = vi.fn();
const mockOpportunity = vi.fn((_id: string, opts?: { skip?: boolean }) =>
  opts?.skip ? { data: undefined } : { data: { id: "opp-uuid-388", myVotes: 0, stage: "new" } },
);

// Partial: the real module keeps baseAPI and the store intact; only the hooks under test are stubbed.
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetRoadmapOpportunityQuery: (id: string, opts?: { skip?: boolean }) =>
    mockOpportunity(id, opts),
  useGetRoadmapVoteBudgetQuery: (_arg: unknown, opts?: { skip?: boolean }) =>
    opts?.skip ? { data: undefined } : { data: { available: 10 } },
  useSetRoadmapAllocationMutation: () => [mockAllocate],
  usePatchRoadmapItemMutation: () => [mockPatch],
  useSetRoadmapStarMutation: () => [mockStar],
  useSetRoadmapWatchMutation: () => [mockWatch],
}));
vi.mock("../../ProductRoadmap/VoteButton", () => ({
  VoteButton: ({
    onSetVotes,
  }: {
    onSetVotes: (id: string, next: number, prev: number) => void;
  }) => (
    <button type="button" onClick={() => onSetVotes("opp-uuid-388", 1, 0)}>
      vote-button
    </button>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { deriveNavigationItems } from "../../../utils/navigation";
import { setReduceMotionSwitch, __resetReduceMotionForTests } from "../../../motion/roadmapMotion";
import { fromDropdownState, toDropdownState } from "../components/FilterControls";
import {
  IdeaStar,
  IdeaTitle,
  IdeaVotes,
  IdeaWatch,
  PrimaryAction,
} from "../components/IdeaControls";
import { QueueList, sectionsFor } from "../components/QueueList";
import { QueueRow } from "../components/QueueRow";
import { Tracker } from "../components/Tracker";
import { applyPresence } from "../hooks/useRoadmapRealtime";
import { primaryActionFor } from "../utils/primaryAction";

// jsdom has no PointerEvent; without it pointerType is dropped and hover-vs-touch can't be told.
class PointerEventStub extends MouseEvent {
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerType = init.pointerType ?? "";
  }
}
beforeAll(() => {
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventStub;
});
afterAll(() => {
  delete (window as unknown as { PointerEvent?: unknown }).PointerEvent;
});

const row = (overrides: Partial<RoadmapItemRow> = {}): RoadmapItemRow => ({
  id: "opp-uuid-388",
  code: "OPP-388",
  title: "Streak on start screen",
  shownStage: "planning",
  statusParts: {
    stage: "planning",
    step: "design",
    leadUserId: 2,
    prdPercent: 100,
    openQuestions: 0,
    designAwaitingApproval: true,
  },
  author: { id: 1, name: "Ravi", role: "idea" },
  lead: { id: 2, name: "Priya", role: "builder" },
  votes: 23,
  votedByMe: false,
  starred: false,
  unread: true,
  whyHere: { kind: "agentQuestion", phase: "plan", questionPreview: "which learners first?" },
  updatedAt: "2026-11-10T00:00:00Z",
  stageSince: "2026-11-06T00:00:00Z",
  ...overrides,
});

const detail = (
  can: RoadmapCan,
  overrides: Partial<RoadmapItemDetail> = {},
): RoadmapItemDetail => ({
  ...row(),
  summary: {},
  runs: [],
  prs: [],
  releases: [],
  people: [],
  can,
  watchLevel: "milestones",
  ...overrides,
});

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("controls follow can{} — absent, never greyed out (§4.0 #14)", () => {
  it("an Idea person sees no star button, no title editor and no build-side action", () => {
    const item = detail({ vote: true, watch: true, answer: true });
    wrap(
      <>
        <IdeaStar item={item} />
        <IdeaTitle item={item} as="h2" />
        <PrimaryAction item={item} onApproveDesign={vi.fn()} />
      </>,
    );
    expect(screen.queryByRole("button", { name: en.roadmapV2.actions.star })).toBeNull();
    expect(screen.queryByRole("textbox", { name: en.roadmapV2.actions.editTitle })).toBeNull();
    expect(screen.getByRole("heading", { name: "Streak on start screen" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en.roadmapV2.actions.approveDesign })).toBeNull();
    // The quiet line stands where the action would be.
    expect(screen.getByText(/Priya leads this idea/)).toBeInTheDocument();
  });

  it("an Owner gets the star, the title editor and Approve design", () => {
    const onApprove = vi.fn();
    const item = detail({ star: true, editTitle: true, approveDesign: true, watch: true });
    wrap(
      <>
        <IdeaStar item={item} />
        <IdeaTitle item={item} as="h2" />
        <PrimaryAction item={item} onApproveDesign={onApprove} />
      </>,
    );
    expect(screen.getByRole("button", { name: en.roadmapV2.actions.star })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: en.roadmapV2.actions.editTitle })).toHaveValue(
      "Streak on start screen",
    );
    fireEvent.click(screen.getByRole("button", { name: en.roadmapV2.actions.approveDesign }));
    expect(onApprove).toHaveBeenCalled();
  });

  it("a Viewer gets no watch control", () => {
    const { container } = wrap(<IdeaWatch item={detail({ watch: false, answer: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("gives the idea page the real VoteButton, keyed by the opportunity id", () => {
    mockOpportunity.mockClear();
    wrap(<IdeaVotes item={detail({ vote: true })} />);
    expect(screen.getByRole("button", { name: "vote-button" })).toBeInTheDocument();
    expect(mockOpportunity).toHaveBeenCalledWith("opp-uuid-388", { skip: false });
  });

  it("shows the count without a control to someone who can't vote", () => {
    wrap(<IdeaVotes item={detail({ vote: false })} />);
    expect(screen.queryByRole("button", { name: "vote-button" })).toBeNull();
    expect(screen.getByText(en.roadmapV2.row.votes(23))).toBeInTheDocument();
  });

  it("stars optimistically and rolls back on failure", async () => {
    mockStar.mockReturnValueOnce({ unwrap: () => Promise.reject(new Error("no")) });
    wrap(<IdeaStar item={detail({ star: true })} />);
    const button = screen.getByRole("button", { name: en.roadmapV2.actions.star });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(mockStar).toHaveBeenCalledWith({ code: "OPP-388", starred: true });
    expect(screen.getByRole("button", { name: en.roadmapV2.actions.star })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("primaryActionFor", () => {
  it("picks one action by stage and can{}", () => {
    expect(primaryActionFor(detail({ review: true }, { shownStage: "submitted" }))).toBe("accept");
    expect(
      primaryActionFor(detail({ pickLead: true }, { shownStage: "accepted", lead: undefined })),
    ).toBe("pickLead");
    expect(primaryActionFor(detail({ approveDesign: true }))).toBe("approveDesign");
    expect(primaryActionFor(detail({}))).toBeNull();
  });

  it("renders nothing for the actions later phases build", () => {
    const { container } = wrap(
      <PrimaryAction
        item={detail(
          { merge: true },
          {
            shownStage: "building",
            statusParts: {
              stage: "building",
              where: "here",
              leadUserId: 2,
              externalBuild: null,
              repos: [],
              openPrs: [],
              mergedPrs: 0,
              waitingForPr: false,
              releasing: false,
              heldReason: null,
            },
          },
        )}
        onApproveDesign={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("QueueRow", () => {
  const actions = {
    onOpen: vi.fn(),
    onMarkRead: vi.fn(),
    onWatch: vi.fn(),
    onCopyLink: vi.fn(),
  };
  beforeEach(() => Object.values(actions).forEach(fn => fn.mockReset()));

  const renderRow = (props: Partial<React.ComponentProps<typeof QueueRow>> = {}) =>
    render(
      <ul>
        <QueueRow row={row()} selected={false} touch={false} index={0} {...actions} {...props} />
      </ul>,
    );

  it("names the open button with the code, title and unread state", () => {
    renderRow();
    fireEvent.click(
      screen.getByRole("button", {
        name: en.roadmapV2.row.openUnread("OPP-388", "Streak on start screen"),
      }),
    );
    expect(actions.onOpen).toHaveBeenCalledWith("OPP-388");
    expect(screen.getByText("Plan agent asks: which learners first?")).toBeInTheDocument();
  });

  it("shows the queue rank when the idea is ranked, and nothing when it is not", () => {
    const { unmount } = renderRow({ row: row({ queueRank: 3 }) });
    expect(screen.getByTestId("queue-rank")).toHaveTextContent("#3");
    unmount();
    renderRow({ row: row({ queueRank: null }) });
    expect(screen.queryByTestId("queue-rank")).toBeNull();
  });

  it("loads a row's vote record only when the reader reaches for it, then shows VoteButton", () => {
    mockOpportunity.mockClear();
    renderRow();
    expect(screen.queryByRole("button", { name: "vote-button" })).toBeNull();
    expect(mockOpportunity).toHaveBeenLastCalledWith("opp-uuid-388", { skip: true });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${en.roadmapV2.row.vote}:`) }));
    expect(screen.getByRole("button", { name: "vote-button" })).toBeInTheDocument();
  });

  it("prefetches after a 150 ms mouse hover, but not for a touch", () => {
    vi.useFakeTimers();
    const onPrefetch = vi.fn();
    renderRow({ onPrefetch });
    const button = screen.getByRole("button", { name: /Open OPP-388/ });
    fireEvent.pointerEnter(button, { pointerType: "touch" });
    vi.advanceTimersByTime(200);
    expect(onPrefetch).not.toHaveBeenCalled();
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    vi.advanceTimersByTime(200);
    expect(onPrefetch).toHaveBeenCalledWith("OPP-388");
    vi.useRealTimers();
  });

  it("on touch, the swipe actions also exist as visible buttons in the row's ⋯ menu", () => {
    renderRow({ touch: true });
    // Revealed by swipes (hidden from AT until revealed) …
    expect(screen.getAllByText(en.roadmapV2.row.markRead).length).toBeGreaterThan(0);
    // … and the ⋯ menu is always there.
    expect(
      screen.getByRole("button", { name: en.roadmapV2.row.actions("OPP-388") }),
    ).toBeInTheDocument();
  });
});

describe("reduced motion lands on the same final state", () => {
  afterEach(() => {
    setReduceMotionSwitch(false);
    __resetReduceMotionForTests();
  });

  const snapshot = () => {
    const { container, unmount } = render(
      <>
        <Tracker stage="planning" />
        <ul>
          <QueueRow
            row={row()}
            selected
            touch={false}
            index={3}
            onOpen={vi.fn()}
            onMarkRead={vi.fn()}
            onWatch={vi.fn()}
            onCopyLink={vi.fn()}
          />
        </ul>
      </>,
    );
    const text = container.textContent;
    const pressed = container.querySelector("[aria-current='true']") !== null;
    unmount();
    return { text, pressed };
  };

  it("for the tracker and a selected, unread row", () => {
    const moving = snapshot();
    setReduceMotionSwitch(true);
    const still = snapshot();
    expect(still).toEqual(moving);
    expect(still.text).toContain("Planning");
  });
});

describe("QueueList", () => {
  const base = {
    isLoading: false,
    isFetching: false,
    isError: false,
    onRetry: vi.fn(),
    filtered: false,
    onClearFilters: vi.fn(),
    onSeeAll: vi.fn(),
    touch: false,
    held: false,
    onRelease: vi.fn(),
    onOpen: vi.fn(),
    onMarkRead: vi.fn(),
    onWatch: vi.fn(),
    onCopyLink: vi.fn(),
  };

  it("keeps Needs you visible and empty when nothing needs you", () => {
    render(
      <QueueList
        {...base}
        view="for-you"
        data={{ sections: { needsYou: [], yourIdeas: [row()], watching: [], recentlyShipped: [] } }}
      />,
    );
    expect(screen.getByText(en.roadmapV2.empty.needsYou)).toBeInTheDocument();
    expect(screen.getByText("Your ideas · 1")).toBeInTheDocument();
    expect(screen.queryByText(/Watching/)).toBeNull();
  });

  it("offers Clear filters when a filter matches nothing", () => {
    const onClearFilters = vi.fn();
    render(
      <QueueList
        {...base}
        filtered
        onClearFilters={onClearFilters}
        view="all"
        data={{ rows: [], total: 0 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: en.roadmapV2.filter.clear }));
    expect(onClearFilters).toHaveBeenCalled();
  });

  it("says All caught up on an empty To triage", () => {
    render(
      <QueueList
        {...base}
        view="to-triage"
        data={{ sections: { awaitingReview: [], needsLead: [], reassign: [] } }}
      />,
    );
    expect(screen.getByText(en.roadmapV2.empty.allCaughtUp)).toBeInTheDocument();
  });

  it("holds the order while held, and shows the refresh-order pill", () => {
    const a = row({ code: "OPP-1", title: "A" });
    const b = row({ code: "OPP-2", title: "B" });
    const { rerender, container } = render(
      <QueueList {...base} held view="all" data={{ rows: [a, b], total: 2 }} />,
    );
    rerender(<QueueList {...base} held view="all" data={{ rows: [b, a], total: 2 }} />);
    const codes = [...container.querySelectorAll("[data-code]")].map(el =>
      el.getAttribute("data-code"),
    );
    expect(codes).toEqual(["OPP-1", "OPP-2"]);
    expect(screen.getByRole("button", { name: en.roadmapV2.updatedPill })).toBeInTheDocument();
  });

  it("groups Leading by stage", () => {
    const sections = sectionsFor("leading", {
      rows: [row({ code: "OPP-1" }), row({ code: "OPP-2", shownStage: "building" })],
      total: 2,
    });
    expect(sections.map(s => s.key)).toEqual(["planning", "building"]);
  });
});

describe("filter dropdown mapping", () => {
  it("merges key by key: a missing section keeps its value, [] clears it", () => {
    const current = { stage: ["planning"], author: ["4"], starred: true };
    const next = fromDropdownState(current, { stage: [], flags: ["votedByMe"] });
    expect(next).toEqual({ author: ["4"], votedByMe: true });
  });

  it("round-trips, with month single-valued", () => {
    const state = toDropdownState({ month: "2026-12", openQuestion: true });
    expect(state.month).toEqual(["2026-12"]);
    expect(state.flags).toEqual(["openQuestion"]);
    expect(fromDropdownState({}, { month: ["2026-11", "2027-01"] }).month).toBe("2027-01");
  });
});

describe("presence", () => {
  it("replaces a person's earlier beat, drops stale ones and never lists yourself", () => {
    const now = 100_000;
    const start = applyPresence(
      [],
      { code: "OPP-1", userId: 3, name: "Ana", kind: "viewing" },
      now,
    );
    const again = applyPresence(
      start,
      { code: "OPP-1", userId: 3, name: "Ana", kind: "viewing" },
      now + 1000,
    );
    expect(again).toHaveLength(1);
    const later = applyPresence(
      again,
      { code: "OPP-1", userId: 4, name: "Ravi", kind: "typing" },
      now + 40_000,
    );
    expect(later.map(p => p.name)).toEqual(["Ravi"]);
    expect(
      applyPresence([], { code: "OPP-1", userId: 9, name: "Me", kind: "viewing" }, now, 9),
    ).toEqual([]);
  });
});

describe("sidebar entry", () => {
  const args = {
    permissions: ["view:admin:product-roadmap"],
    features: ["product_roadmap"],
    savedOrder: undefined,
  };
  it("appears only while roadmap_v2 is on", () => {
    const off = deriveNavigationItems(args).map(i => i.id);
    const on = deriveNavigationItems({ ...args, roadmapV2: true }).map(i => i.id);
    expect(off).not.toContain("roadmap-v2");
    expect(on).toContain("roadmap-v2");
    // The old entry is untouched either way.
    expect(off.includes("product-roadmap")).toBe(on.includes("product-roadmap"));
  });

  it("never appears without the board's own grant", () => {
    expect(
      deriveNavigationItems({ ...args, permissions: ["other"], roadmapV2: true }).map(i => i.id),
    ).not.toContain("roadmap-v2");
  });
});
