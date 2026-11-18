import "@constants";
import React from "react";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";
import { store } from "@store";
import type { RoadmapItemDetail, RoadmapItemRow, RoadmapItemsResponse } from "@types";

const mockReview = vi.fn();
const mockBatch = vi.fn();
const mockStart = vi.fn();
const unwrapOf = (fn: ReturnType<typeof vi.fn>) =>
  vi.fn((arg: unknown) => ({ unwrap: () => Promise.resolve(fn(arg)) }));

vi.mock("../../../api/roadmapV2Flow", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useReviewRoadmapItemMutation: () => [unwrapOf(mockReview)],
  useReviewRoadmapBatchMutation: () => [unwrapOf(mockBatch)],
  useUndoRoadmapReviewMutation: () => [unwrapOf(vi.fn())],
  useSetRoadmapLeadMutation: () => [unwrapOf(vi.fn())],
  useStartRoadmapPlanningMutation: () => [unwrapOf(mockStart), { isLoading: false }],
  useGetRoadmapItemSimilarQuery: () => ({
    data: {
      matches: [{ code: "OPP-212", title: "Nudge", shownStage: "accepted", votes: 32, reason: "" }],
    },
  }),
  useGetRoadmapLeadSuggestionsQuery: () => ({
    data: {
      suggestedUserId: 7,
      candidates: [
        {
          user: { id: 3, name: "Ana", role: "builder" },
          leading: 3,
          limit: 3,
          freeSlots: 0,
          appsTouched: [],
          matchingIdeas: 0,
          score: 10,
        },
        {
          user: { id: 7, name: "Priya", role: "builder" },
          leading: 1,
          limit: 3,
          freeSlots: 2,
          appsTouched: ["admin"],
          matchingIdeas: 4,
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

import { toast } from "sonner";

import { setReduceMotionSwitch, __resetReduceMotionForTests } from "../../../motion/roadmapMotion";
import { PrimaryAction } from "../components/IdeaControls";
import { DeclineDialog } from "../triage/DeclineDialog";
import { LeadPicker } from "../triage/LeadPicker";
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

function detail(code: string, overrides: Partial<RoadmapItemDetail> = {}): RoadmapItemDetail {
  return {
    ...row(code),
    summary: { who: "Learners mid-course", problem: "They forget to return" },
    runs: [],
    prs: [],
    releases: [],
    people: [],
    can: { review: true, pickLead: true },
    watchLevel: "none",
    ...overrides,
  };
}

const sections = (): RoadmapItemsResponse => ({
  sections: { backlog: [row("OPP-414"), row("OPP-416")] },
});

const wrap = (ui: React.ReactElement) =>
  render(
    <Provider store={store}>
      <MemoryRouter>{ui}</MemoryRouter>
    </Provider>,
  );

beforeEach(() => {
  [mockReview, mockBatch, mockStart].forEach(fn => fn.mockReset());
  mockReview.mockReturnValue({ item: detail("OPP-414"), undoToken: "u1" });
  mockBatch.mockReturnValue({ items: [], undoToken: "u2" });
});
afterEach(() => __resetReduceMotionForTests());

const renderTriage = (props: Partial<React.ComponentProps<typeof TriageView>> = {}) =>
  wrap(
    <TriageView
      data={sections()}
      isLoading={false}
      isError={false}
      onRetry={vi.fn()}
      breakpoint="desktop"
      selected="OPP-414"
      open="OPP-414"
      onOpen={vi.fn()}
      onVisibleCodes={vi.fn()}
      {...props}
    />,
  );

describe("To triage (§4.6)", () => {
  it("the pane is the whole idea in place: its details, Pick a lead and Decline, and no page to go to", async () => {
    renderTriage();
    // The idea has no conversation yet, so the pane opens on its details (the Summary).
    expect(await screen.findByText("Learners mid-course")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: en.roadmapV2.idea.conversation })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: en.roadmapV2.idea.details })).toBeInTheDocument();
    expect(screen.getByText("OPP-212")).toBeInTheDocument();
    const pane = screen.getAllByRole("button", { name: en.roadmapV2.review.pickLead });
    expect(pane.length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: en.roadmapV2.review.decline }).length,
    ).toBeGreaterThan(0);
    // There is no separate Accept, and nothing sends the Owner to a full page.
    expect(screen.queryByRole("button", { name: /^Accept/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Open the idea")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: en.roadmapV2.openFullPage }),
    ).not.toBeInTheDocument();
  });

  it("shows each idea's queue rank on its row", () => {
    renderTriage({
      data: { sections: { backlog: [row("OPP-414", { rank: 3 }), row("OPP-416", { rank: 4 })] } },
    });
    expect(screen.getByText("#3")).toBeInTheDocument();
    expect(screen.getByText("#4")).toBeInTheDocument();
  });

  it("A does nothing any more", () => {
    renderTriage();
    fireEvent.keyDown(window, { key: "a" });
    expect(mockReview).not.toHaveBeenCalled();
    expect(mockBatch).not.toHaveBeenCalled();
  });

  it("L opens the lead picker, and picking the lead accepts the idea with that lead", async () => {
    renderTriage();
    fireEvent.keyDown(window, { key: "l" });
    fireEvent.click(
      (await screen.findAllByRole("button", { name: en.roadmapV2.review.leadConfirm })).at(-1)!,
    );
    await waitFor(() =>
      expect(mockReview).toHaveBeenCalledWith({
        code: "OPP-414",
        decision: "accept",
        leadUserId: 7,
      }),
    );
    await waitFor(() =>
      expect(toast.custom).toHaveBeenCalledWith(expect.any(Function), { duration: 8_000 }),
    );
  });

  it("X selects rows, then L gives them all a lead in one batch", async () => {
    const view = renderTriage();
    fireEvent.keyDown(window, { key: "x" });
    view.rerender(
      <Provider store={store}>
        <MemoryRouter>
          <TriageView
            data={sections()}
            isLoading={false}
            isError={false}
            onRetry={vi.fn()}
            breakpoint="desktop"
            selected="OPP-416"
            open="OPP-414"
            onOpen={vi.fn()}
            onVisibleCodes={vi.fn()}
          />
        </MemoryRouter>
      </Provider>,
    );
    fireEvent.keyDown(window, { key: "x" });
    expect(
      await screen.findByRole("region", { name: en.roadmapV2.triage.selected(2) }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "l" });
    fireEvent.click(
      (await screen.findAllByRole("button", { name: en.roadmapV2.review.leadConfirm })).at(-1)!,
    );
    await waitFor(() =>
      expect(mockBatch).toHaveBeenCalledWith([
        { code: "OPP-414", decision: "accept", leadUserId: 7 },
        { code: "OPP-416", decision: "accept", leadUserId: 7 },
      ]),
    );
  });

  it("keys are off while typing in a box", () => {
    renderTriage();
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "l" });
    expect(mockReview).not.toHaveBeenCalled();
    input.remove();
  });

  it("an empty To triage is all caught up", () => {
    renderTriage({ data: { sections: { backlog: [] } } });
    expect(screen.getByText(en.roadmapV2.empty.allCaughtUp)).toBeInTheDocument();
  });

  it("phone and tablet get Review mode, not bulk select", () => {
    renderTriage({ breakpoint: "phone" });
    expect(
      screen.getByRole("button", { name: en.roadmapV2.triage.reviewMode }),
    ).toBeInTheDocument();
    expect(screen.queryByText(en.roadmapV2.triage.keysHint)).not.toBeInTheDocument();
  });
});

describe("the decline box", () => {
  it("pre-selects the overlap and sends one reason per idea", async () => {
    const onDecline = vi.fn().mockResolvedValue(true);
    wrap(
      <DeclineDialog
        open
        targets={[{ code: "OPP-414", title: "Course reminders" }]}
        onClose={vi.fn()}
        onDecline={onDecline}
        sheet
      />,
    );
    const box = await screen.findByLabelText(en.roadmapV2.review.declineReason);
    await waitFor(() => expect(box).toHaveValue(en.roadmapV2.review.templates.overlaps("OPP-212")));
    fireEvent.click(
      screen.getAllByRole("button", { name: en.roadmapV2.review.declineSend }).at(-1)!,
    );
    await waitFor(() =>
      expect(onDecline).toHaveBeenCalledWith({
        "OPP-414": en.roadmapV2.review.templates.overlaps("OPP-212"),
      }),
    );
  });
});

describe("the lead picker", () => {
  it("lists the suggested Builder first, pre-selected, with why", async () => {
    const onPick = vi.fn().mockResolvedValue(true);
    wrap(<LeadPicker open code="OPP-414" onClose={vi.fn()} onPick={onPick} sheet />);
    const radios = screen.getAllByRole("radio");
    expect(radios[0]).toBeChecked();
    expect(screen.getByText("2 of 3 slots free · built 4 admin ideas")).toBeInTheDocument();
    expect(screen.getByText(en.roadmapV2.review.leadFull)).toBeInTheDocument();
    fireEvent.click(
      screen.getAllByRole("button", { name: en.roadmapV2.review.leadConfirm }).at(-1)!,
    );
    await waitFor(() => expect(onPick).toHaveBeenCalledWith({ id: 7, name: "Priya" }));
  });
});

describe("the idea page's primary action (P3 / P3b)", () => {
  it("an Owner gets Pick a lead and Decline on a submitted idea, and no Accept", () => {
    wrap(<PrimaryAction item={detail("OPP-414")} onApproveDesign={vi.fn()} />);
    expect(screen.getByRole("button", { name: en.roadmapV2.review.pickLead })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.roadmapV2.review.decline })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Accept/ })).not.toBeInTheDocument();
  });

  it("Pick a lead on an accepted idea without one", () => {
    wrap(
      <PrimaryAction
        item={detail("OPP-402", {
          shownStage: "accepted",
          statusParts: { stage: "accepted", leadUserId: null, needsLead: true, votes: 1 },
        })}
        onApproveDesign={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: en.roadmapV2.review.pickLead })).toBeInTheDocument();
  });

  it("Start planning for the lead", async () => {
    mockStart.mockReturnValue(detail("OPP-402"));
    wrap(
      <PrimaryAction
        item={detail("OPP-402", {
          shownStage: "accepted",
          lead: { id: 7, name: "Priya", role: "builder" },
          can: { startPlanning: true },
        })}
        onApproveDesign={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: en.roadmapV2.session.startPlanning }));
    await waitFor(() => expect(mockStart).toHaveBeenCalledWith("OPP-402"));
  });

  it("the author of a declined idea gets New idea; others get nothing", () => {
    const declined = {
      shownStage: "declined" as const,
      statusParts: { stage: "declined" as const, byUserId: 9, at: null },
    };
    const author = wrap(
      <PrimaryAction
        item={detail("OPP-9", { ...declined, can: {}, declineReason: "Needs evidence" })}
        onApproveDesign={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: en.roadmapV2.newIdea.button })).toBeInTheDocument();
    author.unmount();
    wrap(
      <PrimaryAction item={detail("OPP-9", { ...declined, can: {} })} onApproveDesign={vi.fn()} />,
    );
    expect(
      screen.queryByRole("button", { name: en.roadmapV2.newIdea.button }),
    ).not.toBeInTheDocument();
  });

  it("reduced motion: triage rows render the same rows and actions", () => {
    const full = renderTriage();
    const count = full.container.querySelectorAll("[data-code]").length;
    full.unmount();
    setReduceMotionSwitch(true);
    const reduced = renderTriage();
    expect(reduced.container.querySelectorAll("[data-code]").length).toBe(count);
  });
});
