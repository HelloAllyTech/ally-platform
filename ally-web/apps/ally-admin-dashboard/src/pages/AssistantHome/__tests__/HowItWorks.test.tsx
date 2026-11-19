import React from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

/**
 * How it works, the History and Why this answer (chunk 20d-2): layers in the order they apply,
 * the owner's parts editable with their exact text, Ally's as summaries with no text; the tools;
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
    parts: [
      { layer: "business", text: "# Who you are\nYou are Asha.\n", owner: true },
      { layer: "tone", text: "Your tone: warm.\n", owner: true },
      { layer: "instructions", text: '"""\nGreet people by name.\n"""\n', owner: true },
      // Ally's layers arrive with no text (17 Nov 2026).
      { layer: "safety", text: "", owner: false },
      { layer: "base", text: "", owner: false },
    ],
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

  it("shows the owner's exact text on request; Ally's layers are summaries with no text", () => {
    render(<HowItWorksSection {...props()} />);
    const mine = screen.getByTestId("how-instructions");
    fireEvent.click(screen.getAllByRole("button", { name: t.showText })[0]);
    expect(document.querySelector("pre")!.textContent).toContain("You are Asha.");
    for (const layer of ["how-safety", "how-base"]) {
      const card = screen.getByTestId(layer);
      expect(card.textContent).toContain(t.byAlly);
      expect(card.textContent).not.toContain(t.showText);
    }
    expect(mine.textContent).toContain(t.showText);
    // No whole-prompt view any more.
    expect(screen.queryByText(/full instructions/)).toBeNull();
  });

  it("lists what it can do with each list under How it finds answers", () => {
    (h.how.current as { tools: unknown }).tools = [
      { list: "Leads", can: ["find", "create", "update"] },
      { list: "Menu", can: ["find"] },
    ];
    render(<HowItWorksSection {...props()} />);
    const tools = screen.getByTestId("how-tools");
    expect(tools.textContent).toContain("Leads: look up, add and change entries.");
    expect(tools.textContent).toContain("Menu: look up entries.");
  });

  it("says in one sentence what each list's playbook makes the assistant do (Q3-fast 2b)", () => {
    (h.how.current as { tools: unknown; playbooks: unknown }).tools = [
      { list: "Appointments", can: ["find", "create"] },
    ];
    (h.how.current as { playbooks: unknown }).playbooks = [
      { list: "Appointments", kind: "booking" },
    ];
    render(<HowItWorksSection {...props()} />);
    const lines = screen.getAllByTestId("how-playbook");
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe(
      "Because you added Appointments, your assistant finds free times, confirms the exact time and books it.",
    );
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

  it("says the purpose's honest limit from what the assistant may do now (chunk 5b)", () => {
    const how = h.how.current as {
      parts: unknown[];
      purpose: string | null;
      bookingLists?: string[];
    };
    how.parts.splice(2, 0, { layer: "purpose", text: "Bring in customers.\n", owner: false });
    how.purpose = "enquiries";
    how.bookingLists = [];
    const { unmount } = render(<HowItWorksSection {...props()} />);
    expect(screen.getByTestId("purpose-limit").textContent).toContain(
      "It can't take payments yet. It sends you each new enquiry by email, and books when you add an Appointments list.",
    );
    unmount();
    how.bookingLists = ["Appointments"];
    render(<HowItWorksSection {...props()} />);
    expect(screen.getByTestId("purpose-limit").textContent).toContain(
      "It books into your Appointments list. It can't take payments yet.",
    );
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
