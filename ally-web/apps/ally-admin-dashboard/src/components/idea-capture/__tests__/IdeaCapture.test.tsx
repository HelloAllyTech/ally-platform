import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDraft: vi.fn(),
  transcribeClip: vi.fn(),
  track: vi.fn(),
  speechState: { status: "listening", transcribing: true },
  speech: {
    onFinal: (_text: string) => undefined as void,
    transcribe: (_clip: Blob) => Promise.resolve(""),
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    cancel: vi.fn(),
    finish: vi.fn(),
  },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@ally-ui-mono/ui-shared", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAnalytics: () => ({ track: mocks.track }),
  ANALYTICS_EVENTS: {
    IDEA_CAPTURE_SESSION_STARTED: "idea_capture_session_started",
    IDEA_CAPTURE_DRAFT_SAVED: "idea_capture_draft_saved",
    IDEA_CAPTURE_SESSION_ABANDONED: "idea_capture_session_abandoned",
  },
  ANALYTICS_PROPS: { CAPTURE_MODE: "capture_mode" },
}));
vi.mock("@hooks", () => ({
  useUser: () => ({
    permissions: ["vote:admin:product-roadmap"],
    features: ["product_roadmap", "product_planning_ideas"],
  }),
}));
vi.mock("@constants", () => ({
  FeatureToggleKey: {
    PRODUCT_ROADMAP: "product_roadmap",
    PRODUCT_PLANNING_IDEAS: "product_planning_ideas",
  },
  Permissions: { VOTE_PRODUCT_ROADMAP: "vote:admin:product-roadmap" },
  ROUTES: { PRODUCT_ROADMAP: "/product-roadmap" },
}));
vi.mock("@types", () => ({ IDEA_DRAFT_TEXT_MAX: 4000 }));
vi.mock("@utils", () => ({
  hasFeature: (features: string[] = [], key: string) => features.includes(key),
}));
vi.mock("@api", () => ({
  useCreateRoadmapIdeaDraftMutation: () => [mocks.createDraft, { isLoading: false }],
  useTranscribeRoadmapIdeaMutation: () => [mocks.transcribeClip],
}));
vi.mock("@hooks/useSpeechCapture", () => ({
  useSpeechCapture: (options: {
    onFinal: (t: string) => void;
    transcribe: (b: Blob) => Promise<string>;
  }) => {
    mocks.speech.onFinal = options.onFinal;
    mocks.speech.transcribe = options.transcribe;
    return {
      status: mocks.speechState.status,
      level: 0,
      transcribing: mocks.speechState.transcribing,
      start: mocks.speech.start,
      stop: mocks.speech.stop,
      pause: mocks.speech.pause,
      resume: mocks.speech.start,
      cancel: mocks.speech.cancel,
      finish: mocks.speech.finish,
      supported: true,
    };
  },
}));

import { IdeaCaptureLauncher } from "../IdeaCapture";

describe("IdeaCaptureLauncher", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.speechState.status = "listening";
    mocks.speechState.transcribing = true;
    mocks.createDraft.mockReturnValue({ unwrap: () => Promise.resolve({ id: "d1" }) });
  });

  it("starts the mic as it opens", () => {
    render(<IdeaCaptureLauncher />);
    fireEvent.click(screen.getByTestId("idea-capture-button"));
    expect(mocks.speech.start).toHaveBeenCalledTimes(1);
  });

  it("sends each recorded clip to the transcribe endpoint as multipart audio", async () => {
    mocks.transcribeClip.mockReturnValue({ unwrap: () => Promise.resolve({ text: "hello" }) });
    render(<IdeaCaptureLauncher />);
    fireEvent.click(screen.getByTestId("idea-capture-button"));

    const text = await mocks.speech.transcribe(new Blob(["a"], { type: "audio/mp4" }));

    expect(text).toBe("hello");
    const body = mocks.transcribeClip.mock.calls[0][0] as FormData;
    expect((body.get("audio") as File).name).toBe("idea.mp4");
  });

  it("Save waits for the last phrase to be transcribed and saves it", async () => {
    // The words only arrive while finish() is pending, as they would after a real Stop.
    mocks.speech.finish.mockImplementation(async () => {
      mocks.speech.onFinal("what if call notes wrote themselves");
    });
    render(<IdeaCaptureLauncher />);
    fireEvent.click(screen.getByTestId("idea-capture-button"));

    // Nothing on screen yet, but words are on their way, so Save is available.
    const save = screen.getByRole("button", { name: /Save to drafts/ });
    expect(save).not.toBeDisabled();
    await act(async () => fireEvent.click(save));

    expect(mocks.speech.stop).toHaveBeenCalled();
    expect(mocks.speech.finish).toHaveBeenCalled();
    expect(mocks.createDraft).toHaveBeenCalledWith({
      rawText: "what if call notes wrote themselves",
      captureMode: "voice",
    });
  });

  it.each(["listening", "paused", "idle", "unavailable"])(
    "has no Stop mic, Resume or Talk again buttons while the mic is %s",
    status => {
      mocks.speechState.status = status;
      render(<IdeaCaptureLauncher />);
      fireEvent.click(screen.getByTestId("idea-capture-button"));

      expect(screen.queryByRole("button", { name: /Stop mic/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /^Resume$/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Talk again/ })).toBeNull();
    },
  );

  it("leaves the orb as the mic control: it pauses while listening and resumes when paused", () => {
    const { unmount } = render(<IdeaCaptureLauncher />);
    fireEvent.click(screen.getByTestId("idea-capture-button"));
    fireEvent.click(screen.getByRole("button", { name: "Pause recording" }));
    expect(mocks.speech.pause).toHaveBeenCalledTimes(1);
    unmount();

    mocks.speechState.status = "paused";
    mocks.speech.start.mockClear();
    render(<IdeaCaptureLauncher />);
    fireEvent.click(screen.getByTestId("idea-capture-button"));
    mocks.speech.start.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Resume recording" }));
    expect(mocks.speech.start).toHaveBeenCalledTimes(1);
  });

  it("shows animated dots after the text, not the old static line, while transcribing", () => {
    localStorage.setItem("ally-admin-idea-capture-unsent", "call notes");
    render(<IdeaCaptureLauncher />);
    fireEvent.click(screen.getByTestId("idea-capture-button"));

    const dots = screen.getByTestId("idea-transcribing-dots");
    // The dots sit after the words, one space on, where the next phrase will land.
    expect(dots.textContent).toBe("call notes ...");
    expect(dots.querySelectorAll(".idea-dots > span")).toHaveLength(3);
    expect(screen.queryByText(/Writing down what you said/)).toBeNull();
  });

  it("hides the dots when nothing is being transcribed", () => {
    mocks.speechState.transcribing = false;
    render(<IdeaCaptureLauncher />);
    fireEvent.click(screen.getByTestId("idea-capture-button"));

    expect(screen.queryByTestId("idea-transcribing-dots")).toBeNull();
    expect(screen.queryByText(/Writing down what you said/)).toBeNull();
  });

  describe("analytics", () => {
    it("fires idea_capture_session_started when the overlay opens", () => {
      render(<IdeaCaptureLauncher />);
      fireEvent.click(screen.getByTestId("idea-capture-button"));
      expect(mocks.track).toHaveBeenCalledWith("idea_capture_session_started");
    });

    it("fires idea_capture_draft_saved with capture_mode once the save succeeds", async () => {
      mocks.speech.finish.mockImplementation(async () => {
        mocks.speech.onFinal("a dictated idea");
      });
      render(<IdeaCaptureLauncher />);
      fireEvent.click(screen.getByTestId("idea-capture-button"));
      await act(async () =>
        fireEvent.click(screen.getByRole("button", { name: /Save to drafts/ })),
      );

      expect(mocks.track).toHaveBeenCalledWith("idea_capture_draft_saved", {
        capture_mode: "voice",
      });
      expect(mocks.track).not.toHaveBeenCalledWith(
        "idea_capture_session_abandoned",
        expect.anything(),
      );
    });

    it("does not fire idea_capture_draft_saved when the save fails", async () => {
      mocks.createDraft.mockReturnValue({ unwrap: () => Promise.reject(new Error("nope")) });
      localStorage.setItem("ally-admin-idea-capture-unsent", "typed idea");
      mocks.speechState.transcribing = false;
      render(<IdeaCaptureLauncher />);
      fireEvent.click(screen.getByTestId("idea-capture-button"));
      await act(async () =>
        fireEvent.click(screen.getByRole("button", { name: /Save to drafts/ })),
      );

      expect(mocks.track).not.toHaveBeenCalledWith("idea_capture_draft_saved", expect.anything());
    });

    it("fires idea_capture_session_abandoned when closed with text and discarded", () => {
      localStorage.setItem("ally-admin-idea-capture-unsent", "half an idea");
      mocks.speechState.transcribing = false;
      render(<IdeaCaptureLauncher />);
      fireEvent.click(screen.getByTestId("idea-capture-button"));
      fireEvent.click(screen.getByRole("button", { name: "Close idea capture" }));
      fireEvent.click(screen.getByRole("button", { name: "Discard" }));

      expect(mocks.track).toHaveBeenCalledWith("idea_capture_session_abandoned", {
        capture_mode: "typed",
      });
    });

    it("does not fire idea_capture_session_abandoned when closed empty", () => {
      mocks.speechState.transcribing = false;
      render(<IdeaCaptureLauncher />);
      fireEvent.click(screen.getByTestId("idea-capture-button"));
      fireEvent.click(screen.getByRole("button", { name: "Close idea capture" }));

      expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
      expect(mocks.track).not.toHaveBeenCalledWith(
        "idea_capture_session_abandoned",
        expect.anything(),
      );
    });
  });
});
