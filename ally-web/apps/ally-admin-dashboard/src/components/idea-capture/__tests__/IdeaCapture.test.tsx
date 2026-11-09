import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDraft: vi.fn(),
  transcribeClip: vi.fn(),
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
}));
vi.mock("@hooks", () => ({
  useUser: () => ({
    permissions: ["vote:admin:product-roadmap"],
    features: ["product_roadmap"],
  }),
}));
vi.mock("@constants", () => ({
  FeatureToggleKey: { PRODUCT_ROADMAP: "product_roadmap" },
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
      status: "listening",
      level: 0,
      transcribing: true,
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
});
