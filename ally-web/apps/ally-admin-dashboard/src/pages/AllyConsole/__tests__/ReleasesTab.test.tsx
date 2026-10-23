import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work, and a mock registered after
// another import that pulls it in arrives too late.
import "@constants";

const h = vi.hoisted(() => ({
  releases: vi.fn(),
  release: vi.fn(),
  rollback: vi.fn(),
  promote: vi.fn(),
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
// Partial: the admin store imports `baseAPI` from this barrel at module load, so replacing it
// wholesale takes the store down with it.
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideReleasesQuery: () => h.releases(),
  useGetAllyGuideReleaseQuery: () => h.release(),
  usePromoteAllyGuideReleaseMutation: () => [h.promote, { isLoading: false }],
  useRollbackAllyGuideReleaseMutation: () => [h.rollback, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { ReleasesTab } from "../ReleasesTab";

const release = (overrides: Record<string, unknown> = {}) => ({
  id: "rel-3",
  version: 3,
  status: "ga",
  contentHash: "abcdef0123456789abcdef",
  authorKind: "human",
  notes: "Shorter replies in Hindi",
  promotedAt: "2026-10-20T09:00:00.000Z",
  retiredAt: null,
  createdAt: "2026-10-19T09:00:00.000Z",
  ...overrides,
});

const LIST = [
  release(),
  release({
    id: "rel-2",
    version: 2,
    status: "retired",
    promotedAt: "2026-10-10T09:00:00.000Z",
    retiredAt: "2026-10-20T09:00:00.000Z",
    notes: null,
    authorKind: "seed",
  }),
  release({
    id: "rel-4",
    version: 4,
    status: "draft",
    promotedAt: null,
    notes: "Try a warmer opening",
  }),
];

const DETAIL = {
  ...release({ id: "rel-4", version: 4, status: "draft", promotedAt: null }),
  bundle: {
    prompts: {
      orchestrator: {
        code: "ally_guide_orchestrator",
        version: 2,
        text: "You are Ally.\nBe warm.",
      },
    },
    modelRouting: {
      orchestrator: { text: { premium: { provider: "anthropic", model: "claude-sonnet-5-5" } } },
    },
    capabilities: { consult_tutor: true, outreach: false },
    policy: { prose: { maxWords: { lead: 90 } }, firstWinMaxMinutes: 5 },
  },
};

const withList = (data: unknown[] | undefined, extra: Record<string, unknown> = {}) =>
  h.releases.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: undefined,
    refetch: vi.fn(),
    ...extra,
  });

describe("ReleasesTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.access.current = { canEdit: true };
    withList(LIST);
    h.release.mockReturnValue({ data: DETAIL, isLoading: false, isError: false, refetch: vi.fn() });
    h.rollback.mockReturnValue({ unwrap: () => Promise.resolve({ id: "rel-2", version: 2 }) });
    h.promote.mockReturnValue({ unwrap: () => Promise.resolve({ id: "rel-4", version: 4 }) });
  });

  describe("the list", () => {
    it("shows every release with its status in words, and says which one is live", () => {
      render(<ReleasesTab />);

      const rows = screen.getAllByTestId("release-row");
      expect(rows).toHaveLength(3);
      expect(within(rows[0]).getByText("Live (GA)")).toBeInTheDocument();
      expect(within(rows[1]).getByText("Retired")).toBeInTheDocument();
      expect(within(rows[2]).getByText("Draft")).toBeInTheDocument();
      expect(screen.getByTestId("releases-live-summary")).toHaveTextContent("Live: v3");
    });

    it("says so when a release has no notes or was never live", () => {
      render(<ReleasesTab />);

      const [, retired, draft] = screen.getAllByTestId("release-row");
      expect(within(retired).getByText("No notes")).toBeInTheDocument();
      expect(within(draft).getByText("Never live")).toBeInTheDocument();
    });

    it("shows a skeleton while loading, not an empty list", () => {
      withList(undefined, { isLoading: true });
      render(<ReleasesTab />);

      expect(screen.getByTestId("ally-loading")).toBeInTheDocument();
      expect(screen.queryByTestId("release-row")).not.toBeInTheDocument();
    });

    it("tells a failed load from an empty list, and offers a retry", async () => {
      const refetch = vi.fn();
      withList(undefined, { isError: true, error: { status: 500 }, refetch });
      render(<ReleasesTab />);

      expect(screen.getByTestId("ally-load-failed")).toBeInTheDocument();
      expect(screen.queryByTestId("ally-empty")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(refetch).toHaveBeenCalled();
    });

    it("tells a missing permission from a failure, with no retry that could not help", () => {
      withList(undefined, { isError: true, error: { status: 403 } });
      render(<ReleasesTab />);

      expect(screen.getByTestId("ally-forbidden")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    });

    it("says there are no releases yet", () => {
      withList([]);
      render(<ReleasesTab />);

      expect(screen.getByText("No releases yet")).toBeInTheDocument();
    });
  });

  describe("access", () => {
    it("hides rollback entirely from an admin who can only view", () => {
      h.access.current = { canEdit: false };
      render(<ReleasesTab />);

      expect(screen.queryByRole("button", { name: "Roll back…" })).not.toBeInTheDocument();
      expect(screen.getAllByTestId("release-row")).toHaveLength(3);
    });

    it("offers no promote button in the detail of a release to an admin who can only view", async () => {
      h.access.current = { canEdit: false };
      render(<ReleasesTab />);

      fireEvent.click(screen.getByRole("button", { name: "Open release v4" }));

      expect(await screen.findByTestId("release-detail")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Promote…" })).not.toBeInTheDocument();
    });

    it("disables rollback, and says why, when there is no earlier release to go back to", () => {
      withList([release()]);
      render(<ReleasesTab />);

      expect(screen.getByRole("button", { name: "Roll back…" })).toBeDisabled();
      expect(screen.getByText("Roll back…").closest("[data-tooltip]")).toHaveAttribute(
        "data-tooltip",
        "There is no earlier release to roll back to.",
      );
    });
  });

  describe("rollback", () => {
    const openDialog = async () => {
      fireEvent.click(screen.getByRole("button", { name: "Roll back…" }));
      return screen.getByRole("dialog");
    };

    it("opens a confirm dialog that says what it will do and does nothing until confirmed", async () => {
      render(<ReleasesTab />);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      const dialog = await openDialog();

      expect(within(dialog).getByText("Roll back the live release")).toBeInTheDocument();
      expect(
        within(dialog).getByText(/Goes back to the release that was live before v3/),
      ).toBeInTheDocument();
      expect(h.rollback).not.toHaveBeenCalled();
    });

    it("sends emergency: false by default, with the reason left empty", async () => {
      render(<ReleasesTab />);
      const dialog = await openDialog();

      fireEvent.click(within(dialog).getByRole("button", { name: "Roll back" }));

      await waitFor(() => expect(h.rollback).toHaveBeenCalledTimes(1));
      expect(h.rollback).toHaveBeenCalledWith({ emergency: false, reason: "" });
      expect(h.toastSuccess).toHaveBeenCalledWith("Rolled back. v2 is live.");
      // A successful rollback closes the dialog.
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("sends emergency: true with the reason once the emergency box is ticked", async () => {
      render(<ReleasesTab />);
      const dialog = await openDialog();

      fireEvent.change(within(dialog).getByLabelText("Reason (optional)"), {
        target: { value: "Hindi replies repeat themselves" },
      });
      fireEvent.click(
        within(dialog).getByLabelText("Emergency (moves every conversation at its next turn)"),
      );
      fireEvent.click(within(dialog).getByRole("button", { name: "Roll back now" }));

      await waitFor(() => expect(h.rollback).toHaveBeenCalledTimes(1));
      expect(h.rollback).toHaveBeenCalledWith({
        emergency: true,
        reason: "Hindi replies repeat themselves",
      });
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("spells out the cost of an emergency rollback the moment it is ticked, and not before", async () => {
      render(<ReleasesTab />);
      const dialog = await openDialog();
      expect(within(dialog).queryByTestId("rollback-emergency-warning")).not.toBeInTheDocument();

      fireEvent.click(
        within(dialog).getByLabelText("Emergency (moves every conversation at its next turn)"),
      );

      const warning = within(dialog).getByTestId("rollback-emergency-warning");
      expect(warning).toHaveTextContent("Every conversation switches on its next turn");
      expect(warning).toHaveTextContent("loses its prompt cache");
    });

    it("starts clean when reopened: an emergency box ticked last time is not still ticked", async () => {
      render(<ReleasesTab />);
      let dialog = await openDialog();
      fireEvent.click(
        within(dialog).getByLabelText("Emergency (moves every conversation at its next turn)"),
      );
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      dialog = await openDialog();

      expect(
        within(dialog).getByLabelText("Emergency (moves every conversation at its next turn)"),
      ).not.toBeChecked();
    });

    it("keeps the dialog open and shows the server's own message when the rollback is refused", async () => {
      h.rollback.mockReturnValue({
        unwrap: () =>
          Promise.reject({
            status: 400,
            data: { message: "There is no earlier GA release to roll back to." },
          }),
      });
      render(<ReleasesTab />);
      const dialog = await openDialog();

      fireEvent.click(within(dialog).getByRole("button", { name: "Roll back" }));

      await waitFor(() =>
        expect(h.toastError).toHaveBeenCalledWith(
          "There is no earlier GA release to roll back to.",
        ),
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("detail and promote", () => {
    it("shows prompts as read-only monospace text and the policy as a flat key/value table", async () => {
      render(<ReleasesTab />);

      fireEvent.click(screen.getByRole("button", { name: "Open release v4" }));

      const prompt = await screen.findByTestId("release-prompt");
      expect(prompt.tagName).toBe("PRE");
      expect(prompt.className).toContain("font-mono");
      expect(prompt).toHaveTextContent("You are Ally.");
      expect(prompt).not.toHaveAttribute("contenteditable");

      const policy = screen.getByTestId("release-policy-table");
      expect(within(policy).getByText("prose.maxWords.lead")).toBeInTheDocument();
      expect(within(policy).getByText("90")).toBeInTheDocument();
      expect(within(policy).getByText("firstWinMaxMinutes")).toBeInTheDocument();
    });

    it("promotes through a confirm dialog that names the release being retired", async () => {
      render(<ReleasesTab />);
      fireEvent.click(screen.getByRole("button", { name: "Open release v4" }));
      fireEvent.click(await screen.findByRole("button", { name: "Promote…" }));

      const dialog = screen.getByRole("dialog", { name: "Promote v4 to live?" });
      expect(
        within(dialog).getByText(/v4 becomes the live release and v3 is retired/),
      ).toBeInTheDocument();
      expect(h.promote).not.toHaveBeenCalled();

      fireEvent.click(within(dialog).getByRole("button", { name: "Promote v4" }));

      await waitFor(() => expect(h.promote).toHaveBeenCalledWith("rel-4"));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("offers no promote on the release that is already live", async () => {
      h.release.mockReturnValue({
        data: { ...DETAIL, id: "rel-3", version: 3, status: "ga" },
        isLoading: false,
        isError: false,
      });
      render(<ReleasesTab />);

      fireEvent.click(screen.getByRole("button", { name: "Open release v3" }));

      expect(await screen.findByText("This release is already live.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Promote…" })).not.toBeInTheDocument();
    });
  });
});
