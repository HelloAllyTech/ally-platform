import { StrictMode } from "react";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { en, LOCAL_STORAGE_KEYS } from "@constants";

vi.mock("@store", () => ({
  store: { dispatch: vi.fn(), getState: () => ({}), subscribe: vi.fn() },
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
  InlineLoading: ({ description }: any) => <div>{description}</div>,
  InlineNotification: ({ title }: any) => <div role="alert">{title}</div>,
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<any>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

let createFn: any;
vi.mock("@api", () => ({
  useCreateCourseCopilotSessionMutation: () => [createFn],
}));

// eslint-disable-next-line import/first
import { CourseCopilotNew } from "../CourseCopilotNew";

const resolves = (value: unknown) => vi.fn(() => ({ unwrap: () => Promise.resolve(value) }));
const rejects = (error: unknown) => vi.fn(() => ({ unwrap: () => Promise.reject(error) }));

const renderAt = (url: string, strict = false) => {
  const tree = (
    <MemoryRouter initialEntries={[url]}>
      <CourseCopilotNew />
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  createFn = resolves({ id: "sess-9" });
});

describe("CourseCopilotNew", () => {
  it("creates a fresh session with no course, then replaces itself with it", async () => {
    renderAt("/course-copilot/new");

    expect(screen.getByText(en.courseCopilot.start.starting)).toBeInTheDocument();
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith("/course-copilot/sess-9", { replace: true }),
    );
    expect(createFn).toHaveBeenCalledWith(undefined);
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.COURSE_COPILOT_SESSION_ID)).toBe("sess-9");
  });

  // "Ask Copilot" on a saved course: the session is bound to it (EDIT mode).
  it("binds the session to the course in ?trackId=", async () => {
    renderAt("/course-copilot/new?trackId=track-42");

    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    expect(createFn).toHaveBeenCalledWith({ trackId: "track-42" });
  });

  // Back from the session must not land here and mint another one.
  it("replaces its history entry rather than pushing", async () => {
    renderAt("/course-copilot/new");
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    expect(navigateMock.mock.calls[0][1]).toEqual({ replace: true });
  });

  // StrictMode runs effects twice in dev; a second POST would count against the 2-session cap.
  it("creates exactly one session even when effects run twice", async () => {
    renderAt("/course-copilot/new", true);
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    expect(createFn).toHaveBeenCalledTimes(1);
  });

  it("shows the server's cap message and a way back, with no pointless retry (409)", async () => {
    createFn = rejects({
      status: 409,
      data: { message: "You already have 2 active Course Copilot sessions. Archive one first." },
    });
    renderAt("/course-copilot/new");

    expect(
      await screen.findByText(
        "You already have 2 active Course Copilot sessions. Archive one first.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(en.courseCopilot.chat.retry)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(en.courseCopilot.start.backToList));
    expect(navigateMock).toHaveBeenCalledWith("/course-copilot");
    expect(navigateMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/course-copilot/sess"),
      expect.anything(),
    );
  });

  it("explains the cap in its own words when the 409 carries no message", async () => {
    createFn = rejects({ status: 409 });
    renderAt("/course-copilot/new");

    expect(await screen.findByText(en.courseCopilot.start.capReached)).toBeInTheDocument();
  });

  it("falls back to generic copy for a failure with no message, and offers a retry", async () => {
    createFn = rejects({ status: 500 });
    renderAt("/course-copilot/new");

    expect(await screen.findByText(en.courseCopilot.start.failed)).toBeInTheDocument();

    createFn.mockImplementationOnce(() => ({ unwrap: () => Promise.resolve({ id: "sess-10" }) }));
    await act(async () => {
      fireEvent.click(screen.getByText(en.courseCopilot.chat.retry));
    });

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith("/course-copilot/sess-10", { replace: true }),
    );
    expect(createFn).toHaveBeenCalledTimes(2);
  });
});
