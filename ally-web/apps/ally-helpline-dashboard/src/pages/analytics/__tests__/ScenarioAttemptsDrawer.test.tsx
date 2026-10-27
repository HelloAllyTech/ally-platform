import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { LearnerUsageTable } from "../LearnerUsageTable";
import { ScenarioAttemptsDrawer } from "../ScenarioAttemptsDrawer";
import { LearnerScenarioAttempt } from "@types";

const mockAttemptsQuery = vi.fn();
const mockReset = vi.fn();
const mockReopenAssessment = vi.fn();
const mockPermissions = vi.fn();
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("sonner", () => ({ toast: mockToast }));

const USAGE_RESPONSE = vi.hoisted(() => ({
  range: "30d",
  count: 1,
  data: [
    {
      id: 7,
      name: "Asha Rao",
      email: "a@x.com",
      status: "active",
      level: 1,
      totalXp: 0,
      roleplaySessionsCompleted: 0,
      roleplaySessionsStarted: 0,
      totalPracticeMinutes: 0,
      roleplayPointsPerMinute: null,
      itemsTotal: 0,
      itemsCompleted: 0,
      itemsCompletedPct: null,
      quizzesAttempted: 0,
      quizzesPassed: 0,
      readWatchCompleted: 0,
      reflectionCompleted: 0,
      coursesCompleted: 0,
      courseCompletionRatePct: null,
      signupDate: "2026-06-08T00:00:00.000Z",
    },
  ],
}));

vi.mock("@api", () => ({
  useGetLearnerUsageTableQuery: () => ({
    data: USAGE_RESPONSE,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGetLearnerScenarioAttemptsQuery: (...args: unknown[]) => mockAttemptsQuery(...args),
  useResetBranchingAttemptsMutation: () => [mockReset, { isLoading: false }],
  useReopenRoleplayAssessmentMutation: () => [mockReopenAssessment, { isLoading: false }],
}));

vi.mock("@constants", () => ({ Permissions: { EDIT_USER: "edit:user" } }));
vi.mock("@utils", () => ({
  hasPermissions: (perms: string[], p: string) => perms.includes(p),
}));
vi.mock("@hooks", () => ({ useUser: () => ({ permissions: mockPermissions() }) }));

vi.mock("@assets", () => ({
  Download: () => <span />,
  NoResults: () => <span />,
}));

vi.mock("@components", () => ({
  Button: ({ children, variant: _v, ...rest }: any) => <button {...rest}>{children}</button>,
  ButtonVariant: { SECONDARY: "secondary" },
  Chip: ({ config }: any) => <span>{config.label}</span>,
  FallbackUI: ({ mainMessage }: any) => <div>{mainMessage}</div>,
  Drawer: ({ open, title, children }: any) =>
    open ? (
      <div>
        <div>{title}</div>
        {children}
      </div>
    ) : null,
}));

const attempt = (overrides: Partial<LearnerScenarioAttempt> = {}): LearnerScenarioAttempt => ({
  trackId: "t1",
  trackTitle: "Active Listening",
  trackItemId: "item-1",
  title: "Difficult caller",
  attemptsUsed: 3,
  maxAttempts: 3,
  exhausted: true,
  nextRoundAt: "2026-10-22T09:30:00.000Z",
  bestScore: 62,
  ...overrides,
});

const respondWith = (data: LearnerScenarioAttempt[], refetch = vi.fn()) =>
  mockAttemptsQuery.mockReturnValue({ data, isLoading: false, isError: false, refetch });

const renderDrawer = () =>
  render(<ScenarioAttemptsDrawer open onClose={vi.fn()} userId={7} learnerName="Asha Rao" />);

describe("ScenarioAttemptsDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPermissions.mockReturnValue(["edit:user"]);
  });

  it("lists paused and in-progress scenarios grouped under the course", () => {
    respondWith([
      attempt(),
      attempt({
        trackItemId: "item-2",
        title: "Angry parent",
        attemptsUsed: 1,
        exhausted: false,
        nextRoundAt: null,
        bestScore: null,
      }),
      attempt({
        trackId: "t2",
        trackTitle: "Boundaries",
        trackItemId: "item-3",
        maxAttempts: null,
      }),
    ]);
    renderDrawer();

    expect(screen.getAllByTestId("scenario-attempts-group")).toHaveLength(2);
    expect(screen.getByText("Active Listening")).toBeInTheDocument();
    expect(screen.getByText(/3 of 3 attempts used/)).toBeInTheDocument();
    expect(screen.getAllByText(/Best score 62/)).toHaveLength(2);
    expect(screen.getAllByText(/^Paused until /)).toHaveLength(2);
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 attempts used")).toBeInTheDocument();
    expect(screen.getByText(/^3 attempts/)).toBeInTheDocument();
  });

  it("asks for confirmation, then reopens and surfaces success", async () => {
    respondWith([attempt()]);
    mockReset.mockReturnValue({ unwrap: () => Promise.resolve({ success: true }) });
    renderDrawer();

    fireEvent.click(screen.getByRole("button", { name: "Reopen attempts" }));
    expect(mockReset).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Reopen attempts for Asha Rao? They can try Difficult caller again straight away.",
      ),
    ).toBeInTheDocument();

    const confirmBox = screen.getByTestId("scenario-attempts-confirm");
    fireEvent.click(confirmBox.querySelector("button") as HTMLButtonElement);

    await waitFor(() =>
      expect(mockReset).toHaveBeenCalledWith({ trackItemId: "item-1", userId: 7 }),
    );
    // The list refetches through the mutation's tag invalidation, not by hand.
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
  });

  it("shows the server message when reopening fails", async () => {
    respondWith([attempt()]);
    mockReset.mockReturnValue({
      unwrap: () => Promise.reject({ data: { message: "Learner is in another organisation" } }),
    });
    renderDrawer();

    fireEvent.click(screen.getByRole("button", { name: "Reopen attempts" }));
    fireEvent.click(
      screen.getByTestId("scenario-attempts-confirm").querySelector("button") as HTMLButtonElement,
    );

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith("Learner is in another organisation"),
    );
  });

  it("gives a submitted assessment roleplay another attempt through its own endpoint", async () => {
    respondWith([
      attempt({
        kind: "ROLEPLAY_ASSESSMENT",
        trackItemId: "rp-1",
        title: "Intake call",
        attemptsUsed: 1,
        maxAttempts: 1,
        nextRoundAt: null,
        bestScore: 35,
        passed: false,
        submittedAt: "2026-10-26T09:00:00.000Z",
      }),
    ]);
    mockReopenAssessment.mockReturnValue({ unwrap: () => Promise.resolve({ success: true }) });
    renderDrawer();

    expect(screen.getByText(/Not passed · Score 35/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Give another attempt" }));
    expect(
      screen.getByText(
        "Give Asha Rao another attempt at Intake call? Their earlier attempt and its report are kept.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId("scenario-attempts-confirm").querySelector("button") as HTMLButtonElement,
    );

    await waitFor(() =>
      expect(mockReopenAssessment).toHaveBeenCalledWith({ trackItemId: "rp-1", userId: 7 }),
    );
    expect(mockReset).not.toHaveBeenCalled();
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
  });

  it("shows the empty state", () => {
    respondWith([]);
    renderDrawer();
    expect(
      screen.getByText(
        "No scenario quizzes in progress or submitted assessments for this learner.",
      ),
    ).toBeInTheDocument();
  });
});

describe("LearnerUsageTable scenario attempts action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    respondWith([]);
  });

  it("opens the drawer for the learner when the user can edit users", () => {
    mockPermissions.mockReturnValue(["edit:user"]);
    render(<LearnerUsageTable range="30d" />);

    fireEvent.click(screen.getByTestId("scenario-attempts-action-7"));
    expect(mockAttemptsQuery).toHaveBeenCalledWith(7, { skip: false });
  });

  it("hides the action without edit:user", () => {
    mockPermissions.mockReturnValue([]);
    render(<LearnerUsageTable range="30d" />);

    expect(screen.queryByTestId("scenario-attempts-action-7")).not.toBeInTheDocument();
  });
});
