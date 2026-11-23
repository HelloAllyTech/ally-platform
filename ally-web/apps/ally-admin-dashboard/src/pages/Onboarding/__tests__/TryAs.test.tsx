import React from "react";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({ run: vi.fn(), cancel: vi.fn(), fallback: vi.fn(), likely: vi.fn() }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTestBotDraftMutation: () => [h.fallback],
  useRunLikelyBotDraftMutation: () => [h.likely],
}));
vi.mock("@hooks/useChatbotTestStream", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useChatbotTestStream: () => ({ run: h.run, cancel: h.cancel }),
}));

// eslint-disable-next-line import/first
import { SPLIT_COPY } from "../copy";
// eslint-disable-next-line import/first
import { DraftTestPane } from "../DraftTestPane";
// eslint-disable-next-line import/first
import { PERSONA_SCRIPTS } from "../personaScripts";

const T = SPLIT_COPY.pane;
const Y = SPLIT_COPY.tryAs;

const view = {
  id: "d1",
  status: "active",
  version: 1,
  chatbotId: "b1",
  draft: { assistantName: "Sunny", introduction: "Hi", suggestedQuestions: [] },
} as never;

const reply = (text: string) => ({
  reply: text,
  handledBy: "rag",
  citations: [],
  latencyMs: 100,
  conversationId: "preview-1",
  preview: { pendingDocuments: 0 },
});

const play = (label: string) => {
  fireEvent.click(screen.getByRole("button", { name: Y.button }));
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}`) }));
};

beforeEach(() => {
  h.run.mockReset();
  h.cancel.mockReset();
  h.fallback.mockReset();
  h.likely.mockReset();
});

describe("persona scripts file", () => {
  it("is plain data: six personas with an id, label, hint and at least one turn", () => {
    expect(PERSONA_SCRIPTS.map(p => p.label)).toEqual([
      "New visitor",
      "Returning visitor",
      "Another language",
      "Upset customer",
      "Young person",
      "Someone in crisis",
    ]);
    expect(new Set(PERSONA_SCRIPTS.map(p => p.id)).size).toBe(6);
    PERSONA_SCRIPTS.forEach(p => {
      expect(Object.keys(p).sort()).toEqual(["hint", "id", "label", "turns"]);
      expect(p.turns.length).toBeGreaterThan(0);
      p.turns.forEach(turn => expect(typeof turn).toBe("string"));
    });
    expect(PERSONA_SCRIPTS.find(p => p.id === "returning_visitor")!.turns).toHaveLength(2);
  });
});

describe("Try as", () => {
  it("lists the six personas in a menu", () => {
    render(<DraftTestPane draftId="d1" view={view} />);
    fireEvent.click(screen.getByRole("button", { name: Y.button }));
    const menu = screen.getByRole("list", { name: Y.menuLabel });
    expect(within(menu).getAllByRole("button")).toHaveLength(6);
  });

  it("plays the turns in order into a new chat, each after the previous reply", async () => {
    let finishFirst: (r: unknown) => void = () => undefined;
    render(<DraftTestPane draftId="d1" view={view} />);
    // An earlier chat is cleared: the persona's first message carries no history.
    h.run.mockResolvedValueOnce(reply("Old reply."));
    h.run.mockImplementationOnce(() => new Promise(resolve => (finishFirst = resolve)));
    h.run.mockResolvedValueOnce(reply("Sure, carry on."));
    fireEvent.change(screen.getByLabelText(T.inputLabel), {
      target: { value: "Earlier question" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: T.send }));
    });
    await screen.findByText("Old reply.");

    play("Returning visitor");
    const script = PERSONA_SCRIPTS.find(p => p.id === "returning_visitor")!;
    await waitFor(() => expect(h.run).toHaveBeenCalledTimes(2));
    expect(screen.getByText(`Playing: Returning visitor`)).toBeTruthy();
    expect(screen.queryByText("Earlier question")).toBeNull();
    expect(h.run.mock.calls[1][0]).toMatchObject({
      message: script.turns[0],
      history: [],
      conversationId: undefined,
    });
    // The second turn waits for the first reply.
    expect(h.run).toHaveBeenCalledTimes(2);
    await act(async () => finishFirst(reply("Welcome back.")));
    await waitFor(() => expect(h.run).toHaveBeenCalledTimes(3));
    expect(h.run.mock.calls[2][0]).toMatchObject({
      message: script.turns[1],
      history: [
        { role: "user", content: script.turns[0] },
        { role: "assistant", content: "Welcome back." },
      ],
    });
    await screen.findByText("Sure, carry on.");
    await waitFor(() => expect(screen.queryByText(/^Playing:/)).toBeNull());
  });

  it("sends the crisis script exactly as written and shows only what the runtime answers", async () => {
    h.run.mockResolvedValueOnce(reply("Runtime answer for this person."));
    render(<DraftTestPane draftId="d1" view={view} />);
    play("Someone in crisis");
    await screen.findByText("Runtime answer for this person.");
    const crisis = PERSONA_SCRIPTS.find(p => p.id === "crisis")!;
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.run.mock.calls[0][0].message).toBe(crisis.turns[0]);
    const transcript = screen.getByTestId("draft-test-transcript");
    const texts = Array.from(transcript.querySelectorAll(".ally-dt__msg > p")).map(
      p => p.textContent,
    );
    expect(texts).toEqual([crisis.turns[0], "Runtime answer for this person."]);
  });

  it("Stop cancels the turns that have not been sent yet", async () => {
    let finishFirst: (r: unknown) => void = () => undefined;
    h.run.mockImplementationOnce(() => new Promise(resolve => (finishFirst = resolve)));
    render(<DraftTestPane draftId="d1" view={view} />);
    play("Returning visitor");
    await waitFor(() => expect(h.run).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: Y.stop }));
    expect(screen.queryByText(/^Playing:/)).toBeNull();
    await act(async () => finishFirst(reply("Hello.")));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it("stops playing when a turn fails", async () => {
    h.run.mockRejectedValueOnce(new Error("boom"));
    render(<DraftTestPane draftId="d1" view={view} />);
    play("Returning visitor");
    await screen.findByText(T.failed);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/^Playing:/)).toBeNull();
  });
});
