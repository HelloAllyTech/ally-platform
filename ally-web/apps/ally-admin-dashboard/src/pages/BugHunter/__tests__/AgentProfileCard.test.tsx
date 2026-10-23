import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<any>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock("@api", () => ({
  useGetBugHunterSettingsQuery: vi.fn(),
  useUpdateBugHunterSettingsMutation: vi.fn(),
  useGetBugFindingsQuery: vi.fn(),
  useGetBugHuntRunsQuery: vi.fn(),
}));

// The scan's own behaviour is `useUxSignalScan`'s suite; here it is only a
// control the menu holds. Mocked at the module so the real hook's store and
// feature-toggle imports stay out of this file.
const uxScan = {
  canScan: true,
  isBusy: false,
  lastScanLine: "Last scan 10/12/2026: 2 bugs, 1 suggestions filed.",
  runScan: vi.fn(() => Promise.resolve()),
};
vi.mock("../useUxSignalScan", () => ({ useUxSignalScan: () => uxScan }));

// Likewise the feature map's confirm-and-refresh, which FeatureMapPanel's
// suite covers; the header only has to open it.
vi.mock("../FeatureMapPanel", () => ({
  FeatureMapRefreshDialog: ({ repo, onClose }: any) => (
    <div data-testid="map-features-dialog" data-repo={repo ?? "all"}>
      <button onClick={onClose}>close map dialog</button>
    </div>
  ),
}));

vi.mock("@icons", () => ({
  HelpIcon: () => <svg />,
  ThreeDot: () => <svg />,
}));

// See BugFindingsTable's note: @constants reads `cellTypes` off this barrel at
// module-eval time, so it is stubbed rather than loaded for real. The avatar is
// imported by its own path and stays real.
vi.mock("@components", () => ({ cellTypes: {} }));

vi.mock("@components/action-confirmation-popup", () => ({
  ActionConfirmationPopup: ({ isOpen, title, description, primaryButton, secondaryButton }: any) =>
    isOpen ? (
      <div data-testid="confirm-popup">
        <p>{title}</p>
        <p>{description}</p>
        <button onClick={primaryButton.onClick}>{primaryButton.label}</button>
        <button onClick={secondaryButton.onClick}>{secondaryButton.label}</button>
      </div>
    ) : null,
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Button: ({ children, onClick, disabled, iconDescription }: any) => (
    <button onClick={onClick} disabled={disabled} aria-label={iconDescription}>
      {children}
    </button>
  ),
  // Always open: Carbon's own open/close and focus handling is not what this
  // suite is about, only which items the menu offers and what they do.
  OverflowMenu: ({ children, iconDescription }: any) => (
    <div role="menu" aria-label={iconDescription}>
      {children}
    </div>
  ),
  OverflowMenuItem: ({ itemText, onClick, disabled }: any) => (
    <button role="menuitem" onClick={onClick} disabled={disabled}>
      {itemText}
    </button>
  ),
}));

import * as api from "@api";
import { ROUTES } from "@constants";
import { BugFinding, BugFindingStatus, BugHunterMode, BugHuntRunStatus } from "@types";

import { AgentProfileCard } from "../AgentProfileCard";

const updateSettings = vi.fn(() => ({ unwrap: () => Promise.resolve({}) }));
const onShowInProgress = vi.fn();
const onShowHelp = vi.fn();

const mockSettings = (mode = BugHunterMode.AI, overrides: Record<string, unknown> = {}) => {
  (api.useGetBugHunterSettingsQuery as any).mockReturnValue({
    data: { mode, updatedBy: null, updatedAt: "2026-08-01T00:00:00.000Z" },
    isLoading: false,
    isError: false,
    ...overrides,
  });
};

const mockFindings = (items: Partial<BugFinding>[] = []) => {
  (api.useGetBugFindingsQuery as any).mockReturnValue({
    data: { items, count: items.length },
    isLoading: false,
    isError: false,
  });
};

const mockRuns = (items: Record<string, unknown>[] = []) => {
  (api.useGetBugHuntRunsQuery as any).mockReturnValue({
    data: { items },
    isLoading: false,
    isError: false,
  });
};

const mount = (canTriage = true) =>
  render(
    <AgentProfileCard
      onShowInProgress={onShowInProgress}
      onShowHelp={onShowHelp}
      canTriage={canTriage}
    />,
  );

const statusLine = () => screen.getByTestId("bug-hunter-status-line");
const modeSelect = () => screen.getByTestId("bug-hunter-mode-select") as HTMLSelectElement;
const pickMode = (mode: BugHunterMode) =>
  fireEvent.change(modeSelect(), { target: { value: mode } });

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

describe("AgentProfileCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uxScan.canScan = true;
    uxScan.isBusy = false;
    mockSettings();
    mockFindings();
    mockRuns();
    (api.useUpdateBugHunterSettingsMutation as any).mockReturnValue([
      updateSettings,
      { isLoading: false },
    ]);
  });

  it("leads with the name, and keeps the job title for a screen reader", () => {
    mount();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Bug Hunter");
    expect(
      screen.getByRole("img", { name: /Bug Hunter, Software test engineer/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Software test engineer/)).not.toBeInTheDocument();
  });

  describe("the status sentence", () => {
    it("names the state, how many it is fixing now, and when it last swept", () => {
      mockFindings([
        { id: "a", status: BugFindingStatus.NEEDS_INPUT },
        { id: "b", status: BugFindingStatus.FIXING },
        { id: "c", status: BugFindingStatus.QUEUED },
      ]);
      mockRuns([
        {
          id: "r",
          repo: "ally-be",
          trigger: "scheduled",
          status: BugHuntRunStatus.COMPLETED,
          createdAt: hoursAgo(7),
          finishedAt: hoursAgo(6),
        },
      ]);
      mount();

      // The spinner glyph sits just before "Fixing" — agent-working is said by
      // it, not by a colour.
      expect(statusLine()).toHaveTextContent(
        /^Waiting on you · \S?Fixing 2 now · Last sweep 6h ago$/,
      );
    });

    // The persona's own sentence is still there, on the state word, for whoever
    // hovers — it just isn't the line any more.
    it("keeps the persona sentence as the state word's hover title", () => {
      mockFindings([{ id: "a", status: BugFindingStatus.NEEDS_INPUT }]);
      mount();
      expect(screen.getByText("Waiting on you")).toHaveAttribute(
        "title",
        "One bug is waiting on your call. I'll carry on as soon as you decide.",
      );
    });

    // "Working" says nothing "Fixing 2 now" doesn't.
    it("lets the fixing count speak for a working agent", () => {
      mockFindings([{ id: "b", status: BugFindingStatus.FIXING }]);
      mount();

      expect(statusLine()).toHaveTextContent("Fixing 1 now · No sweep yet");
      expect(statusLine()).not.toHaveTextContent("Working");
    });

    it("links Fixing N now to the In progress tab", () => {
      mockFindings([{ id: "b", status: BugFindingStatus.FIXING }]);
      mount();

      fireEvent.click(screen.getByRole("button", { name: /Fixing 1 now/ }));
      expect(onShowInProgress).toHaveBeenCalled();
    });

    it("reports a sweep running now by repo", () => {
      mockRuns([
        {
          id: "r",
          repo: "ally-web",
          trigger: "scheduled",
          status: BugHuntRunStatus.RUNNING,
          createdAt: hoursAgo(0.1),
        },
      ]);
      mount();
      expect(statusLine()).toHaveTextContent("Sweeping ally-web now");
    });

    // A fix session is not a sweep, and "last sweep" must not claim one.
    it("counts only sweeps as sweeps", () => {
      mockRuns([
        {
          id: "r",
          repo: "ally-be",
          trigger: "fix_session",
          status: BugHuntRunStatus.RUNNING,
          createdAt: hoursAgo(0.1),
        },
      ]);
      mount();
      expect(statusLine()).toHaveTextContent("On shift · No sweep yet");
    });

    it("says off duty when it is", () => {
      mockSettings(BugHunterMode.OFF);
      mount();
      expect(statusLine()).toHaveTextContent("Off duty");
    });
  });

  describe("the working style", () => {
    it("is a dropdown with plain labels, on the mode the backend actually has", () => {
      mockSettings(BugHunterMode.MANUAL);
      mount();

      expect(modeSelect()).toHaveValue(BugHunterMode.MANUAL);
      expect([...modeSelect().options].map(option => option.textContent)).toEqual([
        "Off",
        "Manual",
        "Autonomous",
      ]);
    });

    it("asks before changing, and changes nothing until confirmed", () => {
      mount();
      pickMode(BugHunterMode.MANUAL);

      expect(screen.getByTestId("confirm-popup")).toHaveTextContent(
        "Ask Bug Hunter to check with you first?",
      );
      expect(updateSettings).not.toHaveBeenCalled();
      // Still the saved mode underneath the dialog.
      expect(modeSelect()).toHaveValue(BugHunterMode.AI);
    });

    it("sends the new working style once confirmed", async () => {
      mount();
      pickMode(BugHunterMode.MANUAL);
      fireEvent.click(screen.getByText("Confirm"));

      await waitFor(() =>
        expect(updateSettings).toHaveBeenCalledWith({ mode: BugHunterMode.MANUAL }),
      );
    });

    it("cancelling leaves the working style alone", () => {
      mount();
      pickMode(BugHunterMode.OFF);
      fireEvent.click(screen.getByText("Cancel"));

      expect(screen.queryByTestId("confirm-popup")).not.toBeInTheDocument();
      expect(updateSettings).not.toHaveBeenCalled();
      expect(modeSelect()).toHaveValue(BugHunterMode.AI);
    });

    // Each mode has its own consequence, so each gets its own sentence.
    it("explains each working style in its own words", () => {
      mockSettings(BugHunterMode.MANUAL);
      mount();

      pickMode(BugHunterMode.AI);
      expect(screen.getByTestId("confirm-popup")).toHaveTextContent("Let Bug Hunter work solo?");
      expect(screen.getByTestId("confirm-popup")).toHaveTextContent("This is AI mode.");

      fireEvent.click(screen.getByText("Cancel"));
      pickMode(BugHunterMode.OFF);
      expect(screen.getByTestId("confirm-popup")).toHaveTextContent("Send Bug Hunter off duty?");
    });

    it("hides the control rather than guessing at it when settings fail to load", () => {
      mockSettings(BugHunterMode.OFF, { data: undefined, isError: true });
      mount();
      expect(screen.queryByTestId("bug-hunter-mode-select")).not.toBeInTheDocument();
    });
  });

  describe("the ⋯ menu", () => {
    it("holds Model settings", () => {
      mount();
      fireEvent.click(screen.getByRole("menuitem", { name: "Model settings" }));
      expect(navigate).toHaveBeenCalledWith(`${ROUTES.SETTINGS}?tab=ai-models`);
    });

    it("holds the UX signals scan, with its last-scan line beside it", () => {
      mount();
      const item = screen.getByRole("menuitem", { name: /Scan UX signals now/ });
      expect(item).toHaveTextContent("Last scan 10/12/2026: 2 bugs, 1 suggestions filed.");

      fireEvent.click(item);
      expect(uxScan.runScan).toHaveBeenCalled();
    });

    it("disables the scan while one is running", () => {
      uxScan.isBusy = true;
      mount();
      expect(screen.getByRole("menuitem", { name: /Scanning telemetry/ })).toBeDisabled();
    });

    it("leaves the scan out for a reader without UX signals", () => {
      uxScan.canScan = false;
      mount();
      expect(screen.queryByRole("menuitem", { name: /Scan UX signals/ })).not.toBeInTheDocument();
    });

    // A shortcut, not a second implementation: it opens the same confirm the
    // Notebook's button does, for every repo.
    it("opens the feature map's own confirmation, for every repo", () => {
      mount();
      expect(screen.queryByTestId("map-features-dialog")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("menuitem", { name: "Map features now" }));
      expect(screen.getByTestId("map-features-dialog")).toHaveAttribute("data-repo", "all");
    });

    it("leaves Map features now out for a read-only reader", () => {
      mount(false);
      expect(screen.queryByRole("menuitem", { name: "Map features now" })).not.toBeInTheDocument();
    });
  });

  it("opens About from the help button", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "About Bug Hunter" }));
    expect(onShowHelp).toHaveBeenCalled();
  });
});
