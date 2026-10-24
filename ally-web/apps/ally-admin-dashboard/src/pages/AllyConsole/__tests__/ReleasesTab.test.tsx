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
  target: vi.fn(),
  audit: vi.fn(),
  startCanary: vi.fn(),
  stopCanary: vi.fn(),
  startEval: vi.fn(),
  evalCases: vi.fn(),
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
// Partial: the admin store imports `baseAPI` from this barrel at module load, so replacing it
// wholesale takes the store down with it.
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideReleasesQuery: () => h.releases(),
  useGetAllyGuideReleaseQuery: () => h.release(),
  usePromoteAllyGuideReleaseMutation: () => [h.promote, { isLoading: false }],
  useRollbackAllyGuideReleaseMutation: () => [h.rollback, { isLoading: false }],
  useGetAllyGuideRollbackTargetQuery: () => h.target(),
  useGetAllyGuideReleaseAuditQuery: () => h.audit(),
  useStartAllyGuideCanaryMutation: () => [h.startCanary, { isLoading: false }],
  useStopAllyGuideCanaryMutation: () => [h.stopCanary, { isLoading: false }],
  useStartAllyGuideEvalRunMutation: () => [h.startEval, { isLoading: false }],
  useGetAllyGuideEvalCasesQuery: () => h.evalCases(),
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
    h.target.mockReturnValue({
      data: { releaseId: "rel-2", version: 2 },
      isLoading: false,
      isError: false,
    });
    h.audit.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
    h.startCanary.mockReturnValue({ unwrap: () => Promise.resolve({ id: "rel-4", version: 4 }) });
    h.stopCanary.mockReturnValue({ unwrap: () => Promise.resolve({ id: "rel-4", version: 4 }) });
    h.startEval.mockReturnValue({ unwrap: () => Promise.resolve({ id: "run-1" }) });
    h.evalCases.mockReturnValue({ data: [], isLoading: false });
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
      h.target.mockReturnValue({ data: null, isLoading: false, isError: false });
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
        within(dialog).getByText(/Goes back to v2, the release that was live before v3/),
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
      expect(within(dialog).queryByTestId("emergency-warning")).not.toBeInTheDocument();

      fireEvent.click(
        within(dialog).getByLabelText("Emergency (moves every conversation at its next turn)"),
      );

      const warning = within(dialog).getByTestId("emergency-warning");
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

  describe("the rollback target", () => {
    it("says it is checking while the target loads, rather than claiming nothing to go back to", () => {
      h.target.mockReturnValue({ data: undefined, isLoading: true, isError: false });
      render(<ReleasesTab />);

      expect(screen.getByRole("button", { name: "Roll back…" })).toBeDisabled();
      expect(screen.getByText("Roll back…").closest("[data-tooltip]")).toHaveAttribute(
        "data-tooltip",
        "Checking where a rollback would land…",
      );
    });

    it("keeps rollback usable, with general wording, if the target could not be read", () => {
      h.target.mockReturnValue({ data: undefined, isLoading: false, isError: true });
      render(<ReleasesTab />);

      fireEvent.click(screen.getByRole("button", { name: "Roll back…" }));

      expect(
        within(screen.getByRole("dialog")).getByText(
          /Goes back to the release that was live before v3/,
        ),
      ).toBeInTheDocument();
    });
  });

  describe("canary", () => {
    const WITH_CANARY = [
      release(),
      release({
        id: "rel-4",
        version: 4,
        status: "canary",
        rolloutPercent: 20,
        promotedAt: null,
        notes: "Try a warmer opening",
      }),
    ];

    it("shows a banner naming the canary and its share, and the pill carries the share", () => {
      withList(WITH_CANARY);
      render(<ReleasesTab onOpenOverview={vi.fn()} />);

      expect(screen.getByTestId("releases-canary-banner")).toHaveTextContent(
        "v4 is in canary at 20% of new conversations",
      );
      expect(
        within(screen.getAllByTestId("release-row")[1]).getByText("Canary · 20%"),
      ).toBeInTheDocument();
    });

    it("shows no banner when nothing is in canary", () => {
      render(<ReleasesTab onOpenOverview={vi.fn()} />);

      expect(screen.queryByTestId("releases-canary-banner")).not.toBeInTheDocument();
    });

    it("takes you to the Overview to compare, and hides promote and stop from a viewer", () => {
      withList(WITH_CANARY);
      h.access.current = { canEdit: false };
      const onOpenOverview = vi.fn();
      render(<ReleasesTab onOpenOverview={onOpenOverview} />);

      fireEvent.click(screen.getByRole("button", { name: "Compare on Overview" }));
      expect(onOpenOverview).toHaveBeenCalledTimes(1);
      const banner = screen.getByTestId("releases-canary-banner");
      expect(within(banner).queryByRole("button", { name: "Promote…" })).not.toBeInTheDocument();
      expect(
        within(banner).queryByRole("button", { name: "Stop canary…" }),
      ).not.toBeInTheDocument();
    });

    it("promotes the canary from the banner, saying that the canary ends", async () => {
      withList(WITH_CANARY);
      render(<ReleasesTab />);

      fireEvent.click(
        within(screen.getByTestId("releases-canary-banner")).getByRole("button", {
          name: "Promote…",
        }),
      );

      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText(/the canary ends/)).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("button", { name: "Promote v4" }));
      await waitFor(() => expect(h.promote).toHaveBeenCalledWith("rel-4"));
    });

    it("offers Start canary on a draft, and sends the share and reason", async () => {
      render(<ReleasesTab />);
      fireEvent.click(screen.getByRole("button", { name: "Open release v4" }));
      fireEvent.click(await screen.findByRole("button", { name: "Start canary…" }));

      const dialog = screen.getByRole("dialog", { name: "Start a canary of v4?" });
      expect(within(dialog).getByLabelText("Share of new conversations (%)")).toHaveValue("20");
      fireEvent.change(within(dialog).getByLabelText("Share of new conversations (%)"), {
        target: { value: "10" },
      });
      fireEvent.change(within(dialog).getByLabelText("Reason (optional)"), {
        target: { value: "warmer opening" },
      });
      fireEvent.click(within(dialog).getByRole("button", { name: "Start at 10%" }));

      await waitFor(() =>
        expect(h.startCanary).toHaveBeenCalledWith({
          id: "rel-4",
          percent: 10,
          reason: "warmer opening",
        }),
      );
      expect(h.toastSuccess).toHaveBeenCalledWith("v4 is in canary at 10%.");
    });

    it("refuses a share above the cap and does not send it", async () => {
      render(<ReleasesTab />);
      fireEvent.click(screen.getByRole("button", { name: "Open release v4" }));
      fireEvent.click(await screen.findByRole("button", { name: "Start canary…" }));
      const dialog = screen.getByRole("dialog");

      fireEvent.change(within(dialog).getByLabelText("Share of new conversations (%)"), {
        target: { value: "45" },
      });

      expect(within(dialog).getByRole("alert")).toHaveTextContent("whole number from 1 to 30");
      expect(within(dialog).getByRole("button", { name: "Start canary" })).toBeDisabled();
      expect(h.startCanary).not.toHaveBeenCalled();
    });

    it("offers no canary on the live release or a retired one", async () => {
      h.release.mockReturnValue({
        data: { ...DETAIL, id: "rel-2", version: 2, status: "retired" },
        isLoading: false,
        isError: false,
      });
      render(<ReleasesTab />);

      fireEvent.click(screen.getByRole("button", { name: "Open release v2" }));

      expect(await screen.findByTestId("release-detail")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Start canary…" })).not.toBeInTheDocument();
    });

    it("lets a running canary have its share changed and be stopped from its page", async () => {
      withList(WITH_CANARY);
      h.release.mockReturnValue({
        data: { ...DETAIL, status: "canary", rolloutPercent: 20 },
        isLoading: false,
        isError: false,
      });
      render(<ReleasesTab />);
      fireEvent.click(screen.getByRole("button", { name: "Open release v4" }));

      expect(await screen.findByTestId("release-canary-note")).toHaveTextContent("20%");
      fireEvent.click(screen.getByRole("button", { name: "Change share…" }));
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByLabelText("Share of new conversations (%)")).toHaveValue("20");
      expect(within(dialog).getByRole("button", { name: "Change to 20%" })).toBeInTheDocument();
    });

    it("stops the canary gently by default and says what happens to it", async () => {
      withList(WITH_CANARY);
      render(<ReleasesTab />);
      fireEvent.click(
        within(screen.getByTestId("releases-canary-banner")).getByRole("button", {
          name: "Stop canary…",
        }),
      );
      const dialog = screen.getByRole("dialog", { name: "Stop the canary v4?" });
      expect(
        within(dialog).getByText(/stops taking new conversations and is retired/),
      ).toBeInTheDocument();

      fireEvent.click(within(dialog).getByRole("button", { name: "Stop canary" }));

      await waitFor(() =>
        expect(h.stopCanary).toHaveBeenCalledWith({ emergency: false, reason: "" }),
      );
      expect(h.toastSuccess).toHaveBeenCalledWith("The canary v4 has stopped.");
    });

    it("makes an emergency stop deliberate: the cost is shown and the button changes", async () => {
      withList(WITH_CANARY);
      render(<ReleasesTab />);
      fireEvent.click(
        within(screen.getByTestId("releases-canary-banner")).getByRole("button", {
          name: "Stop canary…",
        }),
      );
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).queryByTestId("emergency-warning")).not.toBeInTheDocument();

      fireEvent.click(
        within(dialog).getByLabelText(
          "Emergency (moves every conversation to the live release at its next turn)",
        ),
      );

      expect(within(dialog).getByTestId("emergency-warning")).toHaveTextContent(
        "loses its prompt cache",
      );
      fireEvent.click(within(dialog).getByRole("button", { name: "Stop canary now" }));
      await waitFor(() =>
        expect(h.stopCanary).toHaveBeenCalledWith({ emergency: true, reason: "" }),
      );
    });

    it("keeps the stop dialog open and shows the server's message when it is refused", async () => {
      withList(WITH_CANARY);
      h.stopCanary.mockReturnValue({
        unwrap: () =>
          Promise.reject({ status: 400, data: { message: "No release is in canary." } }),
      });
      render(<ReleasesTab />);
      fireEvent.click(
        within(screen.getByTestId("releases-canary-banner")).getByRole("button", {
          name: "Stop canary…",
        }),
      );

      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Stop canary" }),
      );

      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("No release is in canary."));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("history", () => {
    const row = (overrides: Record<string, unknown>) => ({
      id: "a1",
      action: "promoted",
      releaseId: "rel-3",
      version: 3,
      actorKind: "human",
      actorUserId: 9,
      actorName: "Priya Nair",
      reason: null,
      detail: { fromVersion: 2, toVersion: 3 },
      createdAt: "2026-10-20T09:00:00.000Z",
      ...overrides,
    });

    it("lists who did what, to which version, and why", () => {
      h.audit.mockReturnValue({
        data: [
          row({}),
          row({
            id: "a2",
            action: "canary_started",
            version: 4,
            actorUserId: 5,
            actorName: "Me",
            reason: "warmer opening",
            detail: { version: 4, percent: 20 },
          }),
        ],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      });
      render(<ReleasesTab />);

      const [promoted, started] = screen.getAllByTestId("release-audit-row");
      expect(promoted).toHaveTextContent("Promoted v3 to live, replacing v2");
      expect(promoted).toHaveTextContent("Priya Nair");
      expect(promoted).toHaveTextContent("None given");
      expect(started).toHaveTextContent("Started a canary of v4 at 20%");
      expect(started).toHaveTextContent("You");
      expect(started).toHaveTextContent("warmer opening");
    });

    it("sets an emergency apart in words", () => {
      h.audit.mockReturnValue({
        data: [row({ action: "emergency_rollback", detail: { fromVersion: 3, toVersion: 2 } })],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      });
      render(<ReleasesTab />);

      const [emergency] = screen.getAllByTestId("release-audit-row");
      expect(emergency).toHaveTextContent("Emergency rollback to v2 from v3");
      expect(within(emergency).getByText("Emergency")).toBeInTheDocument();
    });

    it("says there is nothing yet, shows a skeleton while loading, and a failure beside the list", () => {
      render(<ReleasesTab />);
      expect(screen.getByTestId("release-audit-empty")).toBeInTheDocument();

      h.audit.mockReturnValue({ data: undefined, isLoading: true, isError: false });
      render(<ReleasesTab />);
      expect(screen.getAllByTestId("ally-loading").length).toBeGreaterThan(0);

      h.audit.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: { status: 500 },
        refetch: vi.fn(),
      });
      render(<ReleasesTab />);
      expect(screen.getAllByTestId("ally-load-failed").length).toBeGreaterThan(0);
      // The releases themselves are still there.
      expect(screen.getAllByTestId("release-row").length).toBeGreaterThan(0);
    });
  });

  describe("running evals on a release", () => {
    const openRunDialog = async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open release v4" }));
      fireEvent.click(await screen.findByRole("button", { name: "Run evals…" }));
      return screen.getByRole("dialog", { name: "Run evals on v4" });
    };

    it("explains that the models are called for real and that the run goes on in the background", async () => {
      render(<ReleasesTab />);

      const dialog = await openRunDialog();

      expect(dialog).toHaveTextContent("models are called for real");
      expect(dialog).toHaveTextContent("starts in the background");
      expect(h.startEval).not.toHaveBeenCalled();
    });

    it("starts a smoke run by default, with no target cases", async () => {
      render(<ReleasesTab />);
      const dialog = await openRunDialog();

      fireEvent.click(within(dialog).getByRole("button", { name: "Start Smoke run" }));

      await waitFor(() =>
        expect(h.startEval).toHaveBeenCalledWith({
          releaseId: "rel-4",
          kind: "smoke",
          targetCaseIds: undefined,
        }),
      );
      expect(h.toastSuccess).toHaveBeenCalledWith("Started. Follow it on the Evals tab.");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("offers the active cases as targets for a gate, and sends the ones ticked", async () => {
      h.evalCases.mockReturnValue({
        data: [
          { id: "c-1", title: "Mentions the hotline too early" },
          { id: "c-2", title: "Quiz answer extraction" },
        ],
        isLoading: false,
      });
      render(<ReleasesTab />);
      const dialog = await openRunDialog();
      expect(within(dialog).queryByTestId("eval-run-targets")).not.toBeInTheDocument();

      fireEvent.click(within(dialog).getByLabelText(/Gate: every active case/));
      fireEvent.click(within(dialog).getByLabelText("Quiz answer extraction"));
      fireEvent.click(within(dialog).getByRole("button", { name: "Start Gate run" }));

      await waitFor(() => expect(h.startEval).toHaveBeenCalled());
      expect(h.startEval).toHaveBeenCalledWith({
        releaseId: "rel-4",
        kind: "gate",
        targetCaseIds: ["c-2"],
      });
    });

    it("says there are no active cases to pick when there are none", async () => {
      render(<ReleasesTab />);
      const dialog = await openRunDialog();

      fireEvent.click(within(dialog).getByLabelText(/Gate: every active case/));

      expect(within(dialog).getByText("There are no active cases to pick.")).toBeInTheDocument();
    });

    it("keeps the dialog open with the server's message when a run cannot start", async () => {
      h.startEval.mockReturnValue({
        unwrap: () =>
          Promise.reject({
            status: 409,
            data: { message: "An eval run is already running for this release" },
          }),
      });
      render(<ReleasesTab />);
      const dialog = await openRunDialog();

      fireEvent.click(within(dialog).getByRole("button", { name: "Start Smoke run" }));

      await waitFor(() =>
        expect(h.toastError).toHaveBeenCalledWith(
          "An eval run is already running for this release",
        ),
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("offers no run to an admin who can only view", async () => {
      h.access.current = { canEdit: false };
      render(<ReleasesTab />);

      fireEvent.click(screen.getByRole("button", { name: "Open release v4" }));

      expect(await screen.findByTestId("release-detail")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Run evals…" })).not.toBeInTheDocument();
    });
  });
});
