import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  RoadmapOpportunity,
  RoadmapOpportunityEffort,
  RoadmapOpportunitySource,
  RoadmapOpportunityStage,
  RoadmapOpportunityType,
} from "@types";

vi.mock("../useScoreUnit", () => ({ useScoreUnit: () => ({ enabled: false, unit: "votes" }) }));
vi.mock("@ally-ui-mono/ui-shared", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
}));
vi.mock("../DirectorStarButton", () => ({ DirectorStarButton: () => null }));
vi.mock("../VoteButton", () => ({ VoteButton: () => null }));

import { OpportunityListCard, RowEditor } from "../OpportunityListCard";
import { RejectReasonBar } from "../RejectReasonBar";

const row = (over: Partial<RoadmapOpportunity> = {}): RoadmapOpportunity =>
  ({
    id: "opp-1",
    code: "OPP-0001",
    description: "A thing",
    type: RoadmapOpportunityType.IDEA,
    stage: RoadmapOpportunityStage.NEW,
    productGoal: "Scribe",
    owner: null,
    ownerUserId: null,
    queueRank: 1,
    effort: null,
    priorityScore: 10,
    compositeScore: 50,
    voterCount: 2,
    source: RoadmapOpportunitySource.STAFF,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  }) as RoadmapOpportunity;

const editor = (over: Partial<RowEditor> = {}): RowEditor => ({
  goals: ["Scribe", "Learn"],
  owners: [{ id: 7, name: "Priya" }],
  showOwnerNudge: true,
  onSetEffort: vi.fn(),
  onSetGoal: vi.fn(),
  onSetOwner: vi.fn(),
  onAccept: vi.fn(),
  onReject: vi.fn(),
  ...over,
});

const renderCard = (ed?: RowEditor, opp = row()) =>
  render(
    <OpportunityListCard
      opportunity={opp}
      maxScore={100}
      isQueue
      canVote={false}
      onSetVotes={vi.fn()}
      onOpen={vi.fn()}
      editor={ed}
    />,
  );

describe("OpportunityListCard in-place editing", () => {
  it("changes the effort from the chip with a partial value, without opening the row", () => {
    const ed = editor();
    const onOpen = vi.fn();
    render(
      <OpportunityListCard
        opportunity={row({ effort: RoadmapOpportunityEffort.M })}
        maxScore={100}
        isQueue
        canVote={false}
        onSetVotes={vi.fn()}
        onOpen={onOpen}
        editor={ed}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Effort\. Click to change it/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "XL" }));
    expect(ed.onSetEffort).toHaveBeenCalledWith(expect.anything(), "xl");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("offers the dashed Size? and Owner? nudges when unsized and unowned in the Inbox", () => {
    const ed = editor();
    renderCard(ed);
    expect(screen.getByText("Size?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Nobody owns this yet/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Priya" }));
    expect(ed.onSetOwner).toHaveBeenCalledWith(expect.anything(), 7);
  });

  it("hides the owner nudge outside the Inbox and when owned", () => {
    renderCard(editor({ showOwnerNudge: false }));
    expect(screen.queryByText("Owner?")).toBeNull();
    renderCard(editor(), row({ owner: "Priya" }));
    expect(screen.queryAllByText("Owner?")).toHaveLength(0);
  });

  it("shows Accept for an Idea and calls the handler", () => {
    const ed = editor();
    renderCard(ed);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(ed.onAccept).toHaveBeenCalledTimes(1);
  });

  it("offers no Accept on a Prioritised row", () => {
    renderCard(editor(), row({ stage: RoadmapOpportunityStage.PRIORITISED }));
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("has no editing controls at all for a reader who cannot edit", () => {
    renderCard(undefined);
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Click to/ })).toBeNull();
    expect(screen.getByText("Size?")).toBeTruthy();
  });
});

describe("RejectReasonBar", () => {
  it("chooses a reason by click or digit, skips with Enter, cancels with Esc", () => {
    const onChoose = vi.fn();
    const onCancel = vi.fn();
    render(<RejectReasonBar code="OPP-0001" onChoose={onChoose} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /Out of scope/ }));
    expect(onChoose).toHaveBeenLastCalledWith("outOfScope");
    fireEvent.keyDown(document, { key: "4" });
    expect(onChoose).toHaveBeenLastCalledWith("needsInfo");
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onChoose).toHaveBeenLastCalledWith(undefined);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
