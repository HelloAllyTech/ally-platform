import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { en, LOCAL_STORAGE_KEYS } from "@constants";

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Button: ({ children, onClick, disabled, "aria-label": ariaLabel }: any) => (
    <button onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
      {children}
    </button>
  ),
  InlineNotification: ({ title }: any) => <div role="alert">{title}</div>,
  SidePanel: ({ open, children, title }: any) =>
    open ? (
      <div data-testid="side-panel">
        <span>{title}</span>
        {children}
      </div>
    ) : null,
  SkeletonText: () => <div>Loading…</div>,
  Tooltip: ({ children, label }: any) => <span data-tooltip={label}>{children}</span>,
}));

// `@constants` reaches `@store`, which reads `baseAPI.reducerPath` at module load — undefined while
// `@api` is mocked below. A stub store keeps it out.
vi.mock("@store", () => ({
  store: { dispatch: vi.fn(), getState: () => ({}), subscribe: vi.fn() },
}));

// The page is tested against the work pane's written contract, not its internals.
let paneProps: any[] = [];
vi.mock("@components/course-copilot", () => ({
  CourseCopilotWorkPane: (props: any) => {
    paneProps.push(props);
    return <div data-testid="work-pane">{props.detail.session.status}</div>;
  },
}));

vi.mock("@components/agent-chat", () => ({
  ChatMessage: ({ message, onSendSuggestion, onRetry }: any) => (
    <div data-testid="chat-message">
      {message.content}
      {message.retryable && <button onClick={onRetry}>retry</button>}
      {message.suggestedActions?.map((a: any) => (
        <button key={a.label} onClick={() => onSendSuggestion(a.message)}>
          {a.label}
        </button>
      ))}
    </div>
  ),
  ChatComposer: ({ onSend, disabled, placeholder }: any) => (
    <div>
      <input aria-label="composer" placeholder={placeholder} disabled={disabled} />
      <button disabled={disabled} onClick={() => onSend("typed message")}>
        send
      </button>
    </div>
  ),
}));

vi.mock("@components/error-boundary", () => ({
  ErrorBoundary: ({ children }: any) => <>{children}</>,
}));

vi.mock("@components/action-confirmation-popup", () => ({
  ActionConfirmationPopup: ({ isOpen, primaryButton }: any) =>
    isOpen ? (
      <button data-testid="confirm-archive" onClick={primaryButton.onClick}>
        {primaryButton.label}
      </button>
    ) : null,
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<any>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ sessionId: "sess-1" }),
  };
});

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@hooks/useCourseCopilotStream", () => ({
  COURSE_COPILOT_KICKOFF_MESSAGE: "Let's begin.",
}));

let streamOpts: any;
const stream = {
  messages: [] as any[],
  isStreaming: false,
  sendMessage: vi.fn(),
  retryLast: vi.fn(),
  stop: vi.fn(),
  hydrateMessages: vi.fn(),
  syncServerMessages: vi.fn(),
  resetMessages: vi.fn(),
};
let socketOpts: any;
const markSeen = vi.fn();
vi.mock("@hooks", () => ({
  useCourseCopilotStream: (opts: any) => {
    streamOpts = opts;
    return stream;
  },
  useCourseCopilotSocket: (opts: any) => {
    socketOpts = opts;
    return { connected: false, markSeen };
  },
}));

let queryResult: any;
let queryOptions: any;
const refetch = vi.fn();
const mutation = (impl: (arg: any) => Promise<any>) => {
  const fn = vi.fn((arg: any) => ({ unwrap: () => impl(arg) }));
  return fn;
};
let createSessionFn = mutation(async () => ({ id: "sess-2" }));
let archiveFn = mutation(async () => ({ success: true }));
let updateBlueprintFn = mutation(async () => ({}));
let approveFn = mutation(async () => ({}));
let retryFn = mutation(async () => ({}));
let cancelFn = mutation(async () => ({}));
let raiseFn = mutation(async () => ({}));
vi.mock("@api", () => ({
  useGetCourseCopilotSessionQuery: (_arg: any, options: any) => {
    queryOptions = options;
    return { ...queryResult, refetch };
  },
  useCreateCourseCopilotSessionMutation: () => [createSessionFn],
  useArchiveCourseCopilotSessionMutation: () => [archiveFn, { isLoading: false }],
  useUpdateCourseCopilotBlueprintMutation: () => [updateBlueprintFn],
  useApproveCourseCopilotBlueprintMutation: () => [approveFn],
  useRetryCourseCopilotBuildMutation: () => [retryFn],
  useCancelCourseCopilotBuildMutation: () => [cancelFn],
  useRaiseCourseCopilotBudgetMutation: () => [raiseFn],
}));

// eslint-disable-next-line import/first
import { CourseCopilotSession } from "../CourseCopilotSession";

const makeItem = (id: string, title: string, order = 0) => ({
  id,
  type: "ARTICLE",
  order,
  title,
  size: "800 words",
  preview: { type: "ARTICLE", excerpt: "", wordCount: 800, questionCount: 0, resourceCount: 0, imageUrls: [] },
});
const makeOutline = (items: any[]) => ({
  trackId: "t1",
  title: "Course",
  description: null,
  coverImageUrl: null,
  status: "DRAFT",
  estimatedDurationMinutes: 60,
  competencyIds: [],
  structureLocked: false,
  sections: [{ id: "s1", order: 0, title: "Intro", items }],
});

const makeDetail = (overrides: any = {}, sessionOverrides: any = {}) => ({
  session: {
    id: "sess-1",
    title: "My course",
    mode: "CREATE",
    status: "INTERVIEWING",
    trackId: null,
    trackTitle: null,
    trackStatus: null,
    createdAt: "",
    updatedAt: "",
    brief: {},
    briefReadiness: { ready: false, missing: [] },
    blueprint: null,
    blueprintVersion: 0,
    approvedBlueprint: null,
    changeLog: [],
    generatedScenarioIds: [],
    generatedCaseIds: [],
    ...sessionOverrides,
  },
  messages: [],
  jobs: [],
  events: [],
  lastEventSeq: 0,
  outline: null,
  readiness: null,
  budget: { ceilingUsd: 5, spentUsd: 1.25, remainingUsd: 3.75, held: false },
  ...overrides,
});

const setDetail = (detail: any) => {
  queryResult = { data: detail, isLoading: false, isError: false };
};

const lastPane = () => paneProps[paneProps.length - 1];

// The shared test setup reports every media query as non-matching (a phone). The pane is mounted
// in the aside only at `lg` and up, so most tests ask for a wide viewport.
let isLargeViewport = true;
const stubViewport = () => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isLargeViewport && query.includes("min-width: 1024px"),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as never;
};

beforeEach(() => {
  isLargeViewport = true;
  stubViewport();
  localStorage.clear();
  paneProps = [];
  streamOpts = undefined;
  socketOpts = undefined;
  stream.messages = [];
  stream.isStreaming = false;
  Object.values(stream).forEach(value => {
    if (typeof value === "function" && "mockClear" in value) (value as any).mockClear();
  });
  navigateMock.mockClear();
  refetch.mockClear();
  markSeen.mockClear();
  toastMock.error.mockClear();
  toastMock.success.mockClear();
  createSessionFn = mutation(async () => ({ id: "sess-2" }));
  archiveFn = mutation(async () => ({ success: true }));
  updateBlueprintFn = mutation(async () => ({ version: 4 }));
  approveFn = mutation(async () => ({}));
  retryFn = mutation(async () => ({}));
  cancelFn = mutation(async () => ({}));
  raiseFn = mutation(async () => ({}));
  setDetail(makeDetail());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CourseCopilotSession — loading and failure", () => {
  it("shows a skeleton while the session loads", () => {
    queryResult = { data: undefined, isLoading: true, isError: false };
    render(<CourseCopilotSession />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("says so and offers the way back when the session cannot be loaded", () => {
    queryResult = { data: undefined, isLoading: false, isError: true, error: { status: 500 } };
    render(<CourseCopilotSession />);

    expect(screen.getByText(en.courseCopilot.session.loadFailed)).toBeInTheDocument();
    fireEvent.click(screen.getByText(en.courseCopilot.start.backToList));
    expect(navigateMock).toHaveBeenCalledWith("/course-copilot");
  });

  it("forgets a pinned session that no longer exists", () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.COURSE_COPILOT_SESSION_ID, "sess-1");
    queryResult = { data: undefined, isLoading: false, isError: true, error: { status: 404 } };
    render(<CourseCopilotSession />);
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.COURSE_COPILOT_SESSION_ID)).toBeNull();
  });
});

describe("CourseCopilotSession — hydration and kickoff", () => {
  it("seeds the feed from the server once, and pins the session id", () => {
    const detail = makeDetail({ messages: [{ id: "m1", seq: 1, role: "assistant", content: "Hi" }] });
    setDetail(detail);
    const { rerender } = render(<CourseCopilotSession />);

    expect(stream.hydrateMessages).toHaveBeenCalledTimes(1);
    expect(stream.hydrateMessages).toHaveBeenCalledWith(detail.messages);
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.COURSE_COPILOT_SESSION_ID)).toBe("sess-1");

    // A later snapshot (a poll, a refetch) folds in; it never re-seeds.
    const later = makeDetail({
      messages: [
        { id: "m1", seq: 1, role: "assistant", content: "Hi" },
        { id: "m2", seq: 2, role: "assistant", content: "The build is done." },
      ],
    });
    setDetail(later);
    rerender(<CourseCopilotSession />);
    expect(stream.hydrateMessages).toHaveBeenCalledTimes(1);
    expect(stream.syncServerMessages).toHaveBeenCalledWith(later.messages);
  });

  it("sends the hidden kickoff turn for a brand-new interview, exactly once", () => {
    const { rerender } = render(<CourseCopilotSession />);
    rerender(<CourseCopilotSession />);
    rerender(<CourseCopilotSession />);

    expect(stream.sendMessage).toHaveBeenCalledTimes(1);
    expect(stream.sendMessage).toHaveBeenCalledWith("Let's begin.", undefined, true);
  });

  it("does not kick off a session that already has messages", () => {
    setDetail(makeDetail({ messages: [{ id: "m1", seq: 1, role: "assistant", content: "Hi" }] }));
    render(<CourseCopilotSession />);
    expect(stream.sendMessage).not.toHaveBeenCalled();
  });

  // An EDIT session starts from an existing course and waits for the trainer.
  it("does not kick off an EDIT session that starts in EDITING", () => {
    setDetail(makeDetail({}, { mode: "EDIT", status: "EDITING", trackId: "t1" }));
    render(<CourseCopilotSession />);
    expect(stream.sendMessage).not.toHaveBeenCalled();
  });
});

describe("CourseCopilotSession — header", () => {
  it("shows the course title, the status, and the budget against its ceiling", () => {
    setDetail(makeDetail({}, { trackTitle: "Safety planning basics", status: "EDITING", trackId: "t1" }));
    render(<CourseCopilotSession />);

    expect(screen.getByText("Safety planning basics")).toBeInTheDocument();
    expect(screen.getByText(en.courseCopilot.status.EDITING)).toBeInTheDocument();
    expect(screen.getByText("$1.25 of $5.00")).toBeInTheDocument();
  });

  it("says there is no ceiling when the budget is uncapped", () => {
    setDetail(makeDetail({ budget: { ceilingUsd: 0, spentUsd: 2, remainingUsd: null, held: false } }));
    render(<CourseCopilotSession />);
    expect(screen.getByText("$2.00 · no ceiling")).toBeInTheDocument();
  });

  describe("Open in editor", () => {
    it("is disabled during a build, with the reason as its tooltip", () => {
      setDetail(makeDetail({}, { status: "BUILDING", trackId: "t1" }));
      render(<CourseCopilotSession />);

      const button = screen.getByText(en.courseCopilot.session.openInEditor).closest("button");
      expect(button).toBeDisabled();
      expect(
        screen.getByText(en.courseCopilot.session.openInEditor).closest("[data-tooltip]"),
      ).toHaveAttribute(
        "data-tooltip",
        "Wait for the build to finish — the copilot overwrites edits made during the build.",
      );
    });

    it("is disabled before there is a course to open", () => {
      render(<CourseCopilotSession />);
      expect(
        screen.getByText(en.courseCopilot.session.openInEditor).closest("button"),
      ).toBeDisabled();
    });

    it("opens the course in the editor once it can be edited", () => {
      setDetail(makeDetail({}, { status: "EDITING", trackId: "t1" }));
      render(<CourseCopilotSession />);

      fireEvent.click(screen.getByText(en.courseCopilot.session.openInEditor));
      expect(navigateMock).toHaveBeenCalledWith("/edit-track/t1");
    });
  });

  describe("archive", () => {
    it("confirms, archives, forgets the pinned session and returns to the list", async () => {
      localStorage.setItem(LOCAL_STORAGE_KEYS.COURSE_COPILOT_SESSION_ID, "sess-1");
      setDetail(makeDetail({}, { status: "EDITING", trackId: "t1" }));
      render(<CourseCopilotSession />);

      fireEvent.click(screen.getByText(en.courseCopilot.session.archive));
      await act(async () => {
        fireEvent.click(screen.getByTestId("confirm-archive"));
      });

      expect(archiveFn).toHaveBeenCalledWith("sess-1");
      expect(localStorage.getItem(LOCAL_STORAGE_KEYS.COURSE_COPILOT_SESSION_ID)).toBeNull();
      expect(navigateMock).toHaveBeenCalledWith("/course-copilot");
    });

    it("cannot be archived mid-build, with the reason as its tooltip", () => {
      setDetail(makeDetail({}, { status: "BUILDING", trackId: "t1" }));
      render(<CourseCopilotSession />);

      const button = screen.getByText(en.courseCopilot.session.archive).closest("button");
      expect(button).toBeDisabled();
      expect(button?.closest("[data-tooltip]")).toHaveAttribute(
        "data-tooltip",
        en.courseCopilot.session.archiveBuilding,
      );
    });

    it("says why when archiving fails, and stays put", async () => {
      archiveFn = mutation(async () => {
        throw { status: 400, data: { message: "Cannot archive right now." } };
      });
      setDetail(makeDetail({}, { status: "EDITING", trackId: "t1" }));
      render(<CourseCopilotSession />);

      fireEvent.click(screen.getByText(en.courseCopilot.session.archive));
      await act(async () => {
        fireEvent.click(screen.getByTestId("confirm-archive"));
      });

      expect(toastMock.error).toHaveBeenCalledWith("Cannot archive right now.");
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });
});

describe("CourseCopilotSession — chips and composer", () => {
  it("offers the interview's chip and sends its message", () => {
    render(<CourseCopilotSession />);
    stream.sendMessage.mockClear(); // the kickoff

    fireEvent.click(screen.getByText("Just build it with sensible defaults"));

    expect(stream.sendMessage).toHaveBeenCalledWith(
      "Just build it — fill anything still open with sensible defaults and show me the blueprint.",
    );
  });

  it("offers different chips once there is a blueprint", () => {
    setDetail(makeDetail({}, { status: "AWAITING_BLUEPRINT" }));
    render(<CourseCopilotSession />);

    expect(screen.getByText("Make it shorter")).toBeInTheDocument();
    expect(screen.getByText("Explain the sequence")).toBeInTheDocument();
    expect(screen.queryByText("Just build it with sensible defaults")).not.toBeInTheDocument();
  });

  it("offers review/publish/preview chips on a built course", () => {
    setDetail(makeDetail({}, { status: "EDITING", trackId: "t1" }));
    render(<CourseCopilotSession />);

    fireEvent.click(screen.getByText("Publish"));
    expect(stream.sendMessage).toHaveBeenCalledWith("Publish the course.");
    expect(screen.getByText("Review the course")).toBeInTheDocument();
    expect(screen.getByText("Preview outline")).toBeInTheDocument();
  });

  it("offers no chips during a build — the copilot cannot edit the course mid-build", () => {
    setDetail(makeDetail({}, { status: "BUILDING", trackId: "t1" }));
    render(<CourseCopilotSession />);
    expect(screen.queryByText("Publish")).not.toBeInTheDocument();
    expect(screen.queryByText("Make it shorter")).not.toBeInTheDocument();
  });

  it("keeps the composer on during a build, so the copilot can still answer questions", () => {
    setDetail(makeDetail({}, { status: "BUILDING", trackId: "t1" }));
    render(<CourseCopilotSession />);

    const composer = screen.getByLabelText("composer");
    expect(composer).not.toBeDisabled();
    expect(composer).toHaveAttribute("placeholder", en.courseCopilot.session.composerPlaceholder.BUILDING);
  });

  it("turns the composer and chips off for an archived session, and says it is read-only", () => {
    setDetail(makeDetail({}, { status: "ARCHIVED", trackId: "t1" }));
    render(<CourseCopilotSession />);

    expect(screen.getByLabelText("composer")).toBeDisabled();
    expect(screen.getByText(en.courseCopilot.session.archivedNotice)).toBeInTheDocument();
    expect(screen.queryByText("Publish")).not.toBeInTheDocument();
  });

  it("sends typed text and wires Retry to the stream", () => {
    stream.messages = [{ id: "e1", role: "assistant", content: "oops", retryable: true }];
    setDetail(makeDetail({}, { status: "EDITING", trackId: "t1" }));
    render(<CourseCopilotSession />);

    fireEvent.click(screen.getByText("send"));
    expect(stream.sendMessage).toHaveBeenCalledWith("typed message");
    fireEvent.click(screen.getByText("retry"));
    expect(stream.retryLast).toHaveBeenCalledTimes(1);
  });
});

describe("CourseCopilotSession — the work pane", () => {
  // One copy of the editable pane is mounted — in the aside at lg and up, in a sheet below it —
  // never both (two live blueprint trees would each hold their own unsaved edits).
  it("opens the pane as a sheet below lg, from a button named for what is in it", () => {
    isLargeViewport = false;
    stubViewport();
    setDetail(makeDetail({}, { status: "AWAITING_BLUEPRINT" }));
    render(<CourseCopilotSession />);

    expect(screen.queryByTestId("work-pane")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(en.courseCopilot.session.pane.AWAITING_BLUEPRINT));

    expect(screen.getByTestId("side-panel")).toBeInTheDocument();
    expect(screen.getAllByTestId("work-pane")).toHaveLength(1);
  });

  it("mounts the pane in the aside, and no sheet button, at lg and up", () => {
    setDetail(makeDetail({}, { status: "AWAITING_BLUEPRINT" }));
    render(<CourseCopilotSession />);

    expect(screen.getAllByTestId("work-pane")).toHaveLength(1);
    expect(screen.queryByText(en.courseCopilot.session.pane.AWAITING_BLUEPRINT)).not.toBeInTheDocument();
  });

  it("passes the latest detail through the written contract", () => {
    setDetail(makeDetail({}, { status: "EDITING", trackId: "t1" }));
    render(<CourseCopilotSession />);

    const props = lastPane();
    expect(props.detail.session.status).toBe("EDITING");
    expect(props.isBusy).toBe(false);
    for (const callback of [
      "onBlueprintSave",
      "onApprove",
      "onRetryJobs",
      "onCancelBuild",
      "onRaiseBudget",
      "onOpenEditor",
      "onSendMessage",
    ]) {
      expect(typeof props[callback]).toBe("function");
    }
  });

  it("tells the pane a turn is streaming", () => {
    stream.isStreaming = true;
    render(<CourseCopilotSession />);
    expect(lastPane().isBusy).toBe(true);
  });

  it("switches the pane to the blueprint the moment the frame arrives, before the turn ends", () => {
    const { rerender } = render(<CourseCopilotSession />);
    expect(lastPane().detail.session.status).toBe("INTERVIEWING");

    const response = { blueprint: { title: "T" }, version: 1, problems: [] };
    act(() => streamOpts.onBlueprint(response));
    rerender(<CourseCopilotSession />);

    expect(lastPane().detail.session.status).toBe("AWAITING_BLUEPRINT");
    expect(lastPane().liveBlueprint).toBe(response);
  });

  it("drops a streamed blueprint that is older than the session's own", () => {
    setDetail(makeDetail({}, { status: "AWAITING_BLUEPRINT", blueprintVersion: 5 }));
    const { rerender } = render(<CourseCopilotSession />);

    act(() => streamOpts.onBlueprint({ blueprint: { title: "Old" }, version: 2, problems: [] }));
    rerender(<CourseCopilotSession />);

    expect(lastPane().liveBlueprint).toBeNull();
  });

  it("hands the brief over live, and drops it when a fresher snapshot arrives after the turn", () => {
    const { rerender } = render(<CourseCopilotSession />);

    act(() =>
      streamOpts.onBrief({ audience: { who: "New volunteers" } }, { ready: false, missing: ["Assessment"] }),
    );
    rerender(<CourseCopilotSession />);
    expect(lastPane().liveBrief).toEqual({ audience: { who: "New volunteers" } });
    expect(lastPane().liveBriefReadiness).toEqual({ ready: false, missing: ["Assessment"] });

    // The turn settles and the refetch lands: the server is the authority again.
    setDetail(makeDetail({}, { brief: { audience: { who: "New volunteers" } } }));
    rerender(<CourseCopilotSession />);
    expect(lastPane().liveBrief).toBeNull();
    expect(lastPane().liveBriefReadiness).toBeNull();
  });

  it("keeps the live overlays while a turn is still streaming when a snapshot lands", () => {
    const { rerender } = render(<CourseCopilotSession />);
    act(() => streamOpts.onBrief({ notes: ["a"] }, { ready: true, missing: [] }));
    stream.isStreaming = true;
    rerender(<CourseCopilotSession />);

    // A poll lands mid-turn with an older brief.
    setDetail(makeDetail());
    rerender(<CourseCopilotSession />);

    expect(lastPane().liveBrief).toEqual({ notes: ["a"] });
  });

  it("takes the status from `done` without waiting for the refetch", () => {
    const { rerender } = render(<CourseCopilotSession />);
    act(() => streamOpts.onDone({ messageSeq: 4, sessionStatus: "AWAITING_BLUEPRINT" }));
    rerender(<CourseCopilotSession />);

    expect(lastPane().detail.session.status).toBe("AWAITING_BLUEPRINT");
    expect(screen.getByText(en.courseCopilot.status.AWAITING_BLUEPRINT)).toBeInTheDocument();
  });

  describe("course_patch", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      setDetail(
        makeDetail(
          { outline: makeOutline([makeItem("i1", "Intro article", 0), makeItem("i2", "Quiz", 1)]) },
          { status: "EDITING", trackId: "t1" },
        ),
      );
    });

    it("flashes only the items that changed, shows the new outline now, and refetches the rest", () => {
      const { rerender } = render(<CourseCopilotSession />);

      const patched = makeOutline([
        makeItem("i0", "A new first article", 0),
        makeItem("i1", "Intro article", 1), // only renumbered
        makeItem("i2", "Quiz — renamed", 2),
      ]);
      act(() => streamOpts.onCoursePatch({ summary: "Added an article", outline: patched }));
      rerender(<CourseCopilotSession />);

      expect(lastPane().flashItemIds.sort()).toEqual(["i0", "i2"]);
      expect(lastPane().detail.outline).toBe(patched);
      expect(refetch).not.toHaveBeenCalled();

      // The change log and previews come from the session, after the debounce.
      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(refetch).toHaveBeenCalledTimes(1);

      // The highlight is brief.
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      rerender(<CourseCopilotSession />);
      expect(lastPane().flashItemIds).toEqual([]);
    });

    it("collapses a burst of patches into one refetch", () => {
      render(<CourseCopilotSession />);

      act(() => {
        streamOpts.onCoursePatch({ summary: "a", outline: null });
        streamOpts.onCoursePatch({ summary: "b", outline: null });
        streamOpts.onBuildStarted({ jobCount: 1 });
        vi.advanceTimersByTime(800);
      });

      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("polling and the socket", () => {
    it("polls every 5s while a build runs", () => {
      setDetail(makeDetail({}, { status: "BUILDING", trackId: "t1" }));
      render(<CourseCopilotSession />);
      expect(queryOptions.pollingInterval).toBe(5000);
    });

    it("keeps polling while jobs are still queued or running, even after the status moves on", () => {
      // The reviewer's post-build message lands after the status flips to EDITING.
      setDetail(
        makeDetail(
          { jobs: [{ id: "j1", status: "running" }] },
          { status: "EDITING", trackId: "t1" },
        ),
      );
      render(<CourseCopilotSession />);
      expect(queryOptions.pollingInterval).toBe(5000);
    });

    it("does not poll an idle session", () => {
      setDetail(makeDetail({ jobs: [{ id: "j1", status: "done" }] }, { status: "EDITING", trackId: "t1" }));
      render(<CourseCopilotSession />);
      expect(queryOptions.pollingInterval).toBe(0);
    });

    it("treats pushed events as invalidation signals: refetch, debounced, and show them in the pane", () => {
      vi.useFakeTimers();
      setDetail(makeDetail({ events: [{ seq: 1, type: "build_started", payload: {}, createdAt: "" }] }, { status: "BUILDING", trackId: "t1" }));
      const { rerender } = render(<CourseCopilotSession />);

      act(() =>
        socketOpts.onEvents([
          { seq: 2, type: "job_started", payload: {}, createdAt: "" },
          { seq: 3, type: "job_done", payload: {}, createdAt: "" },
        ]),
      );
      rerender(<CourseCopilotSession />);

      expect(lastPane().detail.events.map((e: any) => e.seq)).toEqual([1, 2, 3]);
      expect(refetch).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it("refetches after a reconnect, since what was pushed while down is gone", () => {
      vi.useFakeTimers();
      render(<CourseCopilotSession />);
      act(() => {
        socketOpts.onMissedWindow();
        vi.advanceTimersByTime(800);
      });
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it("tells the socket which events the detail already carries", () => {
      const events = [{ seq: 1, type: "build_started", payload: {}, createdAt: "" }];
      setDetail(makeDetail({ events }));
      render(<CourseCopilotSession />);
      expect(markSeen).toHaveBeenCalledWith(events);
    });

    it("does not open the socket for an archived session", () => {
      setDetail(makeDetail({}, { status: "ARCHIVED", trackId: "t1" }));
      render(<CourseCopilotSession />);
      expect(socketOpts.enabled).toBe(false);
    });
  });

  describe("callbacks the pane calls", () => {
    const renderPane = () => {
      setDetail(makeDetail({}, { status: "AWAITING_BLUEPRINT" }));
      return render(<CourseCopilotSession />);
    };

    it("approves, and shows the build starting before the refetch confirms it", async () => {
      const { rerender } = renderPane();

      let ok: boolean | undefined;
      await act(async () => {
        ok = await lastPane().onApprove(3);
      });
      rerender(<CourseCopilotSession />);

      expect(ok).toBe(true);
      expect(approveFn).toHaveBeenCalledWith({ id: "sess-1", version: 3 });
      expect(lastPane().detail.session.status).toBe("BUILDING");
    });

    it("shows the server's list of what blocks approval", async () => {
      approveFn = mutation(async () => {
        throw { status: 400, data: { message: "Section 2 is empty. A video needs a link." } };
      });
      renderPane();

      let ok: boolean | undefined;
      await act(async () => {
        ok = await lastPane().onApprove(3);
      });

      expect(ok).toBe(false);
      expect(toastMock.error).toHaveBeenCalledWith("Section 2 is empty. A video needs a link.");
    });

    it("reloads rather than overwrites when the version is stale (409)", async () => {
      approveFn = mutation(async () => {
        throw { status: 409, data: { message: "Stale" } };
      });
      renderPane();

      await act(async () => {
        await lastPane().onApprove(3);
      });

      expect(toastMock.error).toHaveBeenCalledWith(en.courseCopilot.session.approveStale);
      expect(refetch).toHaveBeenCalled();
    });

    it("saves a blueprint edit and hands the response to the pane", async () => {
      const { rerender } = renderPane();
      const blueprint = { title: "Edited" } as never;

      let response: any;
      await act(async () => {
        response = await lastPane().onBlueprintSave(blueprint, 2);
      });
      rerender(<CourseCopilotSession />);

      expect(updateBlueprintFn).toHaveBeenCalledWith({ id: "sess-1", blueprint, version: 2 });
      expect(response).toEqual({ version: 4 });
      expect(lastPane().liveBlueprint).toEqual({ version: 4 });
    });

    it("returns null and reloads when a blueprint save hits a newer version (409)", async () => {
      updateBlueprintFn = mutation(async () => {
        throw { status: 409, data: { message: "Stale" } };
      });
      renderPane();

      let response: any = "unset";
      await act(async () => {
        response = await lastPane().onBlueprintSave({} as never, 1);
      });

      expect(response).toBeNull();
      expect(toastMock.error).toHaveBeenCalledWith(en.courseCopilot.session.saveStale);
      expect(refetch).toHaveBeenCalled();
    });

    it("retries named jobs, or all failed ones when none are named", async () => {
      renderPane();

      await act(async () => {
        await lastPane().onRetryJobs(["j1"]);
      });
      await act(async () => {
        await lastPane().onRetryJobs();
      });

      expect(retryFn).toHaveBeenNthCalledWith(1, { id: "sess-1", jobIds: ["j1"] });
      expect(retryFn).toHaveBeenNthCalledWith(2, { id: "sess-1", jobIds: undefined });
    });

    it("cancels the build", async () => {
      renderPane();
      await act(async () => {
        await lastPane().onCancelBuild();
      });
      expect(cancelFn).toHaveBeenCalledWith("sess-1");
    });

    it("raises the ceiling, and shows the server's reason when it is refused", async () => {
      const { rerender } = renderPane();
      let ok: boolean | undefined;
      await act(async () => {
        ok = await lastPane().onRaiseBudget(10);
      });
      expect(ok).toBe(true);
      expect(raiseFn).toHaveBeenCalledWith({ id: "sess-1", budgetUsd: 10 });

      raiseFn = mutation(async () => {
        throw { status: 400, data: { message: "The ceiling must exceed what is already spent." } };
      });
      rerender(<CourseCopilotSession />);
      await act(async () => {
        ok = await lastPane().onRaiseBudget(1);
      });
      expect(ok).toBe(false);
      expect(toastMock.error).toHaveBeenCalledWith("The ceiling must exceed what is already spent.");
    });

    it("sends a chat turn when the pane asks for one, unless a turn is already streaming", () => {
      renderPane();
      lastPane().onSendMessage("Fix quiz 2.3");
      expect(stream.sendMessage).toHaveBeenCalledWith("Fix quiz 2.3");
    });
  });
});

describe("CourseCopilotSession — a session that vanished mid-turn", () => {
  it("creates a replacement (re-bound to the same course) and moves to it without reseeding the feed", async () => {
    setDetail(makeDetail({ messages: [{ id: "m1", seq: 1, role: "assistant", content: "Hi" }] }, { mode: "EDIT", status: "EDITING", trackId: "t1" }));
    render(<CourseCopilotSession />);
    stream.hydrateMessages.mockClear();

    let id: string | null = null;
    await act(async () => {
      id = await streamOpts.onSessionInvalid();
    });

    expect(id).toBe("sess-2");
    expect(createSessionFn).toHaveBeenCalledWith({ trackId: "t1" });
    expect(navigateMock).toHaveBeenCalledWith("/course-copilot/sess-2", { replace: true });
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.COURSE_COPILOT_SESSION_ID)).toBe("sess-2");
  });

  it("starts a fresh course session when the lost one was not bound to a course", async () => {
    render(<CourseCopilotSession />);
    await act(async () => {
      await streamOpts.onSessionInvalid();
    });
    expect(createSessionFn).toHaveBeenCalledWith(undefined);
  });

  it("falls back to a go-back state, and no replay, when no replacement can be created", async () => {
    createSessionFn = mutation(async () => {
      throw { status: 409, data: { message: "You already have two active sessions." } };
    });
    render(<CourseCopilotSession />);

    let id: string | null = "unset";
    await act(async () => {
      id = await streamOpts.onSessionInvalid();
    });

    expect(id).toBeNull();
    expect(screen.getByText(en.courseCopilot.session.sessionGone)).toBeInTheDocument();
    expect(screen.getByLabelText("composer")).toBeDisabled();
  });
});
