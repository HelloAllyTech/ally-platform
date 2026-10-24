import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  baselines: vi.fn(),
  capture: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  access: { current: { canEdit: true } as Record<string, boolean> },
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));
vi.mock("@hooks", () => ({ useAllyGuideAccess: () => h.access.current }));
vi.mock("react-redux", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSelector: (selector: (state: unknown) => unknown) => selector({ user: { user: { id: 5 } } }),
}));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideBaselinesQuery: () => h.baselines(),
  useCaptureAllyGuideBaselineMutation: () => [h.capture, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { BaselineTab } from "../BaselineTab";

const cohort = (overrides: Record<string, unknown> = {}) => ({
  enrollments: 400,
  completionRate: 0.4,
  medianDaysToComplete: 5,
  itemsCompletedPerEnrollment: 3,
  firstDayWinRate: 0.5,
  returnWithin7dRate: 0.3,
  quizFirstAttempts: 300,
  quizFirstAttemptPassRate: 0.7,
  ...overrides,
});

const snapshot = (
  id: string,
  cohorts: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  windowDays: 90,
  windowStart: "2026-07-01T00:00:00.000Z",
  windowEnd: "2026-09-29T00:00:00.000Z",
  capturedByUserId: 9,
  capturedByName: "Priya Nair",
  note: null,
  metrics: {
    cohorts,
    publicCourses: 12,
    definitions: {
      completionRate: "Share of those enrollments completed so far.",
      scope: "Enrollments started in the window on public courses.",
    },
  },
  createdAt: "2026-09-29T00:00:00.000Z",
  ...overrides,
});

const FIRST = snapshot(
  "snap-1",
  { all: cohort(), unknown: cohort() },
  { first: true, note: "Before launch" },
);
const LATEST = snapshot(
  "snap-2",
  {
    all: cohort({ enrollments: 460 }),
    guided: cohort({
      enrollments: 60,
      completionRate: 0.5,
      medianDaysToComplete: 3.5,
      firstDayWinRate: 0.6,
      returnWithin7dRate: 0.25,
      quizFirstAttempts: 50,
      quizFirstAttemptPassRate: 0.8,
    }),
    unknown: cohort(),
  },
  { createdAt: "2026-10-20T00:00:00.000Z", capturedByUserId: 5, capturedByName: "Me" },
);

const loaded = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  error: undefined,
  refetch: vi.fn(),
});

describe("BaselineTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.access.current = { canEdit: true };
    h.baselines.mockReturnValue(loaded([LATEST, FIRST]));
    h.capture.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  });

  describe("the comparison", () => {
    it("sets the first snapshot as the before beside the latest's cohorts, guided among them", () => {
      render(<BaselineTab />);

      const headers = within(screen.getByTestId("baseline-table"))
        .getAllByRole("columnheader")
        .map(header => header.textContent);
      expect(headers[0]).toBe("Measure");
      expect(headers[1]).toContain("Before Ally");
      expect(headers[1]).toContain("400 learners");
      expect(headers[2]).toContain("Guided by Ally");
      expect(headers[2]).toContain("60 learners");
      expect(headers).toContain("Guided compared with before");
    });

    it("shows each difference signed, in the measure's unit, with fewer days better", () => {
      render(<BaselineTab />);

      expect(screen.getByTestId("baseline-diff-completionRate")).toHaveTextContent("+10.0 pts");
      expect(screen.getByTestId("baseline-diff-medianDaysToComplete")).toHaveTextContent(
        "−1.5 days",
      );
      expect(screen.getByTestId("baseline-diff-medianDaysToComplete")).toHaveTextContent(
        "better than before",
      );
      expect(screen.getByTestId("baseline-diff-returnWithin7dRate")).toHaveTextContent("−5.0 pts");
      expect(screen.getByTestId("baseline-diff-returnWithin7dRate")).toHaveTextContent(
        "worse than before",
      );
    });

    it("keeps engagement and learning in groups of their own", () => {
      render(<BaselineTab />);

      const table = screen.getByTestId("baseline-table");
      expect(within(table).getByText("Engagement")).toBeInTheDocument();
      expect(within(table).getByText("Learning")).toBeInTheDocument();
      expect(screen.getByTestId("baseline-row-quizFirstAttemptPassRate")).toHaveTextContent(
        "50 first attempts",
      );
    });

    it("shows the server's own definition of a measure as its tooltip", () => {
      render(<BaselineTab />);

      expect(
        within(screen.getByTestId("baseline-row-completionRate")).getByText(
          (_content, element) =>
            element?.getAttribute("data-tooltip") ===
            "Share of those enrollments completed so far.",
        ),
      ).toBeInTheDocument();
    });

    it("warns about small groups next to a difference", () => {
      render(<BaselineTab />);

      expect(screen.getByText(/Small groups swing a lot/)).toBeInTheDocument();
    });

    it("uses the marked first snapshot as the before even when it sits beyond the page", () => {
      h.baselines.mockReturnValue(
        loaded([LATEST, snapshot("mid", { all: cohort({ enrollments: 1 }) }), FIRST]),
      );
      render(<BaselineTab />);

      const headers = within(screen.getByTestId("baseline-table")).getAllByRole("columnheader");
      expect(headers[1].textContent).toContain("400 learners");
    });

    it("says there are no guided learners yet, with nothing to set against the before", () => {
      const preGuided = snapshot(
        "snap-2",
        { all: cohort(), unknown: cohort() },
        {
          createdAt: "2026-10-20T00:00:00.000Z",
        },
      );
      h.baselines.mockReturnValue(loaded([preGuided, FIRST]));
      render(<BaselineTab />);

      expect(screen.getByTestId("baseline-no-guided")).toBeInTheDocument();
      expect(screen.queryByText("Guided compared with before")).not.toBeInTheDocument();
    });

    it("with only one snapshot, shows it alone and says to capture another", () => {
      h.baselines.mockReturnValue(loaded([FIRST]));
      render(<BaselineTab />);

      expect(screen.getByTestId("baseline-only-one")).toBeInTheDocument();
      const headers = within(screen.getByTestId("baseline-table")).getAllByRole("columnheader");
      expect(headers[1].textContent).toContain("All enrollments");
      expect(screen.queryByText("Guided compared with before")).not.toBeInTheDocument();
    });
  });

  describe("the learning guard", () => {
    it("warns when engagement is up while quiz passing is lower, with the sizes", () => {
      const worse = snapshot(
        "snap-2",
        {
          all: cohort(),
          guided: cohort({
            enrollments: 60,
            completionRate: 0.55,
            firstDayWinRate: 0.7,
            quizFirstAttempts: 50,
            quizFirstAttemptPassRate: 0.6,
          }),
        },
        { createdAt: "2026-10-20T00:00:00.000Z" },
      );
      h.baselines.mockReturnValue(loaded([worse, FIRST]));
      render(<BaselineTab />);

      const guard = screen.getByTestId("baseline-guard");
      expect(guard).toHaveTextContent("Engagement is up while quiz passing is lower");
      expect(guard).toHaveTextContent("60.0% against 70.0%");
      expect(guard).toHaveTextContent("60 guided learners against 400 before");
    });

    it("stays quiet when learning holds", () => {
      render(<BaselineTab />);

      expect(screen.queryByTestId("baseline-guard")).not.toBeInTheDocument();
    });
  });

  describe("history", () => {
    it("lists every snapshot with who took it, by name or 'you', and its note", () => {
      render(<BaselineTab />);

      const [latest, first] = screen.getAllByTestId("baseline-snapshot-row");
      expect(latest).toHaveTextContent("you");
      expect(latest).toHaveTextContent("No note");
      expect(first).toHaveTextContent("Priya Nair");
      expect(first).toHaveTextContent("Before launch");
      expect(first).toHaveTextContent("90 days");
    });

    it("summarises the latest snapshot in a sentence", () => {
      render(<BaselineTab />);

      expect(screen.getByTestId("baseline-latest-summary")).toHaveTextContent("taken");
      expect(screen.getByTestId("baseline-latest-summary")).toHaveTextContent(
        "covering 90 days of enrollments on 12 public courses",
      );
    });
  });

  describe("states", () => {
    it("shows a skeleton while loading", () => {
      h.baselines.mockReturnValue({ data: undefined, isLoading: true, isError: false });
      render(<BaselineTab />);

      expect(screen.getByTestId("ally-loading")).toBeInTheDocument();
    });

    it("tells a failure from none captured, and offers a retry", () => {
      const refetch = vi.fn();
      h.baselines.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: { status: 500 },
        refetch,
      });
      render(<BaselineTab />);

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(refetch).toHaveBeenCalled();
    });

    it("invites a first capture when there is none, to an admin who can edit", () => {
      h.baselines.mockReturnValue(loaded([]));
      render(<BaselineTab />);

      expect(screen.getByText("No baseline has been captured")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Capture a snapshot…" })).toBeInTheDocument();
    });

    it("offers no capture to an admin who can only view", () => {
      h.access.current = { canEdit: false };
      h.baselines.mockReturnValue(loaded([]));
      render(<BaselineTab />);

      expect(screen.getByText("No baseline has been captured")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Capture a snapshot…" })).not.toBeInTheDocument();
    });
  });

  describe("capturing a snapshot", () => {
    const openDialog = () => {
      fireEvent.click(screen.getByRole("button", { name: "Capture a snapshot…" }));
      return screen.getByRole("dialog", { name: "Capture a baseline snapshot" });
    };

    it("starts at 90 days, and sends the window with a trimmed note", async () => {
      render(<BaselineTab />);
      const dialog = openDialog();
      expect(within(dialog).getByLabelText("Days of enrollments to read")).toHaveValue("90");

      fireEvent.change(within(dialog).getByLabelText("Days of enrollments to read"), {
        target: { value: "30" },
      });
      fireEvent.change(within(dialog).getByLabelText("Note (optional)"), {
        target: { value: "  week before launch  " },
      });
      fireEvent.click(within(dialog).getByRole("button", { name: "Capture" }));

      await waitFor(() =>
        expect(h.capture).toHaveBeenCalledWith({ windowDays: 30, note: "  week before launch  " }),
      );
      expect(h.toastSuccess).toHaveBeenCalledWith("Snapshot captured.");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("refuses a window outside 7 to 365 days and does not send it", () => {
      render(<BaselineTab />);
      const dialog = openDialog();

      fireEvent.change(within(dialog).getByLabelText("Days of enrollments to read"), {
        target: { value: "5" },
      });

      expect(within(dialog).getByRole("alert")).toHaveTextContent("from 7 to 365");
      expect(within(dialog).getByRole("button", { name: "Capture" })).toBeDisabled();
      expect(h.capture).not.toHaveBeenCalled();
    });

    it("keeps the dialog open and shows the server's message when the capture fails", async () => {
      h.capture.mockReturnValue({
        unwrap: () =>
          Promise.reject({
            status: 400,
            data: { message: "windowDays must be between 7 and 365" },
          }),
      });
      render(<BaselineTab />);
      const dialog = openDialog();

      fireEvent.click(within(dialog).getByRole("button", { name: "Capture" }));

      await waitFor(() =>
        expect(h.toastError).toHaveBeenCalledWith("windowDays must be between 7 and 365"),
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("starts clean when reopened", () => {
      render(<BaselineTab />);
      let dialog = openDialog();
      fireEvent.change(within(dialog).getByLabelText("Days of enrollments to read"), {
        target: { value: "12" },
      });
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

      dialog = openDialog();

      expect(within(dialog).getByLabelText("Days of enrollments to read")).toHaveValue("90");
    });
  });
});
