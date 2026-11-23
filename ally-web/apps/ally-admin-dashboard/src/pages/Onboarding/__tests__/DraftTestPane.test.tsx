import React from "react";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({ run: vi.fn(), cancel: vi.fn(), fallback: vi.fn() }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTestBotDraftMutation: () => [h.fallback],
}));
vi.mock("@hooks/useChatbotTestStream", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useChatbotTestStream: () => ({ run: h.run, cancel: h.cancel }),
}));

// eslint-disable-next-line import/first
import { ChatbotTestStreamUnavailable } from "@hooks/useChatbotTestStream";

// eslint-disable-next-line import/first
import { SPLIT_COPY } from "../copy";
// eslint-disable-next-line import/first
import { BUILD_COPY } from "../create/copy";
// eslint-disable-next-line import/first
import { DraftTestPane } from "../DraftTestPane";

const T = SPLIT_COPY.pane;

const view = (over: Record<string, unknown> = {}) =>
  ({
    id: "d1",
    status: "active",
    version: 1,
    chatbotId: "b1",
    draft: {
      assistantName: "Sunny",
      introduction: "Hello, ask me anything.",
      suggestedQuestions: ["What are your fees?", "How do I book?"],
    },
    ...over,
  }) as never;

const reply = (text: string, over: Record<string, unknown> = {}) => ({
  reply: text,
  handledBy: "rag",
  citations: [{ passage_number: 1, document_title: "Fees", page_from: 1, section_path: "Prices" }],
  latencyMs: 2400,
  conversationId: "preview-1",
  preview: { pendingDocuments: 0 },
  ...over,
});

const ask = async (text: string) => {
  fireEvent.change(screen.getByLabelText(T.inputLabel), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: T.send }));
  });
};

beforeEach(() => {
  h.run.mockReset();
  h.cancel.mockReset();
  h.fallback.mockReset();
});

describe("DraftTestPane", () => {
  it("is a quiet placeholder until the assistant exists and the draft is active", () => {
    const { rerender } = render(<DraftTestPane draftId="d1" view={view({ chatbotId: null })} />);
    expect(screen.getByText(T.placeholder)).toBeTruthy();
    expect(screen.queryByLabelText(T.inputLabel)).toBeNull();
    rerender(<DraftTestPane draftId="d1" view={view({ status: "published" })} />);
    expect(screen.getByText(T.placeholder)).toBeTruthy();
  });

  it("offers the suggested questions until something is asked", async () => {
    h.run.mockResolvedValue(reply("Ten dollars."));
    render(<DraftTestPane draftId="d1" view={view()} />);
    fireEvent.click(screen.getByRole("button", { name: "What are your fees?" }));
    await screen.findByText("Ten dollars.");
    expect(screen.queryByRole("button", { name: "How do I book?" })).toBeNull();
    expect(h.run.mock.calls[0][0]).toMatchObject({ id: "d1", message: "What are your fees?" });
  });

  it("shows the question at once, streams the reply in, and sends the history", async () => {
    let finish: (r: unknown) => void = () => undefined;
    h.run.mockImplementationOnce(
      (_req, handlers) =>
        new Promise(resolve => {
          finish = resolve;
          handlers.onStatus({ code: "searching", label: "x" });
          handlers.onToken("Part");
        }),
    );
    render(<DraftTestPane draftId="d1" view={view()} />);
    await ask("Where are you?");
    // The question is there before any reply, with the reply being written under it.
    expect(screen.getByText("Where are you?")).toBeTruthy();
    expect(await screen.findByText("Part")).toBeTruthy();
    expect(screen.getByText(T.status.searching)).toBeTruthy();
    expect((screen.getByLabelText(T.inputLabel) as HTMLInputElement).disabled).toBe(true);
    await act(async () => finish(reply("In town.")));
    expect(await screen.findByText("In town.")).toBeTruthy();
    expect(screen.queryByTestId("draft-test-pending")).toBeNull();

    h.run.mockResolvedValueOnce(reply("Sure."));
    await ask("And the hours?");
    await screen.findByText("Sure.");
    expect(h.run.mock.calls[1][0].history).toEqual([
      { role: "user", content: "Where are you?" },
      { role: "assistant", content: "In town." },
    ]);
    expect(h.run.mock.calls[1][0].conversationId).toBe("preview-1");
  });

  it("sends at most the last 20 turns", async () => {
    h.run.mockImplementation(async () => reply("ok"));
    render(<DraftTestPane draftId="d1" view={view()} />);
    for (let i = 0; i < 12; i += 1) {
      await ask(`q${i}`);
      await waitFor(() => expect(screen.getAllByText("ok")).toHaveLength(i + 1));
    }
    expect(h.run.mock.calls[11][0].history).toHaveLength(20);
  });

  it("explains an answer: pages used, time, and when it didn't know", async () => {
    h.run.mockResolvedValueOnce(reply("Hmm.", { handledBy: "declined", citations: [] }));
    h.run.mockResolvedValueOnce(reply("Ten dollars."));
    render(<DraftTestPane draftId="d1" view={view()} />);
    await ask("First");
    await screen.findByText("Hmm.");
    expect(screen.getByText(T.why.declined)).toBeTruthy();
    expect(screen.getByText(T.why.none)).toBeTruthy();
    expect(screen.getByText("Took 2.4 seconds.")).toBeTruthy();
    await ask("Second");
    await screen.findByText("Ten dollars.");
    expect(screen.getByText("Fees · Prices")).toBeTruthy();
  });

  it("says when pages are still being read", async () => {
    h.run.mockResolvedValueOnce(reply("Maybe.", { preview: { pendingDocuments: 2 } }));
    render(<DraftTestPane draftId="d1" view={view()} />);
    await ask("Hi");
    expect(await screen.findByText(T.stillReading)).toBeTruthy();
  });

  it("notes an edit once, however many land, and asks the question again on request", async () => {
    h.run.mockResolvedValueOnce(reply("Old answer."));
    const { rerender } = render(<DraftTestPane draftId="d1" view={view()} />);
    await ask("What are your fees?");
    await screen.findByText("Old answer.");
    expect(screen.queryByText(T.updated)).toBeNull();
    expect(screen.queryByRole("button", { name: T.askAgain })).toBeNull();

    for (const version of [2, 3, 4]) {
      rerender(<DraftTestPane draftId="d1" view={view({ version })} />);
    }
    expect(await screen.findAllByText(T.updated)).toHaveLength(1);
    expect(screen.getByText(new RegExp(T.older))).toBeTruthy();
    expect(document.querySelector("[aria-live='polite']")?.textContent).toBe(T.announce);

    h.run.mockResolvedValueOnce(reply("New answer."));
    fireEvent.click(screen.getByRole("button", { name: T.askAgain }));
    await screen.findByText("New answer.");
    // The same question again, after the turns before it; the old reply stays, faded, above.
    expect(h.run.mock.calls[1][0]).toMatchObject({ message: "What are your fees?", history: [] });
    const old = screen.getByText("Old answer.").closest("li") as HTMLElement;
    expect(old.className).toContain("is-faded");
    expect(within(old).queryByRole("button", { name: T.askAgain })).toBeNull();
    expect(screen.queryByRole("button", { name: T.askAgain })).toBeNull();
    expect(screen.getAllByText("What are your fees?")).toHaveLength(1);
  });

  it("closes the chat when setup has finished (409)", async () => {
    h.run.mockRejectedValueOnce(new ChatbotTestStreamUnavailable(409));
    render(<DraftTestPane draftId="d1" view={view()} />);
    await ask("Hi");
    expect(await screen.findByText(T.finished)).toBeTruthy();
    expect(screen.queryByLabelText(T.inputLabel)).toBeNull();
    expect(h.fallback).not.toHaveBeenCalled();
  });

  it("falls back to the plain request when the stream can't start, and reads its 409", async () => {
    h.run.mockRejectedValue(new ChatbotTestStreamUnavailable());
    h.fallback.mockReturnValueOnce({ unwrap: () => Promise.resolve(reply("Plain.")) });
    render(<DraftTestPane draftId="d1" view={view()} />);
    await ask("Hi");
    expect(await screen.findByText("Plain.")).toBeTruthy();
    h.fallback.mockReturnValueOnce({
      unwrap: () => Promise.reject({ status: 409, data: { errorCode: "setup_finished" } }),
    });
    await ask("Again");
    expect(await screen.findByText(T.finished)).toBeTruthy();
  });

  it("fails in plain words, never a code, and tries again", async () => {
    h.run.mockRejectedValueOnce(new Error("INTERNAL_500"));
    render(<DraftTestPane draftId="d1" view={view()} />);
    await ask("Hi");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(T.failed);
    expect(alert.textContent).not.toContain("INTERNAL");
    h.run.mockResolvedValueOnce(reply("Back."));
    fireEvent.click(screen.getByRole("button", { name: T.tryAgain }));
    await screen.findByText("Back.");
    expect(screen.queryByRole("alert")).toBeNull();
    // The question stays once; retrying doesn't add it again.
    expect(screen.getAllByText("Hi")).toHaveLength(1);
    expect(h.run.mock.calls[1][0]).toMatchObject({ message: "Hi", history: [] });
  });

  it("starts a new chat: stops the run and clears the conversation", async () => {
    h.run.mockResolvedValueOnce(reply("One."));
    render(<DraftTestPane draftId="d1" view={view()} />);
    await ask("First");
    await screen.findByText("One.");
    fireEvent.click(screen.getByRole("button", { name: T.newChat }));
    expect(h.cancel).toHaveBeenCalled();
    expect(screen.queryByText("One.")).toBeNull();
    h.run.mockResolvedValueOnce(reply("Two."));
    await ask("Second");
    await screen.findByText("Two.");
    expect(h.run.mock.calls[1][0].conversationId).toBeUndefined();
    expect(h.run.mock.calls[1][0].history).toEqual([]);
  });
});

describe("DraftTestPane on the working copy (stage 3)", () => {
  it("marks a reply older by the settings hash, not the draft's version", async () => {
    h.run.mockResolvedValue(
      reply("Ten dollars.", { preview: { pendingDocuments: 0, settingsHash: "h1" } }),
    );
    const { rerender } = render(
      <DraftTestPane draftId="d1" view={view({ status: "published" })} usable settingsHash="h1" />,
    );
    await ask("Fees?");
    await screen.findByText("Ten dollars.");
    expect(screen.queryByText(new RegExp(T.older))).toBeNull();
    // The draft's version moving says nothing; the hash does.
    rerender(
      <DraftTestPane
        draftId="d1"
        view={view({ status: "published", version: 9 })}
        usable
        settingsHash="h1"
      />,
    );
    expect(screen.queryByText(new RegExp(T.older))).toBeNull();
    rerender(
      <DraftTestPane
        draftId="d1"
        view={view({ status: "published", version: 9 })}
        usable
        settingsHash="h2"
      />,
    );
    expect(await screen.findByText(new RegExp(T.older))).toBeTruthy();
    expect(screen.getByRole("button", { name: T.askAgain })).toBeTruthy();
  });

  it("says a live chatbot's test used unapplied changes and never reached customers", async () => {
    h.run.mockResolvedValue(
      reply("Open till 6.", {
        preview: { pendingDocuments: 0, settingsHash: "h1", workingCopy: true },
      }),
    );
    render(
      <DraftTestPane draftId="d1" view={view({ status: "published" })} usable settingsHash="h1" />,
    );
    await ask("Hours?");
    expect((await screen.findByTestId("draft-test-working-copy")).textContent).toBe(
      BUILD_COPY.workingCopy,
    );
  });

  it("labels the blank chatbot's starter reply as costing nothing", async () => {
    h.run.mockResolvedValue(
      reply("Hi! I'm your new assistant.", {
        handledBy: "template",
        citations: [],
        preview: { pendingDocuments: 0, settingsHash: "h0", starter: true },
      }),
    );
    const onReplyHash = vi.fn();
    render(
      <DraftTestPane
        draftId="d1"
        view={view()}
        usable
        settingsHash="h0"
        onReplyHash={onReplyHash}
      />,
    );
    await ask("hello");
    expect(await screen.findByTestId("draft-test-starter")).toBeTruthy();
    expect(onReplyHash).toHaveBeenCalledWith("h0");
  });

  it("at $0 shows the contact-Ally line instead of the input, and a 402 reports it", async () => {
    const { rerender } = render(
      <DraftTestPane draftId="d1" view={view()} usable aiOff="No credits" />,
    );
    expect(screen.getByTestId("draft-test-credits").textContent).toBe("No credits");
    expect(screen.queryByLabelText(T.inputLabel)).toBeNull();
    const onCreditsRequired = vi.fn();
    h.run.mockRejectedValue(new ChatbotTestStreamUnavailable(402));
    h.fallback.mockReturnValue({
      unwrap: () => Promise.reject({ status: 402, data: { errorCode: "credits_required" } }),
    });
    rerender(
      <DraftTestPane draftId="d1" view={view()} usable onCreditsRequired={onCreditsRequired} />,
    );
    await ask("Fees?");
    await waitFor(() => expect(onCreditsRequired).toHaveBeenCalled());
    expect(screen.queryByText(T.failed)).toBeNull();
  });
});
