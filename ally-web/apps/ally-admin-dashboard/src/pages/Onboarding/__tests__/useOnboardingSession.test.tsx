import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BotDraftView } from "../types";
import { useOnboardingSession } from "../useOnboardingSession";

/**
 * The session's decisions, without a screen: what the restyle must keep. The draft and its stream
 * (`useBotDraftSession`) and the API are faked.
 */
const send = vi.fn();
const stop = vi.fn();
const setView = vi.fn();
let session: Record<string, unknown>;
const patch = vi.fn();
const publish = vi.fn();

vi.mock("../useBotDraftSession", () => ({ useBotDraftSession: () => session }));
vi.mock("@api", () => ({
  usePatchBotDraftMutation: () => [patch],
  useBackBotDraftMutation: () => [vi.fn()],
  usePublishBotDraftMutation: () => [publish, { isLoading: false }],
  useGetBotPageQuery: () => ({ data: { publicAllowed: false } }),
  useDescribeBotDraftMutation: () => [vi.fn()],
  useArchiveChatbotMutation: () => [vi.fn()],
  useAddBotDraftDocumentMutation: () => [vi.fn()],
  useCreateChatbotDocumentUploadUrlMutation: () => [vi.fn()],
  useCreatePrivateChatbotDocumentMutation: () => [vi.fn()],
}));
vi.mock("@constants", () => ({}));

const view = (over: Partial<BotDraftView> = {}): BotDraftView =>
  ({
    id: "d1",
    status: "active",
    step: "learned",
    version: 3,
    chatbotId: "b1",
    source: { website: "https://sunrise.example/", description: null },
    learned: { facts: [], dropped: 0 },
    safety: null,
    conversation: { pending: "", gaps: null, questionsLeft: 4 },
    designs: null,
    draft: { design: null },
    transcript: [
      { id: "1", role: "builder", text: "Hi", chips: ["Use my website"], at: "" },
      { id: "2", role: "owner", text: "sunrise.example", at: "" },
      { id: "3", role: "builder", text: "I've read 4 pages.", chips: ["Looks right"], at: "" },
      { id: "4", role: "note", text: "Updated your hours", at: "" },
    ],
    ...over,
  }) as BotDraftView;

const use = (v: BotDraftView | null, over: Record<string, unknown> = {}) => {
  session = {
    view: v,
    reading: { domain: null, read: 0, findings: [], done: null, startedAt: null },
    working: null,
    streaming: "",
    sending: false,
    error: null,
    canvasVersion: 0,
    send,
    stop,
    reload: vi.fn(),
    setView,
    ...over,
  };
  return renderHook(() => useOnboardingSession("d1", vi.fn())).result.current;
};

beforeEach(() => vi.clearAllMocks());

describe("useOnboardingSession", () => {
  it("draws the chat as rows, with quick replies only on the latest builder message", () => {
    const s = use(view());
    expect(s.rows.map(r => [r.from, r.chips])).toEqual([
      ["builder", []],
      ["owner", []],
      ["builder", ["Looks right"]],
    ]);
    expect(s.note?.text).toBe("Updated your hours");
  });

  it("hides quick replies while the builder works", () => {
    expect(use(view(), { sending: true }).rows[2].chips).toEqual([]);
  });

  it.each([
    ["learned", ["reading", "learned"]],
    ["design", ["reading", "learned"]],
    ["share", ["reading", "learned", "building", "assistant", "share"]],
  ] as const)("shows the canvas sections a %s draft has reached", (step, sections) => {
    expect(use(view({ step })).sections).toEqual(sections);
  });

  it("adds the safety card once the pack is on, and the designs once offered", () => {
    const s = use(
      view({
        step: "design",
        safety: { on: true } as BotDraftView["safety"],
        designs: [],
      }),
    );
    expect(s.sections).toEqual(["reading", "learned", "safety", "designs"]);
    expect(s.canChooseDesign).toBe(true);
    expect(s.focusSection).toBe("designs");
  });

  it("counts questions left only while asking them", () => {
    expect(use(view({ step: "gaps" })).questionsLeft).toBe(4);
    expect(use(view({ step: "learned" })).questionsLeft).toBeNull();
  });

  it("offers Back once past what we learned, never while working or once live", () => {
    expect(use(view({ step: "learned" })).canGoBack).toBe(false);
    expect(use(view({ step: "gaps" })).canGoBack).toBe(true);
    expect(use(view({ step: "gaps" }), { sending: true }).canGoBack).toBe(false);
    expect(use(view({ step: "published" })).canGoBack).toBe(false);
  });

  it("sends what the owner chose, a design by its title", () => {
    const s = use(view({ step: "design" }));
    act(() => s.confirmLearned());
    expect(send).toHaveBeenCalledWith({ chip: "Looks right" });
    act(() =>
      s.chooseDesign({
        id: "guide",
        title: "Client guide",
        best_for: "",
        will: [],
        wont: [],
        sample: [],
      }),
    );
    expect(send).toHaveBeenCalledWith({ chip: "design:guide" }, "Client guide");
    act(() => s.stop());
    expect(stop).toHaveBeenCalled();
  });

  it("an edit goes up with the draft's version, and a refusal is said and undone", async () => {
    const onError = vi.fn();
    session = { ...session, view: view() };
    patch.mockReturnValueOnce({ unwrap: () => Promise.reject({ data: { message: "Nope" } }) });
    const { result } = renderHook(() => useOnboardingSession("d1", onError));
    let ok = true;
    await act(async () => {
      ok = await result.current.edit("learned", [{ op: "remove", path: "/facts/0" }]);
    });
    expect(patch).toHaveBeenCalledWith({
      id: "d1",
      target: "learned",
      ops: [{ op: "remove", path: "/facts/0" }],
      version: 3,
    });
    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledWith("Nope");
  });

  it("knows public links are off for now", () => {
    expect(use(view()).publicAllowed).toBe(false);
  });
});
