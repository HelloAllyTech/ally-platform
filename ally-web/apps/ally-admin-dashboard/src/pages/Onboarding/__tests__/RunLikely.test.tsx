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
  useAddCheckupCaseMutation: () => [vi.fn()],
}));
vi.mock("@hooks/useChatbotTestStream", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useChatbotTestStream: () => ({ run: h.run, cancel: h.cancel }),
}));

// eslint-disable-next-line import/first
import { SPLIT_COPY } from "../copy";
// eslint-disable-next-line import/first
import { DraftTestPane } from "../DraftTestPane";

const T = SPLIT_COPY.pane;
const L = SPLIT_COPY.likely;

const view = {
  id: "d1",
  status: "active",
  version: 1,
  chatbotId: "b1",
  learned: { facts: [], dropped: 0 },
  draft: { assistantName: "Sunny", introduction: "Hi", suggestedQuestions: [], extraNever: [] },
} as never;

const row = (over: Record<string, unknown> = {}) => ({
  question: "What are your fees?",
  verdict: "ok",
  reason: null,
  reply: "Ten dollars a class.\nPay at the desk.",
  handledBy: "rag",
  citations: 2,
  ...over,
});

const click = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: L.button }));
  });
};

beforeEach(() => {
  h.run.mockReset();
  h.cancel.mockReset();
  h.fallback.mockReset();
  h.likely.mockReset();
});

describe("Run 10 likely questions", () => {
  it("asks the backend for ten, shows a quiet state, then the results with marks and a summary", async () => {
    let finish: (r: unknown) => void = () => undefined;
    h.likely.mockReturnValue({ unwrap: () => new Promise(resolve => (finish = resolve)) });
    render(<DraftTestPane draftId="d1" view={view} />);
    await click();
    expect(h.likely).toHaveBeenCalledWith({ id: "d1", count: 10 });
    expect(screen.getByText(L.running)).toBeTruthy();
    // Disabled while it runs.
    expect((screen.getByRole("button", { name: L.button }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await act(async () =>
      finish({
        generated: 2,
        results: [
          row(),
          row({ question: "Do you teach kids?", verdict: "check", reason: "It guessed the age." }),
        ],
      }),
    );
    expect(screen.queryByText(L.running)).toBeNull();
    expect(screen.getByText("1 of 2 look right")).toBeTruthy();
    expect(screen.getByRole("img", { name: L.ok })).toBeTruthy();
    expect(screen.getByRole("img", { name: L.check })).toBeTruthy();
    // One line of the reply while collapsed.
    expect(screen.getAllByText("Ten dollars a class.").length).toBe(2);
    expect(screen.queryByText("Pay at the desk.")).toBeNull();
    expect((screen.getByRole("button", { name: L.button }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("expands a row to the full reply and the reason", async () => {
    h.likely.mockReturnValue({
      unwrap: async () => ({
        generated: 1,
        results: [row({ verdict: "check", reason: "It guessed the age." })],
      }),
    });
    render(<DraftTestPane draftId="d1" view={view} />);
    await click();
    fireEvent.click(await screen.findByRole("button", { name: /Show the full reply/ }));
    expect(screen.getByText(/Pay at the desk\./)).toBeTruthy();
    expect(screen.getByText(/It guessed the age\./)).toBeTruthy();
  });

  it("says it needs to learn more when there are no results", async () => {
    h.likely.mockReturnValue({ unwrap: async () => ({ generated: 0, results: [] }) });
    render(<DraftTestPane draftId="d1" view={view} />);
    await click();
    expect(await screen.findByText(L.empty)).toBeTruthy();
  });

  it("says so in plain words when it fails, never a code", async () => {
    h.likely.mockReturnValue({
      unwrap: async () => {
        throw { status: 500, data: { errorCode: "llm_down" } };
      },
    });
    render(<DraftTestPane draftId="d1" view={view} />);
    await click();
    expect(await screen.findByText(L.failed)).toBeTruthy();
    expect(screen.queryByText(/llm_down/)).toBeNull();
  });

  it("hides the feature once setup is finished (409 setup_finished)", async () => {
    h.likely.mockReturnValue({
      unwrap: async () => {
        throw { status: 409, data: { errorCode: "setup_finished" } };
      },
    });
    render(<DraftTestPane draftId="d1" view={view} />);
    await click();
    await screen.findByText(T.finished);
    expect(screen.queryByRole("button", { name: L.button })).toBeNull();
    expect(screen.queryByText(L.failed)).toBeNull();
  });

  it("opens a question in the chat as a normal exchange, usable with Fix this and Save as a test", async () => {
    h.likely.mockReturnValue({
      unwrap: async () => ({ generated: 1, results: [row()] }),
    });
    const edit = vi.fn();
    render(<DraftTestPane draftId="d1" view={view} fix={{ edit, upload: vi.fn() }} />);
    await click();
    fireEvent.click(await screen.findByRole("button", { name: L.openInChat }));
    const transcript = screen.getByTestId("draft-test-transcript");
    expect(within(transcript).getByText("What are your fees?")).toBeTruthy();
    expect(within(transcript).getByText(/Ten dollars a class\./)).toBeTruthy();
    expect(within(transcript).getByRole("button", { name: SPLIT_COPY.fix.button })).toBeTruthy();
    expect(
      within(transcript).getByRole("button", { name: SPLIT_COPY.saveTest.button }),
    ).toBeTruthy();
    // The next question carries it as history.
    h.run.mockResolvedValueOnce({
      reply: "Later.",
      handledBy: "rag",
      citations: [],
      conversationId: "c",
    });
    fireEvent.change(screen.getByLabelText(T.inputLabel), { target: { value: "And hours?" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: T.send }));
    });
    expect(h.run.mock.calls[0][0].history).toEqual([
      { role: "user", content: "What are your fees?" },
      { role: "assistant", content: "Ten dollars a class.\nPay at the desk." },
    ]);
  });
});
