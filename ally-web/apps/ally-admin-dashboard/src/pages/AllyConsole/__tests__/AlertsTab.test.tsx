import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  alerts: vi.fn(),
  counts: vi.fn(),
  check: vi.fn(),
  ack: vi.fn(),
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
  useGetAllyGuideAlertsQuery: (args: unknown) => h.alerts(args),
  useGetAllyGuideAlertCountsQuery: () => h.counts(),
  useCheckAllyGuideAlertsMutation: () => [h.check, { isLoading: false }],
  useAcknowledgeAllyGuideAlertMutation: () => [h.ack, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { AlertsTab } from "../AlertsTab";

const alert = (overrides: Record<string, unknown> = {}) => ({
  id: "al-1",
  rule: "turn_failures",
  severity: "critical",
  summary: "Ally turn failures at 25.0% over the last 30 minutes (10 of 40).",
  value: {},
  notifiedAt: "2026-10-24T08:01:00.000Z",
  delivery: "posted",
  acknowledgedAt: null,
  acknowledgedBy: null,
  acknowledgedByName: null,
  createdAt: "2026-10-24T08:00:00.000Z",
  ...overrides,
});

const loaded = (data: unknown) => ({
  currentData: data,
  isError: false,
  error: undefined,
  isFetching: false,
  refetch: vi.fn(),
});

describe("AlertsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.access.current = { canEdit: true };
    h.alerts.mockReturnValue(loaded([alert()]));
    h.counts.mockReturnValue({ data: { open: 1, total: 5 } });
    h.check.mockReturnValue({ unwrap: () => Promise.resolve([]) });
    h.ack.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  });

  it("asks for the open alerts first, from the server, so an old open one is never missed", () => {
    render(<AlertsTab />);

    expect(h.alerts).toHaveBeenCalledWith({ limit: 200, open: true });
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(h.alerts).toHaveBeenLastCalledWith({ limit: 200, open: false });
  });

  it("shows each alert's severity in words, the rule, what happened and its status", () => {
    render(<AlertsTab />);

    const row = screen.getByTestId("alert-row");
    expect(row).toHaveTextContent("Critical");
    expect(row).toHaveTextContent("Turn failures");
    expect(row).toHaveTextContent("turn failures at 25.0%");
    expect(row).toHaveTextContent("Open");
  });

  it("counts the open alerts in the filter from the counts endpoint", () => {
    render(<AlertsTab />);

    expect(screen.getByRole("button", { name: "Open (1)" })).toBeInTheDocument();
  });

  describe("delivery", () => {
    it.each([
      ["posted", /Posted/],
      ["no_channel", /No team channel/],
      ["failed", /Post failed/],
    ])("says %s in words", (delivery, expected) => {
      h.alerts.mockReturnValue(loaded([alert({ delivery })]));
      render(<AlertsTab />);

      expect(screen.getByTestId("alert-row")).toHaveTextContent(expected);
    });

    it("falls back to the post time on an alert raised before delivery was recorded", () => {
      h.alerts.mockReturnValue(loaded([alert({ delivery: null })]));
      render(<AlertsTab />);

      expect(screen.getByTestId("alert-row")).toHaveTextContent(/Posted/);
    });

    it("says not posted when an old alert has neither", () => {
      h.alerts.mockReturnValue(loaded([alert({ delivery: null, notifiedAt: null })]));
      render(<AlertsTab />);

      expect(screen.getByTestId("alert-row")).toHaveTextContent("Not posted");
    });
  });

  describe("acknowledging", () => {
    it("acknowledges an open alert and says so", async () => {
      render(<AlertsTab />);

      fireEvent.click(
        within(screen.getByTestId("alert-row")).getByRole("button", { name: "Acknowledge" }),
      );

      await waitFor(() => expect(h.ack).toHaveBeenCalledWith("al-1"));
      expect(h.toastSuccess).toHaveBeenCalledWith("Acknowledged.");
    });

    it("shows the server's message and keeps the alert open when it fails", async () => {
      h.ack.mockReturnValue({
        unwrap: () => Promise.reject({ status: 404, data: { message: "Alert not found" } }),
      });
      render(<AlertsTab />);

      fireEvent.click(
        within(screen.getByTestId("alert-row")).getByRole("button", { name: "Acknowledge" }),
      );

      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Alert not found"));
      expect(
        within(screen.getByTestId("alert-row")).getByRole("button", { name: "Acknowledge" }),
      ).toBeEnabled();
    });

    it("names who acknowledged an alert, by name, or 'you' for the signed-in admin", () => {
      h.alerts.mockReturnValue(
        loaded([
          alert({
            id: "a",
            acknowledgedAt: "2026-10-24T09:00:00.000Z",
            acknowledgedBy: 9,
            acknowledgedByName: "Priya Nair",
          }),
          alert({ id: "b", acknowledgedAt: "2026-10-24T09:00:00.000Z", acknowledgedBy: 5 }),
          alert({ id: "c", acknowledgedAt: "2026-10-24T09:00:00.000Z", acknowledgedBy: 12 }),
        ]),
      );
      render(<AlertsTab />);

      const [named, mine, bare] = screen.getAllByTestId("alert-row");
      expect(named).toHaveTextContent("Acknowledged by Priya Nair");
      expect(mine).toHaveTextContent("Acknowledged by you");
      expect(bare).toHaveTextContent("Acknowledged by user 12");
      expect(within(named).queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument();
    });
  });

  describe("check now", () => {
    it("runs the rules and says how many new alerts fired", async () => {
      h.check.mockReturnValue({ unwrap: () => Promise.resolve([alert(), alert({ id: "x" })]) });
      render(<AlertsTab />);

      fireEvent.click(screen.getByRole("button", { name: "Check now" }));

      await waitFor(() =>
        expect(h.toastSuccess).toHaveBeenCalledWith("Checked: 2 new alerts fired."),
      );
    });

    it("says nothing new fired, and reports a failure", async () => {
      render(<AlertsTab />);
      fireEvent.click(screen.getByRole("button", { name: "Check now" }));
      await waitFor(() =>
        expect(h.toastSuccess).toHaveBeenCalledWith("Checked: nothing new fired."),
      );

      h.check.mockReturnValue({ unwrap: () => Promise.reject({ status: 500 }) });
      fireEvent.click(screen.getByRole("button", { name: "Check now" }));
      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Could not run the rules."));
    });
  });

  describe("access", () => {
    it("hides acknowledge and check now from an admin who can only view", () => {
      h.access.current = { canEdit: false };
      render(<AlertsTab />);

      expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Check now" })).not.toBeInTheDocument();
      expect(screen.getByTestId("alert-row")).toBeInTheDocument();
    });
  });

  describe("states", () => {
    it("shows a skeleton while loading, with the filter still there", () => {
      h.alerts.mockReturnValue({ ...loaded(undefined), isFetching: true });
      render(<AlertsTab />);

      expect(screen.getByTestId("ally-loading")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    });

    it("tells a failure from an empty list, and a missing permission from both", () => {
      h.alerts.mockReturnValue({ ...loaded(undefined), isError: true, error: { status: 500 } });
      const { unmount } = render(<AlertsTab />);
      expect(screen.getByTestId("ally-load-failed")).toBeInTheDocument();
      unmount();

      h.alerts.mockReturnValue({ ...loaded(undefined), isError: true, error: { status: 403 } });
      render(<AlertsTab />);
      expect(screen.getByTestId("ally-forbidden")).toBeInTheDocument();
    });

    it("says no alerts have fired when none ever did", () => {
      h.alerts.mockReturnValue(loaded([]));
      h.counts.mockReturnValue({ data: { open: 0, total: 0 } });
      render(<AlertsTab />);

      expect(screen.getByText("No alerts have fired")).toBeInTheDocument();
    });

    it("says nothing needs attention when all are acknowledged, and points to All", () => {
      h.alerts.mockReturnValue(loaded([]));
      h.counts.mockReturnValue({ data: { open: 0, total: 3 } });
      render(<AlertsTab />);

      expect(screen.getByText("Nothing needs attention")).toBeInTheDocument();
      expect(screen.getByText(/3 earlier alerts have been acknowledged/)).toBeInTheDocument();
    });

    it("notes when the list is cut off at the limit", () => {
      h.alerts.mockReturnValue(
        loaded(Array.from({ length: 200 }, (_, index) => alert({ id: `al-${index}` }))),
      );
      render(<AlertsTab />);

      expect(screen.getByTestId("alerts-limit-note")).toHaveTextContent("newest 200");
    });
  });
});
