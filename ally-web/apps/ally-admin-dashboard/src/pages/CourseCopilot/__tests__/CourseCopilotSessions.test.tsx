import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { en, LOCAL_STORAGE_KEYS } from "@constants";

vi.mock("@store", () => ({
  store: { dispatch: vi.fn(), getState: () => ({}), subscribe: vi.fn() },
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  InlineNotification: ({ title }: any) => <div role="alert">{title}</div>,
  SkeletonText: () => <div>Loading…</div>,
  Tile: ({ children, onClick, className }: any) => (
    <div className={className} onClick={onClick}>
      {children}
    </div>
  ),
}));

vi.mock("@components/action-confirmation-popup", () => ({
  ActionConfirmationPopup: ({ isOpen, title, description, primaryButton, secondaryButton }: any) =>
    isOpen ? (
      <div data-testid="confirm">
        <h2>{title}</h2>
        <p>{description}</p>
        <button data-testid="confirm-primary" onClick={primaryButton.onClick}>
          {primaryButton.label}
        </button>
        <button data-testid="confirm-secondary" onClick={secondaryButton.onClick}>
          {secondaryButton.label}
        </button>
      </div>
    ) : null,
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<any>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

let listResult: any;
let listOptions: any;
let createFn: any;
let archiveFn: any;
const resolves = (value: unknown) => vi.fn(() => ({ unwrap: () => Promise.resolve(value) }));
const rejects = (error: unknown) => vi.fn(() => ({ unwrap: () => Promise.reject(error) }));
vi.mock("@api", () => ({
  useGetCourseCopilotSessionsQuery: (_arg: unknown, options: unknown) => {
    listOptions = options;
    return listResult;
  },
  useCreateCourseCopilotSessionMutation: () => [createFn, { isLoading: false }],
  useArchiveCourseCopilotSessionMutation: () => [archiveFn],
}));

// eslint-disable-next-line import/first
import { CourseCopilotSessions } from "../CourseCopilotSessions";

const session = (overrides: any = {}) => ({
  id: "s1",
  title: "Safety planning",
  mode: "CREATE",
  status: "EDITING",
  trackId: "t1",
  trackTitle: "Safety planning basics",
  trackStatus: "DRAFT",
  createdAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-02T10:00:00Z",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  listResult = { data: [session()], isLoading: false, isError: false };
  createFn = resolves({ id: "new-1" });
  archiveFn = resolves({ success: true });
});

describe("CourseCopilotSessions", () => {
  it("titles the page and offers a new course", () => {
    render(<CourseCopilotSessions />);
    expect(screen.getByRole("heading", { name: "Course Copilot" })).toBeInTheDocument();
    expect(screen.getByText("New course")).toBeInTheDocument();
  });

  it("refreshes on its own, since a build finishes while the tab sits in the background", () => {
    render(<CourseCopilotSessions />);
    expect(listOptions.pollingInterval).toBe(15000);
  });

  it("shows a skeleton while loading and an error when the list cannot be loaded", () => {
    listResult = { data: undefined, isLoading: true, isError: false };
    const { unmount } = render(<CourseCopilotSessions />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    unmount();

    listResult = { data: undefined, isLoading: false, isError: true };
    render(<CourseCopilotSessions />);
    expect(screen.getByText(en.courseCopilot.list.loadFailed)).toBeInTheDocument();
  });

  it("says where to start when there are no sessions (decided copy)", () => {
    listResult = { data: [], isLoading: false, isError: false };
    render(<CourseCopilotSessions />);
    expect(
      screen.getByText(
        "No copilot sessions yet. Start one from Simulation Studio → New → Course with Copilot.",
      ),
    ).toBeInTheDocument();
  });

  it("copes with a response that is not an array", () => {
    listResult = { data: { oops: true }, isLoading: false, isError: false };
    render(<CourseCopilotSessions />);
    expect(screen.getByText(en.courseCopilot.list.empty)).toBeInTheDocument();
  });

  it("lists each session with its type, course and status", () => {
    listResult = {
      data: [
        session(),
        session({
          id: "s2",
          title: "",
          mode: "EDIT",
          status: "AWAITING_BLUEPRINT",
          trackId: null,
          trackTitle: null,
        }),
      ],
      isLoading: false,
      isError: false,
    };
    render(<CourseCopilotSessions />);

    expect(screen.getByText("Safety planning")).toBeInTheDocument();
    expect(screen.getByText("New course · Safety planning basics")).toBeInTheDocument();
    expect(screen.getByText(en.courseCopilot.status.EDITING)).toBeInTheDocument();
    // A session with no title or course yet still reads as something.
    expect(screen.getByText(en.courseCopilot.session.untitled)).toBeInTheDocument();
    expect(
      screen.getByText(`Editing a course · ${en.courseCopilot.list.noCourseYet}`),
    ).toBeInTheDocument();
    expect(screen.getByText(en.courseCopilot.status.AWAITING_BLUEPRINT)).toBeInTheDocument();
  });

  it("resumes a session from its card or its Open button", () => {
    render(<CourseCopilotSessions />);

    fireEvent.click(screen.getByText("Safety planning"));
    expect(navigateMock).toHaveBeenLastCalledWith("/course-copilot/s1");

    navigateMock.mockClear();
    fireEvent.click(screen.getByText(en.courseCopilot.list.open));
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith("/course-copilot/s1");
  });

  describe("archive", () => {
    it("asks first, and says the course itself is never deleted", () => {
      render(<CourseCopilotSessions />);

      fireEvent.click(screen.getByText(en.courseCopilot.list.archive));

      expect(screen.getByTestId("confirm")).toBeInTheDocument();
      expect(screen.getByText(/The course itself is never deleted/)).toBeInTheDocument();
      // Opening the confirm must not also open the session behind it.
      expect(navigateMock).not.toHaveBeenCalled();
      expect(archiveFn).not.toHaveBeenCalled();
    });

    it("archives on confirm, and forgets the session if it was the pinned one", async () => {
      localStorage.setItem(LOCAL_STORAGE_KEYS.COURSE_COPILOT_SESSION_ID, "s1");
      render(<CourseCopilotSessions />);

      fireEvent.click(screen.getByText(en.courseCopilot.list.archive));
      await act(async () => {
        fireEvent.click(screen.getByTestId("confirm-primary"));
      });

      expect(archiveFn).toHaveBeenCalledWith("s1");
      expect(toastMock.success).toHaveBeenCalledWith(en.courseCopilot.list.archiveSuccess);
      expect(localStorage.getItem(LOCAL_STORAGE_KEYS.COURSE_COPILOT_SESSION_ID)).toBeNull();
      expect(screen.queryByTestId("confirm")).not.toBeInTheDocument();
    });

    it("leaves another session's pin alone", async () => {
      localStorage.setItem(LOCAL_STORAGE_KEYS.COURSE_COPILOT_SESSION_ID, "other");
      render(<CourseCopilotSessions />);

      fireEvent.click(screen.getByText(en.courseCopilot.list.archive));
      await act(async () => {
        fireEvent.click(screen.getByTestId("confirm-primary"));
      });

      expect(localStorage.getItem(LOCAL_STORAGE_KEYS.COURSE_COPILOT_SESSION_ID)).toBe("other");
    });

    it("does nothing when the trainer keeps the session", () => {
      render(<CourseCopilotSessions />);

      fireEvent.click(screen.getByText(en.courseCopilot.list.archive));
      fireEvent.click(screen.getByTestId("confirm-secondary"));

      expect(archiveFn).not.toHaveBeenCalled();
      expect(screen.queryByTestId("confirm")).not.toBeInTheDocument();
    });

    it("says so when archiving fails", async () => {
      archiveFn = rejects({ status: 500 });
      render(<CourseCopilotSessions />);

      fireEvent.click(screen.getByText(en.courseCopilot.list.archive));
      await act(async () => {
        fireEvent.click(screen.getByTestId("confirm-primary"));
      });

      expect(toastMock.error).toHaveBeenCalledWith(en.courseCopilot.list.archiveFailed);
    });

    // Archiving mid-build is left to the build's own cancel (see the session page).
    it("offers no Archive on a session that is building", () => {
      listResult = {
        data: [session({ status: "BUILDING" })],
        isLoading: false,
        isError: false,
      };
      render(<CourseCopilotSessions />);
      expect(screen.queryByText(en.courseCopilot.list.archive)).not.toBeInTheDocument();
    });
  });

  describe("New course", () => {
    it("creates a session and opens it", async () => {
      render(<CourseCopilotSessions />);

      await act(async () => {
        fireEvent.click(screen.getByText("New course"));
      });

      expect(createFn).toHaveBeenCalledTimes(1);
      expect(navigateMock).toHaveBeenCalledWith("/course-copilot/new-1");
    });

    it("shows the server's message when the cap is hit (409), and stays put", async () => {
      createFn = rejects({
        status: 409,
        data: { message: "You already have 2 active Course Copilot sessions. Archive one first." },
      });
      render(<CourseCopilotSessions />);

      await act(async () => {
        fireEvent.click(screen.getByText("New course"));
      });

      expect(toastMock.error).toHaveBeenCalledWith(
        "You already have 2 active Course Copilot sessions. Archive one first.",
      );
      expect(navigateMock).not.toHaveBeenCalled();
    });

    it("falls back to generic copy when the server gave no message", async () => {
      createFn = rejects({ status: 500 });
      render(<CourseCopilotSessions />);

      await act(async () => {
        fireEvent.click(screen.getByText("New course"));
      });

      expect(toastMock.error).toHaveBeenCalledWith(en.courseCopilot.list.createFailed);
    });
  });
});
