import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  advice: vi.fn(),
  moderate: vi.fn(),
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
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideAdviceQuery: (args: unknown) => h.advice(args),
  useModerateAllyGuideAdviceMutation: () => [h.moderate],
}));

// eslint-disable-next-line import/first
import { AdviceTab } from "../AdviceTab";

const line = (overrides: Record<string, unknown> = {}) => ({
  id: "adv-1",
  text: "Take the pauses seriously: the silence is where they decide.",
  status: "pending",
  flags: [],
  trackId: "track-1",
  trackTitle: "Active listening",
  tenantId: "t-1",
  organisationName: "Brightside Helpline",
  createdAt: "2026-10-22T09:00:00.000Z",
  moderatedAt: null,
  rejectReason: null,
  ...overrides,
});

const loaded = (data: unknown) => ({
  currentData: data,
  isError: false,
  error: undefined,
  refetch: vi.fn(),
});

describe("AdviceTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.access.current = { canEdit: true };
    h.advice.mockReturnValue(loaded([line()]));
    h.moderate.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  });

  it("asks for the waiting advice first, and the others when chosen", () => {
    render(<AdviceTab />);
    expect(h.advice).toHaveBeenCalledWith({ status: "pending", limit: 50 });

    fireEvent.click(screen.getByRole("button", { name: "Approved" }));
    expect(h.advice).toHaveBeenLastCalledWith({ status: "approved", limit: 50 });

    fireEvent.click(screen.getByRole("button", { name: "Rejected" }));
    expect(h.advice).toHaveBeenLastCalledWith({ status: "rejected", limit: 50 });
  });

  it("shows the line with its course and organisation, and never an author", () => {
    render(<AdviceTab />);

    const row = screen.getByTestId("advice-row");
    expect(within(row).getByTestId("advice-text")).toHaveTextContent("Take the pauses seriously");
    expect(row).toHaveTextContent("Active listening");
    expect(row).toHaveTextContent("Brightside Helpline");
    expect(screen.getByTestId("ally-advice-table")).not.toHaveTextContent(
      /author|written by|user \d/i,
    );
  });

  it("says anonymously, in the intro, that the author is never shown", () => {
    render(<AdviceTab />);

    expect(screen.getByTestId("ally-advice")).toHaveTextContent("The author is never shown");
  });

  it("names a deleted course and a missing organisation rather than leaving blanks", () => {
    h.advice.mockReturnValue(loaded([line({ trackTitle: null, organisationName: null })]));
    render(<AdviceTab />);

    const row = screen.getByTestId("advice-row");
    expect(row).toHaveTextContent("A deleted course");
    expect(row).toHaveTextContent("No organisation");
  });

  it("shows what the automatic checks flagged, in words", () => {
    h.advice.mockReturnValue(loaded([line({ flags: ["names_a_person", "contact_details"] })]));
    render(<AdviceTab />);

    const row = screen.getByTestId("advice-row");
    expect(row).toHaveTextContent("names a person");
    expect(row).toHaveTextContent("contact details");
  });

  describe("deciding", () => {
    it("approves with one click and says what happens next", async () => {
      render(<AdviceTab />);

      fireEvent.click(screen.getByRole("button", { name: "Approve" }));

      await waitFor(() =>
        expect(h.moderate).toHaveBeenCalledWith({
          id: "adv-1",
          decision: "approve",
          reason: undefined,
        }),
      );
      expect(h.toastSuccess).toHaveBeenCalledWith(
        "Approved. It shows anonymously once enough people have finished the course.",
      );
    });

    it("asks for an optional reason before rejecting, and sends it", async () => {
      render(<AdviceTab />);

      fireEvent.click(screen.getByRole("button", { name: "Reject…" }));
      const dialog = screen.getByRole("dialog", { name: "Reject this advice?" });
      expect(h.moderate).not.toHaveBeenCalled();
      fireEvent.change(within(dialog).getByLabelText("Reason (optional)"), {
        target: { value: "names a real person" },
      });
      fireEvent.click(within(dialog).getByRole("button", { name: "Reject advice" }));

      await waitFor(() =>
        expect(h.moderate).toHaveBeenCalledWith({
          id: "adv-1",
          decision: "reject",
          reason: "names a real person",
        }),
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("keeps the reject dialog open, with the server's message, when it fails", async () => {
      h.moderate.mockReturnValue({
        unwrap: () => Promise.reject({ status: 404, data: { message: "Advice not found" } }),
      });
      render(<AdviceTab />);

      fireEvent.click(screen.getByRole("button", { name: "Reject…" }));
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Reject advice" }),
      );

      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Advice not found"));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("lets an approved line be rejected and a rejected one approved, since a decision can change", () => {
      h.advice.mockReturnValue(
        loaded([
          line({ id: "a", status: "approved", moderatedAt: "2026-10-23T09:00:00.000Z" }),
          line({
            id: "b",
            status: "rejected",
            moderatedAt: "2026-10-23T09:00:00.000Z",
            rejectReason: "names a person",
          }),
        ]),
      );
      render(<AdviceTab />);

      const [approved, rejected] = screen.getAllByTestId("advice-row");
      expect(within(approved).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
      expect(within(approved).getByRole("button", { name: "Reject…" })).toBeInTheDocument();
      expect(within(rejected).getByRole("button", { name: "Approve" })).toBeInTheDocument();
      expect(within(rejected).queryByRole("button", { name: "Reject…" })).not.toBeInTheDocument();
      expect(rejected).toHaveTextContent("Reason: names a person");
      expect(approved).toHaveTextContent("Decided");
    });
  });

  describe("access", () => {
    it("shows the advice but offers no decision to an admin who can only view", () => {
      h.access.current = { canEdit: false };
      render(<AdviceTab />);

      expect(screen.getByTestId("advice-row")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reject…" })).not.toBeInTheDocument();
    });
  });

  describe("states", () => {
    it("shows a skeleton while loading, with the filter still there", () => {
      h.advice.mockReturnValue(loaded(undefined));
      render(<AdviceTab />);

      expect(screen.getByTestId("ally-loading")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Approved" })).toBeInTheDocument();
    });

    it("says nothing is waiting, and each other list is empty in its own words", () => {
      h.advice.mockReturnValue(loaded([]));
      render(<AdviceTab />);
      expect(screen.getByText("Nothing is waiting")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Approved" }));
      expect(screen.getByText("No approved advice yet")).toBeInTheDocument();
    });

    it("tells a failed load from an empty list, and a missing permission from both", () => {
      h.advice.mockReturnValue({
        currentData: undefined,
        isError: true,
        error: { status: 500 },
        refetch: vi.fn(),
      });
      const { unmount } = render(<AdviceTab />);
      expect(screen.getByTestId("ally-load-failed")).toBeInTheDocument();
      unmount();

      h.advice.mockReturnValue({
        currentData: undefined,
        isError: true,
        error: { status: 403 },
        refetch: vi.fn(),
      });
      render(<AdviceTab />);
      expect(screen.getByTestId("ally-forbidden")).toBeInTheDocument();
    });

    it("notes when the list is cut off at its limit", () => {
      h.advice.mockReturnValue(
        loaded(Array.from({ length: 50 }, (_, index) => line({ id: `adv-${index}` }))),
      );
      render(<AdviceTab />);

      expect(screen.getByTestId("advice-limit-note")).toHaveTextContent("Showing 50");
    });
  });
});
