import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@components", () => ({ cellTypes: {} }));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  InlineNotification: ({ title }: any) => <div>{title}</div>,
  SkeletonText: () => <div>Loading…</div>,
  Tag: ({ children }: any) => <span>{children}</span>,
}));

// SteerComposer and CollapsibleAside render only in the build layout, which no
// test reached until the restart cases below.
let startDialogProps: any;
let steerHintProps: any = null;
let prdPanelProps: any[] = [];
vi.mock("@components/builder", async () => ({
  // The real rule, not a stub: it is what decides whether Start is blocked.
  designBuildBlock: (await vi.importActual<any>("../../../components/builder/designGate"))
    .designBuildBlock,
  // The real issue-build rules, for the same reason.
  ...(await vi.importActual<any>("../../../components/builder/issueBuild")),
  IssueSteerHint: (props: any) => {
    steerHintProps = props;
    return <div>IssueSteerHint</div>;
  },
  TechnicalDesignPanel: () => <div>TechnicalDesignPanel</div>,
  BuildView: () => <div>BuildView</div>,
  ChatComposer: () => <div>ChatComposer</div>,
  ChatMessage: () => <div>ChatMessage</div>,
  CollapsibleAside: ({ children }: any) => <div>{children}</div>,
  ConfirmCancelDialog: () => null,
  PrdDocPanel: (props: any) => {
    prdPanelProps.push(props);
    return <div>PrdDocPanel</div>;
  },
  ReadinessRing: () => <div>ReadinessRing</div>,
  StartBuildDialog: (props: any) => {
    startDialogProps = props;
    return null;
  },
  SteerComposer: () => <div>SteerComposer</div>,
}));

vi.mock("@components/error-boundary", () => ({
  ErrorBoundary: ({ children }: any) => <>{children}</>,
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<any>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ sessionId: "session-1" }),
    useLocation: () => ({ pathname: "/builder/session-1", state: null }),
  };
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@utils", () => ({ asAgentText: (value: any) => value ?? "" }));

let onSessionInvalid: (() => Promise<null>) | undefined;
vi.mock("@hooks", () => ({
  useBuilderStream: (opts: any) => {
    onSessionInvalid = opts.onSessionInvalid;
    return {
      messages: [],
      isStreaming: false,
      sendMessage: vi.fn(),
      stop: vi.fn(),
      hydrateMessages: vi.fn(),
    };
  },
}));

let sessionResult: any;
let pullRequests: any[] = [];
let runs: any[] = [];
let milestones: any[] = [];
const startBuild = vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({}) });
vi.mock("@api", () => ({
  useGetBuilderSessionQuery: () => sessionResult,
  useGetBuilderSettingsQuery: () => ({ data: undefined }),
  usePatchBuilderPrdMutation: () => [vi.fn()],
  useCancelBuilderSessionMutation: () => [vi.fn(), { isLoading: false }],
  useGetBuilderPullRequestsQuery: () => ({ data: pullRequests }),
  useGetBuilderRunsQuery: () => ({ data: runs }),
  useGetBuilderMilestonesQuery: () => ({ data: milestones }),
  useStartBuilderBuildMutation: () => [startBuild, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { BuilderSession } from "../BuilderSession";

const baseSession = {
  id: "session-1",
  title: "Test session",
  status: "INTERVIEWING",
  prd: { title: "" },
  readiness: { ready: false },
  prdVersionNumber: 1,
  messages: [],
  repos: [],
  currentStage: null,
  error: null,
  budgetUsd: null,
};

describe("BuilderSession", () => {
  beforeEach(() => {
    navigateMock.mockClear();
    onSessionInvalid = undefined;
    sessionResult = { data: baseSession, isLoading: false, isError: false };
    pullRequests = [];
    runs = [];
    milestones = [];
    startBuild.mockClear();
  });

  it("closes the embedded drawer instead of navigating away when the session is lost and 'New session' is clicked", async () => {
    const onClose = vi.fn();
    render(<BuilderSession sessionId="session-1" onClose={onClose} />);

    await act(async () => {
      await onSessionInvalid?.();
    });

    fireEvent.click(screen.getByText("New build"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("navigates to the full-page Builder when the session is lost outside the drawer", async () => {
    render(<BuilderSession />);

    await act(async () => {
      await onSessionInvalid?.();
    });

    fireEvent.click(screen.getByText("New build"));

    expect(navigateMock).toHaveBeenCalledWith("/builder");
  });

  /**
   * Stopping a build used to strand the session. The start control lives in the
   * readiness panel, which stops rendering once a session has a build, and the
   * header offered its retry only on FAILED — so pressing stop, the one
   * deliberate mid-build action a person takes, was also the action that left
   * the PRD and the branch with no route back into a build.
   */
  const terminal = (status: string) => {
    sessionResult = {
      data: { ...baseSession, status, currentStage: "CODING" },
      isLoading: false,
      isError: false,
    };
    render(<BuilderSession />);
  };

  it("offers a way back into a build after a stop", () => {
    terminal("CANCELLED");
    expect(screen.getByText("Retry build")).toBeTruthy();
  });

  it("still offers one after a failure", () => {
    terminal("FAILED");
    expect(screen.getByText("Retry build")).toBeTruthy();
  });

  /**
   * Not from COMPLETED: its pull requests are open or merged, and a second
   * build of finished work opens a competing set against the same PRD.
   */
  it("does not offer one on finished work", () => {
    pullRequests = [{ id: "pr-1" }];
    terminal("COMPLETED");
    expect(screen.queryByText("Retry build")).toBeNull();
  });

  /**
   * "A session with no pull requests has shipped nothing, whatever its status."
   * A run that claimed done and left an empty branch settles the session green;
   * without this the page offers no way onward from a success that did not
   * happen.
   */
  it("offers one on a completed session that shipped nothing", () => {
    pullRequests = [];
    terminal("COMPLETED");
    expect(screen.getByText("Retry build")).toBeTruthy();
  });

  /**
   * The header used to prefer a local copy of the status that was seeded once,
   * at load, and never cleared — so a build that finished while you watched it
   * kept reading "Building" beneath a phase rail that had already reached the
   * end, and only a refresh reconciled the two. The poll moving is the moment
   * the local copy stops being the newer of the two.
   */
  it("tells the start dialog the build is blocked until the design is approved", () => {
    render(<BuilderSession />);
    expect(startDialogProps.designBlock).toBe("notApproved");
  });

  it("blocks on a stale approved design, and not on a fresh one", () => {
    const approved = {
      ...baseSession,
      prd: { title: "", technicalDesign: { status: "approved" } },
    };
    sessionResult = {
      data: { ...approved, designReadiness: { ready: true, stale: true, blockers: [] } },
      isLoading: false,
      isError: false,
    };
    const { unmount } = render(<BuilderSession />);
    expect(startDialogProps.designBlock).toBe("stale");
    unmount();

    sessionResult = {
      data: { ...approved, designReadiness: { ready: true, stale: false, blockers: [] } },
      isLoading: false,
      isError: false,
    };
    render(<BuilderSession />);
    expect(startDialogProps.designBlock).toBeNull();
  });

  /**
   * After a failed or stopped build is exactly when the PRD needs fixing, and
   * the backend accepts the edit. The panel used to lock every finished
   * session and say "a build is running".
   */
  it("keeps the PRD editable after a failed build, and locks it once complete", () => {
    sessionResult = {
      data: { ...baseSession, status: "FAILED", currentStage: "GATE" },
      isLoading: false,
      isError: false,
    };
    prdPanelProps = [];
    const { unmount } = render(<BuilderSession />);
    expect(prdPanelProps.length).toBeGreaterThan(0);
    expect(prdPanelProps.every(props => props.editable === true)).toBe(true);
    unmount();

    sessionResult = {
      data: { ...baseSession, status: "COMPLETED", currentStage: "DONE" },
      isLoading: false,
      isError: false,
    };
    prdPanelProps = [];
    render(<BuilderSession />);
    expect(prdPanelProps.every(props => props.editable === false)).toBe(true);
    expect(prdPanelProps[0].lockedReason).toMatch(/session is complete/);
  });

  it("follows the session row when a build finishes while the page is open", () => {
    sessionResult = {
      data: { ...baseSession, status: "BUILDING", currentStage: "CODING" },
      isLoading: false,
      isError: false,
    };
    const { rerender } = render(<BuilderSession />);
    expect(screen.getByText("Building")).toBeTruthy();

    sessionResult = {
      data: { ...baseSession, status: "COMPLETED", currentStage: "CODING" },
      isLoading: false,
      isError: false,
    };
    rerender(<BuilderSession />);

    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.queryByText("Building")).toBeNull();
  });

  describe("issue builds", () => {
    const issueRun = (overrides: any = {}) => ({
      id: "run-1",
      mode: "build",
      status: "RUNNING",
      issueNumber: 7,
      issueUrl: "https://github.com/org/ally-be/issues/7",
      repos: ["ally-be"],
      milestoneId: "m-1",
      cost: { issueTimeline: ["issue"] },
      ...overrides,
    });

    it("replaces the steering composer with the /oc hint when the latest run is an issue build", () => {
      runs = [issueRun()];
      sessionResult = {
        data: { ...baseSession, status: "BUILDING", currentStage: "CODING" },
        isLoading: false,
        isError: false,
      };
      render(<BuilderSession />);
      expect(screen.getByText("IssueSteerHint")).toBeTruthy();
      expect(screen.queryByText("SteerComposer")).toBeNull();
    });

    it("keeps the /oc hint when a review ran on the runner after the issue build", () => {
      // Ankita's session: the old "Read at ralph / gate" notes came back because
      // a review run, not a build, was the newest run.
      runs = [
        issueRun({ status: "SUCCEEDED" }),
        { id: "run-2", mode: "review", status: "SUCCEEDED", issueNumber: null },
      ];
      sessionResult = {
        data: { ...baseSession, status: "COMPLETED", currentStage: "DONE" },
        isLoading: false,
        isError: false,
      };
      render(<BuilderSession />);
      expect(screen.getByText("IssueSteerHint")).toBeTruthy();
      expect(screen.queryByText("SteerComposer")).toBeNull();
    });

    it("keeps the steering composer for a legacy run", () => {
      runs = [{ id: "run-1", mode: "build", status: "RUNNING", issueNumber: null }];
      sessionResult = {
        data: { ...baseSession, status: "BUILDING", currentStage: "CODING" },
        isLoading: false,
        isError: false,
      };
      render(<BuilderSession />);
      expect(screen.getByText("SteerComposer")).toBeTruthy();
      expect(screen.queryByText("IssueSteerHint")).toBeNull();
    });

    it("offers to continue the chain with an issue build when a repo is still to build", async () => {
      pullRequests = [{ id: "pr-1" }];
      runs = [issueRun({ status: "SUCCEEDED" })];
      milestones = [
        { id: "m-1", position: 0, repos: ["ally-be"], status: "COMPLETED" },
        { id: "m-2", position: 1, repos: ["ally-web"], status: "PENDING" },
      ];
      terminal("COMPLETED");

      fireEvent.click(screen.getByText("Continue (next: ally-web)"));
      await vi.waitFor(() =>
        expect(startBuild).toHaveBeenCalledWith({ id: "session-1", dispatch: "issue" }),
      );
    });

    it("does not offer to continue once every repo is done or skipped", () => {
      pullRequests = [{ id: "pr-1" }];
      runs = [issueRun({ status: "SUCCEEDED" })];
      milestones = [
        { id: "m-1", position: 0, repos: ["ally-be"], status: "COMPLETED" },
        { id: "m-2", position: 1, repos: ["ally-web"], status: "SKIPPED" },
      ];
      terminal("COMPLETED");
      expect(screen.queryByText(/Continue \(next/)).toBeNull();
    });

    describe("in a repo chain", () => {
      const chainRuns = () => [
        issueRun({ id: "run-1", status: "SUCCEEDED", milestoneId: "m-be", repos: ["ally-be"] }),
        issueRun({ id: "run-2", status: "SUCCEEDED", milestoneId: "m-web", repos: ["ally-web"] }),
      ];

      it("sums up the chain in the header instead of listing its repos", () => {
        runs = chainRuns().map(run => ({ ...run, mode: "build" }));
        milestones = [
          { id: "m-be", position: 0, repos: ["ally-be"], status: "COMPLETED" },
          { id: "m-web", position: 1, repos: ["ally-web"], status: "COMPLETED" },
          { id: "m-mobile", position: 2, repos: ["ally-mobile"], status: "COMPLETED" },
        ];
        pullRequests = [{ id: "pr-1" }];
        sessionResult = {
          data: {
            ...baseSession,
            status: "COMPLETED",
            currentStage: "DONE",
            repos: ["ally-be", "ally-web", "ally-mobile"],
          },
          isLoading: false,
          isError: false,
        };
        render(<BuilderSession />);

        expect(screen.getByText("3 of 3 repos built")).toBeTruthy();
        expect(screen.queryByText("ally-be, ally-web, ally-mobile")).toBeNull();
        expect(steerHintProps.chained).toBe(true);
      });

      it("names the repo being built, and where a failed chain stopped", () => {
        runs = chainRuns().map(run => ({ ...run, mode: "build" }));
        milestones = [
          { id: "m-be", position: 0, repos: ["ally-be"], status: "COMPLETED" },
          { id: "m-web", position: 1, repos: ["ally-web"], status: "BUILDING" },
          { id: "m-mobile", position: 2, repos: ["ally-mobile"], status: "PENDING" },
        ];
        sessionResult = {
          data: { ...baseSession, status: "BUILDING", currentStage: "SETUP" },
          isLoading: false,
          isError: false,
        };
        const { unmount } = render(<BuilderSession />);
        expect(screen.getByText("Building ally-web (2 of 3)")).toBeTruthy();
        unmount();

        milestones[1].status = "FAILED";
        sessionResult = {
          data: { ...baseSession, status: "FAILED", currentStage: "GATE" },
          isLoading: false,
          isError: false,
        };
        render(<BuilderSession />);
        expect(screen.getByText("Stopped at ally-web")).toBeTruthy();
      });

      it("says which repo needs a person, ahead of the built count", () => {
        runs = chainRuns().map(run => ({ ...run, mode: "build" }));
        milestones = [
          { id: "m-be", position: 0, repos: ["ally-be"], status: "COMPLETED" },
          { id: "m-web", position: 1, repos: ["ally-web"], status: "COMPLETED" },
        ];
        pullRequests = [
          { id: "pr-be", repo: "ally-be", prNumber: 1, prUrl: "u", merged: true, state: "closed" },
          {
            id: "pr-web",
            repo: "ally-web",
            prNumber: 2,
            prUrl: "u",
            merged: false,
            state: "open",
            needsHumanAt: "2026-10-14T10:00:00Z",
            needsHumanReason: "Two reviews in a row ended without a verdict.",
          },
        ];
        sessionResult = {
          data: { ...baseSession, status: "COMPLETED", currentStage: "DONE" },
          isLoading: false,
          isError: false,
        };
        render(<BuilderSession />);
        expect(screen.getByText("Needs you: ally-web")).toBeTruthy();
        expect(screen.queryByText("2 of 2 repos built")).toBeNull();
      });

      it("keeps the repo list for a session without a chain", () => {
        runs = [{ ...issueRun(), mode: "build" }];
        milestones = [];
        sessionResult = {
          data: { ...baseSession, status: "BUILDING", currentStage: "CODING", repos: ["ally-be"] },
          isLoading: false,
          isError: false,
        };
        render(<BuilderSession />);
        expect(screen.getByText("ally-be")).toBeTruthy();
        expect(steerHintProps.chained).toBe(false);
      });
    });
  });
});
