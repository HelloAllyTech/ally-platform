import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { LearnerCoursesDrawer } from "../LearnerCoursesDrawer";
import { LearnerUsageTable } from "../LearnerUsageTable";
import { LearnerEnrollment } from "@types";

const mockEnrollmentsQuery = vi.fn();
const mockRemove = vi.fn();
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
  useGetLearnerScenarioAttemptsQuery: () => ({ data: [], isLoading: false, isError: false }),
  useResetBranchingAttemptsMutation: () => [vi.fn(), { isLoading: false }],
  useReopenRoleplayAssessmentMutation: () => [vi.fn(), { isLoading: false }],
  useGetLearnerEnrollmentsQuery: (...args: unknown[]) => mockEnrollmentsQuery(...args),
  useRemoveLearnerEnrollmentMutation: () => [mockRemove, { isLoading: false }],
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
  ButtonVariant: { SECONDARY: "secondary", DESTRUCTIVE: "destructive" },
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

const enrollment = (overrides: Partial<LearnerEnrollment> = {}): LearnerEnrollment => ({
  trackEnrollmentId: "enr-1",
  trackId: "t1",
  trackTitle: "Active Listening",
  totalItems: 8,
  completedItems: 3,
  enrolledAt: "2026-10-01T00:00:00.000Z",
  completedAt: null,
  lastActivityAt: "2026-10-20T00:00:00.000Z",
  accessDenial: null,
  ...overrides,
});

const respondWith = (data: LearnerEnrollment[], refetch = vi.fn()) =>
  mockEnrollmentsQuery.mockReturnValue({ data, isLoading: false, isError: false, refetch });

const renderDrawer = () =>
  render(<LearnerCoursesDrawer open onClose={vi.fn()} userId={7} learnerName="Asha Rao" />);

describe("LearnerCoursesDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPermissions.mockReturnValue(["edit:user"]);
  });

  it("lists each course with progress, and no flag while it is still open to them", () => {
    respondWith([
      enrollment(),
      enrollment({
        trackEnrollmentId: "enr-2",
        trackTitle: "Boundaries",
        completedAt: "2026-10-15T00:00:00.000Z",
        completedItems: 5,
        totalItems: 5,
      }),
    ]);
    renderDrawer();

    expect(screen.getAllByTestId("learner-courses-row")).toHaveLength(2);
    expect(screen.getByText(/3 of 8 items done/)).toBeInTheDocument();
    expect(screen.getByText(/^Completed /)).toBeInTheDocument();
    expect(screen.queryByTestId("learner-courses-denial")).not.toBeInTheDocument();
  });

  it("flags a course the learner keeps only because they are enrolled", () => {
    respondWith([enrollment({ accessDenial: "NOT_IN_GROUP" })]);
    renderDrawer();

    expect(screen.getByTestId("learner-courses-denial")).toHaveTextContent(
      "Not open to their group · They see this course only because they're enrolled in it.",
    );
  });

  it("falls back to a generic flag for a denial reason it does not know", () => {
    respondWith([enrollment({ accessDenial: "SOMETHING_NEW" as any })]);
    renderDrawer();

    expect(screen.getByTestId("learner-courses-denial")).toHaveTextContent("Not open to them");
  });

  it("confirms with wording that says the course will disappear, then removes it", async () => {
    respondWith([enrollment({ accessDenial: "NOT_IN_GROUP" })]);
    mockRemove.mockReturnValue({ unwrap: () => Promise.resolve({ success: true }) });
    renderDrawer();

    fireEvent.click(screen.getByRole("button", { name: "Remove from course" }));
    expect(mockRemove).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Remove Asha Rao from Active Listening? It will disappear from their course list and their progress in it will be cleared.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(mockRemove).toHaveBeenCalledWith({ userId: 7, trackEnrollmentId: "enr-1" }),
    );
    // The list refetches through the mutation's tag invalidation, not by hand.
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Removed from course"));
  });

  it("warns that a course still open to them can be started again", () => {
    respondWith([enrollment()]);
    renderDrawer();

    fireEvent.click(screen.getByRole("button", { name: "Remove from course" }));
    expect(
      screen.getByText(
        "Remove Asha Rao from Active Listening? Their progress will be cleared. The course is still open to them, so they can start it again from the beginning.",
      ),
    ).toBeInTheDocument();
  });

  it("backs out of the confirmation without removing", () => {
    respondWith([enrollment()]);
    renderDrawer();

    fireEvent.click(screen.getByRole("button", { name: "Remove from course" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByTestId("learner-courses-confirm")).not.toBeInTheDocument();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("shows the server message when removing fails", async () => {
    respondWith([enrollment()]);
    mockRemove.mockReturnValue({
      unwrap: () => Promise.reject({ data: { message: "Enrolment not found" } }),
    });
    renderDrawer();

    fireEvent.click(screen.getByRole("button", { name: "Remove from course" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Enrolment not found"));
  });

  it("shows the empty state", () => {
    respondWith([]);
    renderDrawer();
    expect(screen.getByText("This learner isn't enrolled in any courses.")).toBeInTheDocument();
  });
});

describe("LearnerUsageTable courses action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    respondWith([]);
  });

  it("opens the drawer for the learner when the user can edit users", () => {
    mockPermissions.mockReturnValue(["edit:user"]);
    render(<LearnerUsageTable range="30d" />);

    fireEvent.click(screen.getByTestId("learner-courses-action-7"));
    expect(mockEnrollmentsQuery).toHaveBeenCalledWith(7, { skip: false });
  });

  it("hides the action without edit:user", () => {
    mockPermissions.mockReturnValue([]);
    render(<LearnerUsageTable range="30d" />);

    expect(screen.queryByTestId("learner-courses-action-7")).not.toBeInTheDocument();
  });
});
