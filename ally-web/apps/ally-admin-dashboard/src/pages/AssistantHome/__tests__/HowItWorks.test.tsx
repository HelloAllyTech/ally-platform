import React from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

/**
 * How it works, the History and Why this answer (chunk 20d-2): layers in the order they apply,
 * the owner's parts editable and the rest locked, the full text with the owner's parts marked;
 * Undo and Restore; and the "Topics to avoid" line only for a decline on that topic.
 */
const h = vi.hoisted(() => ({
  how: { current: null as unknown },
  history: { current: [] as unknown[] },
  revert: vi.fn(),
  undoChange: vi.fn(),
  save: vi.fn(),
}));
const unwrapped = (fn: (arg: unknown) => unknown) => (arg: unknown) => ({
  unwrap: () => Promise.resolve(fn(arg)),
});
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetHowItWorksQuery: () => ({ data: h.how.current, isLoading: false, isError: false }),
  useGetHistoryQuery: () => ({ data: h.history.current, isLoading: false }),
  useRevertEditMutation: () => [unwrapped(h.revert), { isLoading: false }],
  useUndoChangeMutation: () => [unwrapped(h.undoChange), { isLoading: false }],
  useSaveHomeFieldMutation: () => [unwrapped(h.save)],
  useGetAssistantHomeQuery: () => ({ data: null }),
}));
vi.mock("react-redux", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDispatch: () => vi.fn(),
}));

// eslint-disable-next-line import/first
import { ChangeHistory } from "../ChangeHistory";
// eslint-disable-next-line import/first
import { HOME } from "../copy";
// eslint-disable-next-line import/first
import { HowItWorksSection } from "../sections/HowItWorks";
// eslint-disable-next-line import/first
import { avoidedTopic } from "../TryIt";

const t = HOME.how;
const field = <T,>(value: T, version = "000000000000000a") => ({ value, version });

const HOME_VIEW = {
  canEdit: true,
  fields: {
    assistantName: field("Asha"),
    tone: field("warm"),
    instructions: field("Greet people by name."),
    avoidTopics: field(["prices"]),
  },
  safety: { pack: { industryLabel: "mental health practices" }, rules: [], version: "1" },
  facts: [],
} as never;

const props = (canEdit = true) =>
  ({ bot: { id: "b1" }, home: HOME_VIEW, canEdit, canManage: canEdit, go: vi.fn() }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  h.how.current = {
    full: '# Who you are\nYou are Asha.\nYour tone: warm.\n"""\nGreet people by name.\n"""\n# Safety\n- Never diagnose.\n\nBASE RULES',
    parts: [
      { layer: "business", text: "# Who you are\nYou are Asha.\n", owner: true },
      { layer: "tone", text: "Your tone: warm.\n", owner: true },
      { layer: "instructions", text: '"""\nGreet people by name.\n"""\n', owner: true },
      { layer: "safety", text: "# Safety\n- Never diagnose.\n\n", owner: false },
      { layer: "base", text: "BASE RULES", owner: false },
    ],
    placeholders: { question: "(the visitor's message)", passages: "" },
    search: { top_k: 8, max_passages: 5, min_similarity: 0.35, searches: 2, documents: 4 },
    purpose: null,
    safetyPack: "mental_health",
  };
});

describe("How it works", () => {
  it("lists the layers in the order they apply, the owner's marked as theirs", () => {
    render(<HowItWorksSection {...props()} />);
    const layers = screen.getAllByTestId(
      /^how-(base|safety|business|tone|instructions|avoid|search)$/,
    );
    expect(layers.map(l => l.dataset.testid)).toEqual([
      "how-base",
      "how-safety",
      "how-business",
      "how-tone",
      "how-instructions",
      "how-avoid",
      "how-search",
    ]);
    expect(screen.getByTestId("how-safety").textContent).toContain(t.locked);
    expect(screen.getByTestId("how-instructions").textContent).toContain(t.yours);
    expect(screen.getByTestId("how-search").textContent).toContain("from 4 documents");
  });

  it("shows a layer's exact text on request, and the whole text with the owner's parts marked", () => {
    render(<HowItWorksSection {...props()} />);
    const safety = screen.getByTestId("how-safety");
    fireEvent.click(safety.querySelector("button")!);
    expect(safety.querySelector("pre")!.textContent).toContain("Never diagnose.");
    fireEvent.click(screen.getByRole("button", { name: t.showFull }));
    const full = screen.getByTestId("how-full");
    const marked = [...full.querySelectorAll("mark")].map(m => m.textContent ?? "");
    expect(marked.some(text => text.includes("Greet people by name."))).toBe(true);
    expect(marked.some(text => text.includes("Never diagnose."))).toBe(false);
  });

  it("edits the owner's instructions in place, with a counter, and saves them", async () => {
    vi.useFakeTimers();
    h.save.mockReturnValue({ field: "instructions", value: "Be brief.", version: "b" });
    render(<HowItWorksSection {...props()} />);
    const box = screen.getByLabelText(t.instructionsLabel);
    fireEvent.change(box, { target: { value: "Be brief." } });
    expect(screen.getByText(/9 of 4000 characters/)).toBeTruthy();
    await act(async () => {
      fireEvent.blur(box);
    });
    expect(h.save).toHaveBeenCalledWith(
      expect.objectContaining({ field: "instructions", value: "Be brief." }),
    );
    vi.useRealTimers();
  });

  it("is read-only for a viewer", () => {
    render(<HowItWorksSection {...props(false)} />);
    expect(screen.getByLabelText(t.instructionsLabel)).toBeDisabled();
  });
});

describe("the History", () => {
  it("lists edits by hand and by chat, with Undo for the newest and Restore for older ones", async () => {
    h.history.current = [
      {
        id: "e2",
        at: new Date().toISOString(),
        kind: "edit",
        origin: "hand",
        who: "Asha",
        fields: [{ field: "introduction", before: "Hi.", after: "Hello." }],
        undone: false,
      },
      {
        id: "e1",
        at: new Date().toISOString(),
        kind: "edit",
        origin: "hand",
        who: "Asha",
        fields: [{ field: "introduction", before: "Hey.", after: "Hi." }],
        undone: false,
      },
    ];
    render(<ChangeHistory botId="b1" canEdit onChanged={vi.fn()} />);
    expect(screen.getAllByText(HOME.changeControls.byHand)).toHaveLength(2);
    const [undo, restore] = screen.getAllByRole("button");
    expect(undo.textContent).toBe(HOME.changeControls.undo);
    expect(restore.textContent).toBe(HOME.changeControls.restore);
    await act(async () => fireEvent.click(restore));
    expect(h.revert).toHaveBeenCalledWith({ id: "b1", eventId: "e1", to: "restore" });
  });
});

describe("Why this answer", () => {
  it("names a topic to avoid only when the question touches it", () => {
    expect(avoidedTopic("How much are your prices?", ["prices"])).toBe("prices");
    expect(avoidedTopic("What price is a session?", ["prices"])).toBe("prices");
    expect(avoidedTopic("What time do you open?", ["prices"])).toBeNull();
  });
});
