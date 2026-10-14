import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RoadmapOpportunity,
  RoadmapOpportunitySource,
  RoadmapOpportunityStage,
  RoadmapOpportunityType,
} from "@types";

const state = vi.hoisted(() => ({
  opportunity: undefined as unknown,
  setVotesTarget: undefined as unknown,
}));
const setVotes = vi.hoisted(() => vi.fn());

vi.mock("@icons", () => ({
  BuilderAgentIcon: () => <span>builder</span>,
  Close: () => <span>close</span>,
  Link: () => <span>link</span>,
  TooltipIcon: () => <span>?</span>,
  TrashCan: () => <span>delete</span>,
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  CarbonDropdown: () => null,
  SkeletonText: () => <div>loading</div>,
  TextArea: () => null,
  Tooltip: ({ children }: any) => <>{children}</>,
}));

vi.mock("@components", () => ({
  ActionConfirmationPopup: () => null,
  Button: () => null,
}));

vi.mock("@components/types", () => ({
  ButtonVariant: { SECONDARY: "secondary", DESTRUCTIVE: "destructive" },
}));

vi.mock("@constants", () => ({
  FeatureToggleKey: { BUG_HUNTER: "bug_hunter" },
  ROUTES: { BUG_HUNTER: "/bug-hunter", PRODUCT_ROADMAP: "/product-roadmap" },
}));

vi.mock("@hooks", () => ({ useUser: () => ({ features: [] }) }));

vi.mock("@utils", () => ({ hasFeature: () => false }));

const mutation = vi.hoisted(() => () => [vi.fn(), { isLoading: false }]);
vi.mock("@api", () => ({
  useGetRoadmapOpportunityQuery: () => ({
    data: state.opportunity,
    isLoading: false,
    isError: false,
  }),
  useGetRoadmapEligibleOwnersQuery: () => ({ data: [] }),
  useGetRoadmapCommentsQuery: () => ({ data: [] }),
  useGetRoadmapVotersQuery: () => ({ data: [] }),
  useGetBugFindingByReportedBugQuery: () => ({ data: undefined, isFetching: false }),
  useGetRoadmapGoalImpactQuery: () => ({ data: undefined, isLoading: false }),
  useUpdateRoadmapOpportunityMutation: mutation,
  useCreateRoadmapCommentMutation: mutation,
  useDeleteRoadmapOpportunityMutation: mutation,
  useOpenRoadmapBuilderSessionMutation: mutation,
  useReassessRoadmapGoalImpactMutation: mutation,
}));

vi.mock("../RankBreakdown", () => ({ RankBreakdownPanel: () => null }));
vi.mock("../ReferenceImagesField", () => ({ ReferenceImagesField: () => null }));

vi.mock("../useSetVotes", () => ({
  useSetVotes: (target: unknown) => {
    state.setVotesTarget = target;
    return setVotes;
  },
}));

vi.mock("../VoteButton", () => ({
  VoteButton: ({ opportunity, budget, onSetVotes }: any) => (
    <button
      type="button"
      data-testid="vote-button"
      data-available={budget.available}
      onClick={() => onSetVotes(opportunity.id, 1, 0)}
    >
      vote
    </button>
  ),
}));

import { OpportunityDrawer } from "../OpportunityDrawer";

// Only the fields the drawer reads; the rest of the row is irrelevant to voting.
const makeOpportunity = (over: Partial<RoadmapOpportunity> = {}): RoadmapOpportunity =>
  ({
    id: "opp-1",
    code: "OPP-0042",
    description: "Let counsellors pin a scenario",
    type: RoadmapOpportunityType.IDEA,
    stage: RoadmapOpportunityStage.NEW,
    productGoal: "Engagement & Usability",
    owner: null,
    prd: null,
    claudePrompt: null,
    releasedAt: null,
    priorityScore: 12,
    myVotes: 2,
    commentCount: 0,
    source: RoadmapOpportunitySource.STAFF,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    creator: null,
    monthPinned: false,
    ...over,
  }) as RoadmapOpportunity;

const renderDrawer = (props: Partial<React.ComponentProps<typeof OpportunityDrawer>> = {}) =>
  render(
    <OpportunityDrawer
      opportunityId="opp-1"
      goals={[]}
      budget={{ available: 7 }}
      canVote
      canManage={false}
      hasBuilderAccess={false}
      onOpenBuilderSession={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />,
  );

describe("OpportunityDrawer voting", () => {
  beforeEach(() => {
    state.opportunity = makeOpportunity();
    state.setVotesTarget = undefined;
    setVotes.mockReset();
  });

  it("offers the vote control on a new opportunity, with the caller's budget", () => {
    renderDrawer();
    expect(screen.getByTestId("vote-button")).toHaveAttribute("data-available", "7");
  });

  it("writes votes through the drawer's own cache entry, not the board's", () => {
    // A list or board target here would patch a cache entry the drawer does not read, and the
    // count would silently fail to move — see the args trap in useSetVotes.
    renderDrawer();
    expect(state.setVotesTarget).toEqual({ kind: "detail" });
    screen.getByTestId("vote-button").click();
    expect(setVotes).toHaveBeenCalledWith("opp-1", 1, 0);
  });

  it.each([
    RoadmapOpportunityStage.PRIORITISED,
    RoadmapOpportunityStage.UNDER_DEVELOPMENT,
    RoadmapOpportunityStage.RELEASED,
    RoadmapOpportunityStage.ARCHIVED,
  ])("hides it once the opportunity is %s, when votes are frozen", stage => {
    state.opportunity = makeOpportunity({ stage });
    renderDrawer();
    expect(screen.queryByTestId("vote-button")).not.toBeInTheDocument();
    // The totals line still reports the votes it has.
    expect(screen.getByText("12 total votes")).toBeInTheDocument();
  });

  it("hides it from a reader without vote permission", () => {
    renderDrawer({ canVote: false });
    expect(screen.queryByTestId("vote-button")).not.toBeInTheDocument();
  });

  it("hides it until the vote budget has loaded", () => {
    renderDrawer({ budget: undefined });
    expect(screen.queryByTestId("vote-button")).not.toBeInTheDocument();
  });

  it("never offers it on a bug report", () => {
    state.opportunity = makeOpportunity({ type: RoadmapOpportunityType.BUG });
    renderDrawer();
    expect(screen.queryByTestId("vote-button")).not.toBeInTheDocument();
  });
});
