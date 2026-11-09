import React from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssistantHomeView, Chatbot } from "@types";

/**
 * The assistant home's fields (chunk 20d): each saves on its own with the version it started from;
 * a save refused because another tab changed the field shows their value and the server's words;
 * a viewer can't change anything.
 */
const save = vi.fn();
const changeRule = vi.fn();
vi.mock("@api", () => ({
  useSaveHomeFieldMutation: () => [save],
  useChangeOwnRuleMutation: () => [changeRule, { isLoading: false }],
  chatbotsApi: { util: { updateQueryData: vi.fn(() => ({ type: "patched" })) } },
}));
vi.mock("react-redux", () => ({ useDispatch: () => vi.fn() }));
vi.mock("../../WhatsAppBot/TemplatesTab", () => ({ TemplatesTab: () => null }));

const { PersonalitySection } = await import("../sections/Personality");
const { SafetySection } = await import("../sections/Safety");
const { FIELD_SAVE_DEBOUNCE_MS } = await import("../useHomeField");

const field = <T,>(value: T, version: string) => ({ value, version });

const HOME_VIEW = {
  canEdit: true,
  fields: {
    name: field("Sunrise Mind", "0000000000000001"),
    assistantName: field("Asha", "0000000000000002"),
    introduction: field("Hi.", "0000000000000003"),
    tone: field("warm", "0000000000000004"),
    instructions: field("", "0000000000000005"),
    declineText: field("", "0000000000000006"),
    disclaimer: field("Not a crisis service.", "0000000000000007"),
    crisisText: field("", "0000000000000008"),
    suggestedQuestions: field(["What are your fees?"], "0000000000000009"),
    prechat: field([], "000000000000000a"),
    pageLimits: field(
      { messagesPerVisitorPerHour: 30, maxMessageChars: 1000, dailyCapPerBot: 500 },
      "000000000000000b",
    ),
    language: field("auto", "000000000000000c"),
    busyText: field("", "000000000000000d"),
    unknownNumberText: field("", "000000000000000e"),
    unsupportedMediaText: field("", "000000000000000f"),
    pageStatus: field("on", "0000000000000010"),
    pageAccess: field("invite", "0000000000000011"),
  },
  safety: {
    pack: {
      id: "mental_health",
      name: "Mental health safety",
      industryLabel: "mental health practices",
      always: ["Be kind"],
      never: ["Diagnose"],
      atRisk: ["Share the crisis line"],
    },
    rules: [
      { id: "pack-0", text: "Diagnose", fixed: true },
      { id: "own-0", text: "Quote group prices", fixed: false },
    ],
    version: "0000000000000020",
  },
  facts: [],
} as unknown as AssistantHomeView;

const BOT = { id: "bot-1", connectors: [] } as unknown as Chatbot;
const props = (canEdit = true) => ({
  bot: BOT,
  home: HOME_VIEW,
  canEdit,
  canManage: canEdit,
  go: vi.fn(),
});
const resolves = (value: unknown) => ({ unwrap: () => Promise.resolve(value) });
const rejects = (data: unknown) => ({ unwrap: () => Promise.reject({ status: 409, data }) });

beforeEach(() => {
  vi.useFakeTimers();
  save.mockReset();
  changeRule.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("a field", () => {
  it("saves after a pause, with the version it started from", async () => {
    save.mockReturnValue(
      resolves({ field: "assistantName", value: "Meera", version: "1".repeat(16) }),
    );
    render(<PersonalitySection {...props()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Meera" } });
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(FIELD_SAVE_DEBOUNCE_MS);
    });
    expect(save).toHaveBeenCalledWith({
      id: "bot-1",
      field: "assistantName",
      value: "Meera",
      version: "0000000000000002",
    });
  });

  it("saves at once when it loses focus, and only its own field", async () => {
    save.mockReturnValue(
      resolves({ field: "introduction", value: "Hello.", version: "1".repeat(16) }),
    );
    render(<PersonalitySection {...props()} />);
    const intro = screen.getByLabelText("Introduction");
    fireEvent.change(intro, { target: { value: "Hello." } });
    await act(async () => {
      fireEvent.blur(intro);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({ field: "introduction", value: "Hello." });
  });

  it("changed in another tab: shows that tab's value and says so", async () => {
    save.mockReturnValue(
      rejects({
        errorCode: "stale",
        message: "This changed while you were editing. Here is what it says now.",
        details: { field: "assistantName", value: "Ravi", version: "2".repeat(16) },
      }),
    );
    render(<PersonalitySection {...props()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Meera" } });
    await act(async () => {
      vi.advanceTimersByTime(FIELD_SAVE_DEBOUNCE_MS);
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "This changed while you were editing. Here is what it says now.",
    );
  });

  it("is read-only for a viewer", () => {
    render(<PersonalitySection {...props(false)} />);
    expect((screen.getByLabelText("Name") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText("Add a question")).toBeNull();
  });
});

describe("own safety rules", () => {
  it("adds a rule with the list's version, and offers no edit for a pack rule", async () => {
    changeRule.mockReturnValue(resolves({}));
    render(<SafetySection {...props()} />);
    expect(screen.queryByLabelText("Edit: Diagnose")).toBeNull();
    expect(screen.getByLabelText("Edit: Quote group prices")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Never…"), {
      target: { value: "Discuss other clinics" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add a rule" }));
    });
    expect(changeRule).toHaveBeenCalledWith({
      id: "bot-1",
      version: "0000000000000020",
      op: "add",
      text: "Discuss other clinics",
    });
  });
});
