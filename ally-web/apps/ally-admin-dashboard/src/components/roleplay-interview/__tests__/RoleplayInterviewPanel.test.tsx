import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";

const mocks = vi.hoisted(() => ({
  session: {
    id: "s1",
    status: "PLAN_READY",
    brief: { learners: { who: "Teachers" }, mode: "learning" },
    stillNeeded: [] as string[],
    plan: null as any,
    planVersion: 0,
    scenarioId: null,
  },
  approve: vi.fn(),
  play: vi.fn(),
  messages: [] as any[],
  send: vi.fn(),
}));

vi.mock("@store", () => ({
  store: { dispatch: vi.fn(), getState: () => ({}), subscribe: vi.fn() },
}));
vi.mock("@api", () => ({
  useOpenRoleplayInterviewMutation: () => [
    () => ({ unwrap: () => Promise.resolve(mocks.session) }),
  ],
  useGetRoleplayInterviewMutation: () => [
    () => ({ unwrap: () => Promise.resolve({ session: mocks.session, messages: [] }) }),
  ],
  useApproveRoleplayInterviewMutation: () => [mocks.approve, { isLoading: false }],
  useLinkRoleplayInterviewMutation: () => [vi.fn()],
  useAbandonRoleplayInterviewMutation: () => [vi.fn()],
  useGetAvailableLanguageVoicesQuery: () => ({
    data: [
      {
        language_id: 1,
        value: "en-IN",
        label: "English (India)",
        voices: [{ id: "v-en", name: "Anushka", gender: "female" }],
      },
      {
        language_id: 2,
        value: "hi-IN",
        label: "Hindi (India)",
        voices: [{ id: "v-hi", name: "Raju" }],
      },
    ],
  }),
}));
vi.mock("@hooks/useVoicePreview", () => ({
  useVoicePreview: () => ({
    playingVoiceId: null,
    isLoading: false,
    play: mocks.play,
    pause: vi.fn(),
  }),
}));
vi.mock("../../../hooks/useRoleplayInterviewStream", () => ({
  useRoleplayInterviewStream: () => ({
    messages: mocks.messages,
    isStreaming: false,
    send: mocks.send,
    stop: vi.fn(),
    hydrate: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock("../../agent-chat", () => ({
  ChatMessage: () => null,
  AgentReceipt: () => null,
  ChatComposer: () => <div>composer</div>,
}));

// eslint-disable-next-line import/first
import { RoleplayInterviewPanel } from "../RoleplayInterviewPanel";

const plan = {
  version: 1,
  title: "Aarav: a quiet worry",
  characterSheet: { name: "Aarav", summary: "15", hides: "x", opensUpWhen: "y", speaks: "z" },
  moments: ["Mentions the notebook"],
  states: [{ name: "Guarded", guidelines: "Short answers" }],
  passCriteria: { helpful: ["Asks directly"], unhelpful: ["Lectures"], minScore: 50 },
  openingLine: "Leave me alone.",
  supports: { remindersEnabled: true },
};

beforeEach(() => {
  mocks.messages = [];
  mocks.send.mockReset();
  mocks.session.plan = null;
  mocks.session.status = "INTERVIEWING";
  mocks.approve.mockReset();
});

const renderPanel = async (onApproved = vi.fn()) => {
  await act(async () => {
    render(<RoleplayInterviewPanel onApproved={onApproved} />);
  });
  return onApproved;
};

describe("RoleplayInterviewPanel tabs", () => {
  const tabs = en.roleplayInterview.tabs;

  it("opens on Build (the chat) and shows the brief under Brief", async () => {
    await renderPanel();
    expect(screen.getByRole("tab", { name: tabs.build }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByText("composer")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(tabs.brief) }));
    expect(screen.getByTestId("roleplay-brief")).toBeTruthy();
    expect(screen.getByText(tabs.noPlanYet)).toBeTruthy();
  });

  it("moves between tabs with the arrow keys", async () => {
    await renderPanel();
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(screen.getByTestId("roleplay-brief")).toBeTruthy();
  });

  it("points from the chat to the plan, and approves from either tab", async () => {
    mocks.session.plan = plan;
    mocks.session.planVersion = 1;
    mocks.session.status = "PLAN_READY";
    mocks.approve.mockReturnValue({
      unwrap: () =>
        Promise.resolve({
          session: { ...mocks.session, status: "APPROVED" },
          generation: { mode: "learning" },
        }),
    });
    const onApproved = await renderPanel();
    expect(screen.getByTestId("plan-notice").textContent).toContain(plan.title);
    fireEvent.click(screen.getByText(tabs.reviewPlan));
    expect(screen.getByTestId("roleplay-plan")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText(en.roleplayInterview.plan.approve));
    });
    expect(mocks.approve).toHaveBeenCalledWith({ id: "s1", planVersion: 1 });
    expect(onApproved).toHaveBeenCalledWith({ mode: "learning" }, "s1", {});
  });
});

describe("RoleplayInterviewPanel languages and voices", () => {
  it("starts from the agent's languages and hands the trainer's voices to the build", async () => {
    (mocks.session.brief as any).languages = [
      { languageId: "1", label: "English (India)", code: "en-IN" },
    ];
    mocks.session.plan = plan;
    mocks.session.planVersion = 1;
    mocks.session.status = "PLAN_READY";
    mocks.approve.mockReturnValue({
      unwrap: () => Promise.resolve({ session: mocks.session, generation: { mode: "learning" } }),
    });
    const onApproved = vi.fn();
    await act(async () => {
      render(<RoleplayInterviewPanel onApproved={onApproved} />);
    });
    fireEvent.click(screen.getByRole("tab", { name: /Brief/ }));
    expect((screen.getByLabelText("English (India)") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText("Hindi (India)"));
    fireEvent.change(screen.getByLabelText(en.roleplayInterview.voices.voiceFor("Hindi (India)")), {
      target: { value: "v-hi" },
    });
    fireEvent.click(screen.getByText(en.roleplayInterview.voices.play));
    expect(mocks.play).toHaveBeenCalledWith("v-hi");
    await act(async () => {
      fireEvent.click(screen.getByText(en.roleplayInterview.plan.approve));
    });
    expect(onApproved).toHaveBeenCalledWith({ mode: "learning" }, "s1", { "1": "", "2": "v-hi" });
    delete (mocks.session.brief as any).languages;
  });
});

describe("RoleplayInterviewPanel: the agent asks for languages and voices", () => {
  it("draws the language question as the picker and answers it with the languages", async () => {
    mocks.messages = [
      {
        id: "m1",
        role: "assistant",
        content: "Choose the languages the client speaks and a voice for each",
        question: {
          id: "q-lang",
          prompt: "Choose the languages the client speaks and a voice for each",
          kind: "multiSelect",
          field: "languageIds",
          options: [
            { id: "en", label: "English (India)", value: "1" },
            { id: "hi", label: "Hindi (India)", value: "2", recommended: true },
          ],
        },
      },
    ];
    await act(async () => {
      render(<RoleplayInterviewPanel onApproved={vi.fn()} />);
    });
    const card = screen.getByTestId("language-voice-question");
    // The recommended language starts ticked.
    expect((screen.getByLabelText("Hindi (India)") as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText(en.roleplayInterview.voices.voiceFor("Hindi (India)")), {
      target: { value: "v-hi" },
    });
    fireEvent.click(screen.getByText(en.roleplayInterview.voices.confirm));
    expect(card).toBeTruthy();
    expect(mocks.send).toHaveBeenCalledWith("Hindi (India)", {
      questionId: "q-lang",
      answer: { selectedOptionIds: ["hi"] },
    });
    // The voice is kept for the build: the Brief tab shows the same choice.
    fireEvent.click(screen.getByRole("tab", { name: /Brief/ }));
    expect(
      (
        screen
          .getAllByLabelText(en.roleplayInterview.voices.voiceFor("Hindi (India)"))
          .at(-1) as HTMLSelectElement
      ).value,
    ).toBe("v-hi");
  });
});
